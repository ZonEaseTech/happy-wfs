/**
 * `happy cursor-approval-hook`
 *
 * The program Cursor executes for every tool call. It reads the hook payload on
 * stdin, asks the session's approval bridge, and prints Cursor's verdict on
 * stdout. It blocks for as long as the person takes to answer.
 *
 * Two rules come from measuring cursor-agent 2026.08.11:
 *
 *   Only allow/deny. On preToolUse a returned "ask" is silently treated as
 *   allow, so it must never be produced here.
 *
 *   Deny when in doubt, but only when a session is actually running. If no
 *   bridge is listening for this directory, the user is driving Cursor
 *   themselves — an IDE window, a plain cursor-agent run — and Happy has no
 *   business blocking that, so it allows and gets out of the way.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APPROVAL_ENDPOINT_FILE, approvalRegistryDir } from './cursorApprovalServer';

interface HookPayload {
    tool_name?: unknown;
    tool_input?: unknown;
    tool_use_id?: unknown;
    cwd?: unknown;
    workspace_roots?: unknown;
    /** Cursor's chat id — the key that identifies which session owns this call. */
    session_id?: unknown;
    conversation_id?: unknown;
}

function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', () => resolve(data));
    });
}

function emit(permission: 'allow' | 'deny', userMessage?: string): void {
    const payload: Record<string, unknown> = { permission };
    if (userMessage) {
        payload.user_message = userMessage;
        payload.agent_message = userMessage;
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** True when the process that wrote an endpoint is gone. */
function isStale(pid: unknown): boolean {
    if (typeof pid !== 'number') return false;
    try {
        // Signal 0 checks for existence without touching the process.
        process.kill(pid, 0);
        return false;
    } catch {
        return true;
    }
}

function readEndpoint(file: string): { port: number; token: string } | null {
    if (!existsSync(file)) return null;
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof parsed?.port !== 'number' || typeof parsed?.token !== 'string') return null;
        // A session that died without cleaning up must not keep denying tools;
        // its leftover entry would otherwise block the user's own Cursor use.
        if (isStale(parsed.pid)) return null;
        return { port: parsed.port, token: parsed.token };
    } catch {
        // Malformed endpoint file: treat as absent.
    }
    return null;
}

/**
 * Finds the session that owns this call. The chat id is authoritative — several
 * sessions can run in one directory, and matching on directory alone would send
 * approvals to whichever started last.
 */
function findEndpoint(payload: HookPayload): { port: number; token: string } | null {
    for (const key of [payload.session_id, payload.conversation_id]) {
        if (typeof key !== 'string' || key.length === 0) continue;
        const found = readEndpoint(join(approvalRegistryDir(), `${key}.json`));
        if (found) return found;
    }

    // Fall back to the directory-scoped file written by older sessions.
    const candidates: string[] = [];
    if (typeof payload.cwd === 'string') candidates.push(payload.cwd);
    if (Array.isArray(payload.workspace_roots)) {
        for (const root of payload.workspace_roots) {
            if (typeof root === 'string') candidates.push(root);
        }
    }
    if (process.env.CURSOR_PROJECT_DIR) candidates.push(process.env.CURSOR_PROJECT_DIR);
    candidates.push(process.cwd());

    for (const dir of candidates) {
        const found = readEndpoint(join(dir, '.cursor', APPROVAL_ENDPOINT_FILE));
        if (found) return found;
    }
    return null;
}

export async function runCursorApprovalHook(): Promise<void> {
    const raw = await readStdin();
    let payload: HookPayload = {};
    try {
        payload = JSON.parse(raw) as HookPayload;
    } catch {
        // Without a payload there is nothing to describe to the user. A running
        // session should not be bypassed by a parse failure, so fall through
        // and let the endpoint check decide.
    }

    const endpoint = findEndpoint(payload);
    if (!endpoint) {
        emit('allow');
        return;
    }

    try {
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/approve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                token: endpoint.token,
                tool_name: typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
                tool_input: payload.tool_input,
                tool_use_id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : undefined,
            }),
        });
        if (!response.ok) {
            emit('deny', 'Happy could not reach the approval bridge.');
            return;
        }
        const result = await response.json() as { approved?: boolean };
        if (result.approved === true) {
            emit('allow');
        } else {
            emit('deny', 'Denied from Happy.');
        }
    } catch (error) {
        // The session is supposed to be there and is not: deny rather than
        // hand the agent free rein.
        emit('deny', `Happy approval unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}
