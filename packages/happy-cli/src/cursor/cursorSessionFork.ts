/**
 * Cursor Session Fork
 *
 * Cursor keeps each chat in its own directory under
 * ~/.cursor/chats/<workspace-hash>/<chatId>/, holding a SQLite store plus a
 * meta.json. The chat id appears only as the directory name — it is not
 * written inside store.db or meta.json (verified against cursor-agent
 * 2026.08.11) — so copying the directory under a fresh uuid produces an
 * independent chat that `cursor-agent --resume <newId>` will open.
 *
 * That independence is what "duplicate session" means for the other agents
 * too: the copy and the original diverge from the moment they are made.
 */

import { randomUUID } from 'node:crypto';
import { cp, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '@/ui/logger';

export interface CursorForkResult {
    success: boolean;
    /** Chat id of the copy, to be passed to `happy cursor --resume` */
    newChatId?: string;
    errorMessage?: string;
}

function chatsRoot(): string {
    return join(homedir(), '.cursor', 'chats');
}

/**
 * Chats are filed under a hash of their workspace, and we only know the chat
 * id, so the hash directories are scanned for it.
 */
async function findChatDirectory(chatId: string): Promise<string | null> {
    const root = chatsRoot();
    if (!existsSync(root)) return null;
    let workspaces: string[];
    try {
        workspaces = await readdir(root);
    } catch {
        return null;
    }
    for (const workspace of workspaces) {
        const candidate = join(root, workspace, chatId);
        try {
            if ((await stat(candidate)).isDirectory()) return candidate;
        } catch {
            // Not in this workspace; keep looking.
        }
    }
    return null;
}

export async function forkCursorSession(chatId: string): Promise<CursorForkResult> {
    const source = await findChatDirectory(chatId);
    if (!source) {
        return { success: false, errorMessage: `Cursor chat not found: ${chatId}` };
    }

    const newChatId = randomUUID();
    const destination = join(source, '..', newChatId);

    try {
        // Copies store.db together with its -wal and -shm siblings. Taking them
        // as a set keeps any not-yet-checkpointed writes, which copying the
        // database alone would lose.
        await cp(source, destination, { recursive: true });
        logger.debug(`[cursor] forked chat ${chatId} → ${newChatId}`);
        return { success: true, newChatId };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(`[cursor] fork failed for ${chatId}: ${message}`);
        return { success: false, errorMessage: message };
    }
}
