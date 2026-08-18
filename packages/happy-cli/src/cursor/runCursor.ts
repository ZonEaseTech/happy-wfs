/**
 * runCursor - Happy session driven by the Cursor CLI
 *
 * Creates a Happy session, then relays between it and CursorCliBackend: user
 * messages from the app become Cursor turns, and Cursor's stream becomes ACP
 * messages the app already knows how to render.
 *
 * Tool approval runs through CursorApprovalBridge: Cursor offers no callback,
 * so the session writes a .cursor/hooks.json pointing back at this CLI and
 * every tool call waits on the phone before it runs.
 */

import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { type Credentials, readSettings } from '@/persistence';
import type { PermissionMode } from '@/api/types';
import { initialMachineMetadata } from '@/daemon/run';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { createMcpContext } from '@/agent/mcp';
import { logger } from '@/ui/logger';
import { CursorCliBackend } from './CursorCliBackend';
import { agentMessageToAcp } from './cursorAcpMessages';
import { CursorPermissionHandler } from './cursorPermissionHandler';
import { CursorApprovalBridge } from './cursorApprovalServer';

export interface RunCursorOptions {
    credentials: Credentials;
    startedBy?: 'daemon' | 'terminal';
    /** Optional first prompt, so `happy cursor "..."` starts working at once */
    initialPrompt?: string;
    /** Model id from `cursor-agent --list-models` */
    model?: string | null;
    /** Existing Cursor chat id to continue, e.g. a fork made for a copy */
    resumeChatId?: string | null;
}

/** Matches the cadence the other backends use to hold the session open. */
const KEEP_ALIVE_INTERVAL_MS = 2000;
/**
 * Ceiling on graceful shutdown. Flushing the session can block on a server
 * that is slow or gone, and a session that refuses to die keeps its hooks
 * pointing at a bridge that no longer answers.
 */
const SHUTDOWN_TIMEOUT_MS = 5000;

