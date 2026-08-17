/**
 * runCursor - Happy session driven by the Cursor CLI
 *
 * Creates a Happy session, then relays between it and CursorCliBackend: user
 * messages from the app become Cursor turns, and Cursor's stream becomes ACP
 * messages the app already knows how to render.
 *
 * Not yet here: tool approval. Cursor gates tools through file-based hooks
 * rather than a callback, so a session started this way runs with whatever the
 * local Cursor install permits. Treat it as read-mostly until that lands.
 */

import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { type Credentials, readSettings } from '@/persistence';
import { initialMachineMetadata } from '@/daemon/run';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { logger } from '@/ui/logger';
import { CursorCliBackend } from './CursorCliBackend';
import { agentMessageToAcp } from './cursorAcpMessages';

export interface RunCursorOptions {
    credentials: Credentials;
    startedBy?: 'daemon' | 'terminal';
    /** Optional first prompt, so `happy cursor "..."` starts working at once */
    initialPrompt?: string;
    /** Model id from `cursor-agent --list-models` */
    model?: string | null;
}

/** Matches the cadence the other backends use to hold the session open. */
const KEEP_ALIVE_INTERVAL_MS = 2000;

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

    const backend = new CursorCliBackend({
        cwd: process.cwd(),
        model: opts.model ?? null,
    });

    // Cursor's print mode runs one prompt per process, so turns have to be
    // serialised: queue anything that arrives while a turn is in flight.
    const queue: string[] = [];
    let draining = false;
    let thinking = false;

    backend.onMessage((message) => {
        if (message.type === 'status') {
            thinking = message.status === 'starting' || message.status === 'running';
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

    session.onUserMessage((message) => {
        const text = message.content?.text;
        if (typeof text !== 'string' || text.trim().length === 0) return;
        if (message.meta?.hasOwnProperty('model')) {
            logger.debug('[cursor] per-message model override is not wired yet, ignoring');
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
    console.log(chalk.yellow('  note   tool approval is not wired for Cursor yet — it runs with local Cursor permissions.'));

    if (opts.initialPrompt) {
        queue.push(opts.initialPrompt);
        void drain();
    }

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        clearInterval(keepAlive);
        logger.debug('[cursor] shutting down');
        try {
            await backend.dispose();
        } finally {
            session.sendSessionDeath();
            await session.flush();
            await session.close();
        }
    };

    process.on('SIGINT', () => { void shutdown().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { void shutdown().then(() => process.exit(0)); });

    // Hold the process open for app-driven turns; shutdown happens on signal.
    await new Promise<void>(() => { });
}
