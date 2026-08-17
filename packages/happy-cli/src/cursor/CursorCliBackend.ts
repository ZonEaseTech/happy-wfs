/**
 * CursorCliBackend - AgentBackend over the Cursor CLI
 *
 * Drives `cursor-agent -p ... --output-format stream-json` and republishes its
 * JSONL stream as AgentMessages. Same shape as the Codex and Gemini backends:
 * a child process speaking a documented protocol, no vendor SDK dependency.
 *
 * Scope of this first slice is read-only observation — streaming a Cursor run
 * to the app. Tool approval is deliberately absent: Cursor exposes it through
 * file-based hooks (.cursor/hooks.json), which is a separate piece of work.
 * Until that lands, a session here runs with whatever permissions the local
 * Cursor install grants.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { logger } from '@/ui/logger';
import type {
    AgentBackend,
    AgentMessageHandler,
    SendPromptOptions,
    SessionId,
    StartSessionResult,
} from '@/agent/core/AgentBackend';
import type { AgentMessage } from '@/agent/core/AgentMessage';
import { drainJsonLines, mapCursorStreamEvent, parseCursorSessionInit } from './cursorStreamEvents';

export interface CursorCliBackendOptions {
    /** Working directory for the agent */
    cwd: string;
    /** Environment variables to pass through */
    env?: Record<string, string>;
    /** Model id from `cursor-agent --list-models`; null leaves it to Cursor */
    model?: string | null;
    /** Executable name or path; overridable for tests and odd installs */
    command?: string;
    /** Extra CLI flags, escape hatch while the integration settles */
    extraArgs?: string[];
}

/** How long to wait for the child to exit on its own before killing it. */
const CANCEL_GRACE_MS = 2000;

export class CursorCliBackend implements AgentBackend {
    private readonly options: CursorCliBackendOptions;
    private readonly handlers = new Set<AgentMessageHandler>();
    /** stdin is closed: the CLI takes its prompt as an argument, not on stdin. */
    private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
    /** Cursor's own chat id, used to resume on the next turn. */
    private chatId: string | null = null;
    private stdoutBuffer = '';
    private turnComplete: Promise<void> = Promise.resolve();
    private resolveTurn: (() => void) | null = null;
    private disposed = false;

    constructor(options: CursorCliBackendOptions) {
        this.options = options;
    }

    onMessage(handler: AgentMessageHandler): void {
        this.handlers.add(handler);
    }

    offMessage(handler: AgentMessageHandler): void {
        this.handlers.delete(handler);
    }

    private emit(message: AgentMessage): void {
        for (const handler of this.handlers) {
            try {
                handler(message);
            } catch (error) {
                logger.debug(`[cursor] message handler threw: ${error}`);
            }
        }
    }

    async startSession(initialPrompt?: string): Promise<StartSessionResult> {
        if (this.disposed) throw new Error('CursorCliBackend has been disposed');
        // Cursor assigns the chat id itself and only reveals it in the init
        // event, so there is no session to hand back until a turn has run.
        if (initialPrompt !== undefined) {
            await this.runTurn(initialPrompt);
        }
        return { sessionId: this.chatId ?? '' };
    }

    async sendPrompt(_sessionId: SessionId, prompt: string, options?: SendPromptOptions): Promise<void> {
        if (options?.images?.length) {
            // The CLI takes the prompt as an argument with no attachment flag,
            // so images would be silently dropped — say so instead.
            throw new Error('CursorCliBackend does not support image prompts yet');
        }
        await this.runTurn(prompt);
    }

    /**
     * One turn is one child process: the CLI's print mode runs a single prompt
     * and exits. Continuity comes from `--resume <chatId>`, which is why the
     * chat id from the first turn has to be kept.
     */
    private async runTurn(prompt: string): Promise<void> {
        if (this.child) {
            throw new Error('CursorCliBackend is already running a turn');
        }

        // --trust is mandatory for us: on an unseen directory the CLI stops to
        // ask whether the workspace is trusted, and headless has nobody to
        // answer, so the run exits 1 before emitting a single event. Note this
        // is not --force/--yolo: it authorises the directory, it does not waive
        // per-tool permission.
        const args = ['-p', prompt, '--output-format', 'stream-json', '--trust'];
        if (this.options.model) args.push('--model', this.options.model);
        if (this.chatId) args.push('--resume', this.chatId);
        if (this.options.extraArgs?.length) args.push(...this.options.extraArgs);

        const command = this.options.command ?? 'cursor-agent';
        logger.debug(`[cursor] spawn ${command} ${this.chatId ? `(resume ${this.chatId})` : '(new chat)'}`);

        this.emit({ type: 'status', status: 'starting' });
        this.stdoutBuffer = '';
        this.turnComplete = new Promise<void>((resolve) => { this.resolveTurn = resolve; });

        const child = spawn(command, args, {
            cwd: this.options.cwd,
            env: { ...process.env, ...this.options.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
        // The CLI reports fatal setup problems (not logged in, untrusted
        // workspace) as plain text and then exits, with nothing on the JSON
        // stream. Keep the last of it so the exit can say why it failed.
        let lastStderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            const text = chunk.trim();
            if (text.length === 0) return;
            lastStderr = text.split('\n').slice(-3).join(' ').slice(0, 300);
            logger.debug(`[cursor] stderr: ${text}`);
        });

        child.on('error', (error) => {
            this.emit({ type: 'status', status: 'error', detail: `failed to start cursor-agent: ${error.message}` });
            this.finishTurn();
        });

        child.on('close', (code) => {
            // Flush whatever was left without a trailing newline.
            this.consumeStdout('\n');
            if (code !== 0) {
                const reason = lastStderr.length > 0 ? `: ${lastStderr}` : '';
                this.emit({ type: 'status', status: 'error', detail: `cursor-agent exited with code ${code}${reason}` });
            }
            logger.debug(`[cursor] turn finished with code ${code}`);
            this.finishTurn();
        });

        await this.turnComplete;
    }

    private consumeStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        const { events, rest } = drainJsonLines(this.stdoutBuffer);
        this.stdoutBuffer = rest;
        for (const event of events) {
            const init = parseCursorSessionInit(event);
            if (init) {
                this.chatId = init.sessionId;
                logger.debug(`[cursor] chat id ${init.sessionId} model ${init.model ?? '(default)'}`);
            }
            for (const message of mapCursorStreamEvent(event)) {
                this.emit(message);
            }
        }
    }

    private finishTurn(): void {
        this.child = null;
        const resolve = this.resolveTurn;
        this.resolveTurn = null;
        resolve?.();
    }

    async cancel(_sessionId: SessionId): Promise<void> {
        const child = this.child;
        if (!child) return;
        logger.debug('[cursor] cancelling current turn');
        child.kill('SIGTERM');
        const killed = await Promise.race([
            this.turnComplete.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), CANCEL_GRACE_MS)),
        ]);
        if (!killed && this.child) {
            this.child.kill('SIGKILL');
        }
        this.emit({ type: 'status', status: 'stopped', detail: 'cancelled' });
    }

    async waitForResponseComplete(timeoutMs = 120000): Promise<void> {
        await Promise.race([
            this.turnComplete,
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error('cursor-agent turn timed out')), timeoutMs)),
        ]);
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        if (this.child) {
            await this.cancel(this.chatId ?? '');
        }
        this.handlers.clear();
    }
}