export async function runCursor(opts: RunCursorOptions): Promise<void> {
    const api = await ApiClient.create(opts.credentials);

    const settings = await readSettings();
    const machineId = settings?.machineId;
    if (!machineId) {
        console.error(chalk.red('No machine ID found in settings. Run `happy` once to finish setup.'));
        process.exit(1);
    }
    await api.getOrCreateMachine({ machineId, metadata: initialMachineMetadata });

    const { state, metadata } = createSessionMetadata({
        flavor: 'cursor',
        machineId,
        startedBy: opts.startedBy,
    });
    const sessionTag = randomUUID();
    const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

    // An unreachable server yields an offline stub that reconnects in the
    // background and hands us the real client through onSessionSwap.
    let session: ApiSessionClient;
    const { session: initialSession } = setupOfflineReconnection({
        api,
        sessionTag,
        metadata,
        state,
        response,
        onSessionSwap: (newSession) => { session = newSession; },
    });
    session = initialSession;

    // A daemon-spawned session is only considered started once it reports its
    // own id back; without this the daemon waits, times out, and the app is
    // told no session id came back.
    if (response) {
        try {
            const result = await notifyDaemonSessionStarted(response.id, metadata);
            if (result?.error) {
                logger.debug(`[cursor] daemon did not accept the session report: ${result.error}`);
            }
        } catch (error) {
            // Started from a terminal with no daemon running: nothing to tell.
            logger.debug(`[cursor] could not report session to daemon: ${error}`);
        }
    }

    // Happy's own tools (change_title, preview_html, device_exec…) reach the
    // agent over MCP, the same set the other agents get.
    const mcp = await createMcpContext(session);
    const mcpStdio = mcp.configForStdio().happy;
    const mcpUrlArg = mcpStdio?.args?.indexOf('--url') ?? -1;
    const mcpUrl = mcpUrlArg >= 0 ? mcpStdio!.args![mcpUrlArg + 1] : null;
    // The URL has to ride in the config file: Cursor scrubs the environment
    // before starting an MCP server, so HAPPY_HTTP_MCP_URL never arrives.
    const mcpBridge = mcpStdio ? { command: mcpStdio.command, args: mcpStdio.args ?? [] } : null;

    // Tool approval: Cursor has no callback for it, so a local bridge plus a
    // generated .cursor/hooks.json carries each tool call to the phone.
    const permissionHandler = new CursorPermissionHandler(session, api.push());
    const approvalBridge = new CursorApprovalBridge({ cwd: process.cwd(), handler: permissionHandler, mcpBridge });
    let approvalReady = false;
    try {
        await approvalBridge.start();
        approvalReady = true;
    } catch (error) {
        logger.debug(`[cursor] approval bridge failed to start: ${error}`);
    }

    const backend = new CursorCliBackend({
        cwd: process.cwd(),
        model: opts.model ?? null,
        resumeChatId: opts.resumeChatId ?? null,
        // Cursor asks before loading an MCP server; nobody is at the terminal.
        extraArgs: mcpBridge ? ['--approve-mcps'] : undefined,
    });

    // Publish Cursor's own chat id: duplicating a session forks that chat, so
    // without it in the metadata the app has nothing to copy from.
    let publishedChatId: string | null = opts.resumeChatId ?? null;
    if (publishedChatId) {
        session.updateMetadata((current) => ({ ...current, cursorSessionId: publishedChatId! }));
    }

    // Cursor's print mode runs one prompt per process, so turns have to be
    // serialised: queue anything that arrives while a turn is in flight.
    const queue: string[] = [];
    let draining = false;
    let thinking = false;

    let reportedModel: string | null = null;
    backend.onMessage((message) => {
        const chatId = backend.getChatId();
        if (chatId && chatId !== publishedChatId) {
            publishedChatId = chatId;
            session.updateMetadata((current) => ({ ...current, cursorSessionId: chatId }));
            void approvalBridge.registerChat(chatId);
        }
        if (message.type === 'token-count') {
            // Feeds the session's usage counter; without this the app shows a
            // Cursor session as having consumed nothing.
            const usage = message as unknown as Record<string, unknown>;
            const num = (key: string): number => (typeof usage[key] === 'number' ? usage[key] as number : 0);
            const input = num('inputTokens');
            const output = num('outputTokens');
            const cacheRead = num('cacheReadTokens');
            const cacheWrite = num('cacheWriteTokens');
            const total = input + output + cacheRead + cacheWrite;
            if (total > 0) {
                session.sendUsageReport({
                    key: 'cursor-session',
                    tokens: { total, input, output, cache_read: cacheRead, cache_creation: cacheWrite },
                    // Cursor bills against its own subscription and reports no
                    // per-request price, so there is nothing honest to put here.
                    cost: { total: 0 },
                });
            }
        }
        if (message.type === 'status') {
            thinking = message.status === 'starting' || message.status === 'running';
            // cursor-agent names the model it resolved to in its init event;
            // surface it so the session shows what actually ran.
            const named = message.detail?.match(/^cursor-agent ready \((.+)\)$/)?.[1];
            if (named && named !== reportedModel) {
                reportedModel = named;
                session.updateMetadata((current) => ({ ...current, model: named }));
            }
        }
        for (const acp of agentMessageToAcp(message, () => randomUUID())) {
            session.sendAgentMessage('cursor', acp);
        }
    });

    const drain = async () => {
        if (draining) return;
        draining = true;
        try {
            while (queue.length > 0) {
                const prompt = queue.shift()!;
                logger.debug(`[cursor] running turn (${queue.length} queued behind it)`);
                try {
                    await backend.sendPrompt('', prompt);
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    session.sendAgentMessage('cursor', { type: 'message', message: `Cursor turn failed: ${detail}` });
                    logger.debug(`[cursor] turn failed: ${detail}`);
                }
            }
        } finally {
            draining = false;
            thinking = false;
        }
    };

    /**
     * The app's stop button. Kills the running cursor-agent and drops anything
     * still queued; the chat id survives, so the next message resumes the same
     * conversation.
     */
    const handleAbort = async () => {
        logger.debug(`[cursor] abort requested (${queue.length} queued)`);
        queue.length = 0;
        try {
            await backend.cancel('');
        } catch (error) {
            logger.debug(`[cursor] abort failed: ${error}`);
        }
        // Nothing is left waiting on the phone once the turn is gone.
        permissionHandler.reset();
        thinking = false;
        session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
    };

    session.onUserMessage((message) => {
        const text = message.content?.text;
        if (typeof text !== 'string' || text.trim().length === 0) return;
        if (message.meta?.permissionMode) {
            permissionHandler.setPermissionMode(message.meta.permissionMode as PermissionMode);
        }
        if (message.meta?.hasOwnProperty('model')) {
            // The picker's choice travels with each message — the daemon never
            // passes --model at spawn — so ignoring it left every session on
            // Cursor's default while the app displayed the chosen one.
            const chosen = message.meta.model || null;
            backend.setModel(chosen);
            logger.debug(`[cursor] model set to ${chosen ?? '(Cursor default)'}`);
        }
        queue.push(text);
        void drain();
    });

    const keepAlive = setInterval(() => {
        session.keepAlive(thinking, 'remote');
    }, KEEP_ALIVE_INTERVAL_MS);
    session.sendSessionEvent({ type: 'ready' });

    console.log(chalk.green('Cursor session ready.') + ' Open Happy on your phone to drive it.');
    if (response?.id) {
        console.log(chalk.gray(`  id     ${response.id}`));
    } else {
        console.log(chalk.yellow('  id     (offline — reconnecting in the background)'));
    }
    console.log(chalk.gray(`  cwd    ${process.cwd()}`));
    console.log(chalk.gray(`  model  ${opts.model ?? '(Cursor default)'}`));
    if (mcpUrl) {
        console.log(chalk.gray(`  tools     Happy MCP on ${mcpUrl}`));
    } else {
        console.log(chalk.yellow('  tools     Happy MCP unavailable — change_title, preview_html and device tools are missing'));
    }
    if (approvalReady) {
        console.log(chalk.gray('  approval  tool calls are sent to your phone before they run'));
    } else {
        console.log(chalk.yellow('  approval  UNAVAILABLE — the bridge did not start, so tools run unchecked'));
    }

    if (opts.initialPrompt) {
        queue.push(opts.initialPrompt);
        void drain();
    }

    let shuttingDown = false;
    const shutdown = async (archived = false) => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(keepAlive);
        thinking = false;
        logger.debug(`[cursor] shutting down${archived ? ' (archived)' : ''}`);
        if (archived) {
            // Record who ended it, matching what Codex and Gemini write, so the
            // session does not come back as running on the next refresh.
            session.updateMetadata((current) => ({
                ...current,
                lifecycleState: 'archived',
                lifecycleStateSince: Date.now(),
                archivedBy: 'cli',
                archiveReason: 'User terminated',
            }));
        }
        try {
            // Cancel anything still waiting on the phone: a request left pending
            // by a dead session can never be answered, and the app would keep
            // offering its buttons forever.
            permissionHandler.reset();
            await backend.dispose();
            await approvalBridge.stop();
            mcp.stop();
        } finally {
            session.sendSessionDeath();
            await session.flush();
            await session.close();
        }
    };

    const shutdownAndExit = () => {
        void Promise.race([
            shutdown(),
            new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]).finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdownAndExit);
    process.on('SIGTERM', shutdownAndExit);

    session.rpcHandlerManager.registerHandler('abort', handleAbort);

    // Archiving a session from the app comes through as this RPC.
    registerKillSessionHandler(session.rpcHandlerManager, async () => {
        await Promise.race([
            shutdown(true),
            new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
        ]);
        process.exit(0);
    });

    // Hold the process open for app-driven turns; shutdown happens on signal.
    await new Promise<void>(() => { });
}
