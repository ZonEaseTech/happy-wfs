import { Server, Socket } from "socket.io";
import { log } from "@/utils/log";
import { ClientConnection, eventRouter } from "@/app/events/eventRouter";
import { checkSessionAccess } from "@/app/share/accessControl";
import { db } from "@/storage/db";
import { getOrCreateUserRpcListeners } from "./rpcRegistry";

/**
 * PTY frame relay.
 *
 * Streaming frames don't go through the RPC dispatcher — RPC is one-shot
 * ack-based and PTY needs continuous bidirectional flow. The lifecycle
 * methods (pty-start / pty-resize / pty-close) reuse RPC; only the high
 * frequency frames (input from app, output/exit from CLI) live here.
 *
 * Lookup strategy:
 *   - To reach the CLI for a sessionId, we look at the session owner's
 *     rpcListeners map for `{sessionId}:pty-start` — the CLI registers
 *     that method on connect (same place bash/readFile/etc are
 *     registered), so its presence implicitly tells us which socket is
 *     the active CLI for the session.
 *   - To reach app subscribers we iterate the session owner's connections
 *     (plus any users the session is shared with), filtering down to the
 *     ones interested in this session.
 *
 * Server is a pure relay. Frame bodies stay opaque (encrypted by caller),
 * we never decrypt or persist them.
 */
export function registerPtyHandlers(io: Server, socket: Socket, userId: string, connection: ClientConnection) {
    // --- App → CLI ---
    socket.on('pty-input', async (data: any) => {
        try {
            if (!data || typeof data !== 'object') {
                return;
            }
            const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
            const ptyId = typeof data.ptyId === 'string' ? data.ptyId : null;
            if (!sessionId || !ptyId) {
                return;
            }

            // `sessionId` doubles as the PTY scope: it is either a real session
            // or an enrolled machine (that is how `happy ssh` reaches a device).
            // Sessions keep the shared-access rules; machines are owner-only.
            const access = await checkSessionAccess(userId, sessionId);
            let ownerId: string;
            if (access) {
                ownerId = access.isOwner ? userId : await resolveOwnerId(sessionId, userId);
            } else if (await isOwnedMachine(userId, sessionId)) {
                ownerId = userId;
            } else {
                socket.emit('pty-error', { sessionId, ptyId, error: 'forbidden' });
                return;
            }

            // Look up the CLI socket via the owner's rpcListeners. The CLI
            // registers `{scopeId}:pty-start` on connect, so its presence pins
            // the active CLI/daemon socket for this scope.
            const ownerListeners = getOrCreateUserRpcListeners(ownerId);
            const cliSocket = ownerListeners.get(`${sessionId}:pty-start`);

            if (!cliSocket || !cliSocket.connected) {
                // CLI offline → tell the app to tear down this ptyId.
                socket.emit('pty-error', { sessionId, ptyId, error: 'cli_offline' });
                return;
            }

            // Volatile: we never want to queue stale keystrokes. If the CLI
            // is briefly slow, drop the frame rather than back-pressuring.
            cliSocket.volatile.emit('pty-input', { sessionId, ptyId, data: data.data });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in pty-input: ${error}`);
        }
    });

    // --- CLI → App (output) ---
    socket.on('pty-output', async (data: any) => {
        try {
            if (!data || typeof data !== 'object') {
                return;
            }
            const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
            const ptyId = typeof data.ptyId === 'string' ? data.ptyId : null;
            if (!sessionId || !ptyId) {
                return;
            }

            // Only the CLI/daemon socket attached to this scope may emit output.
            // Both session-scoped and machine-scoped sockets pin their id at
            // handshake time, so authorizing is a cheap comparison.
            if (!isScopeOwnerSocket(connection, sessionId)) {
                return;
            }

            broadcastToSessionApps(io, userId, sessionId, 'pty-output', {
                sessionId,
                ptyId,
                data: data.data,
                ...(data.reliable === true ? { reliable: true } : {})
            }, /* skip */ socket);
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in pty-output: ${error}`);
        }
    });

    // --- CLI → App (exit) ---
    socket.on('pty-exit', async (data: any) => {
        try {
            if (!data || typeof data !== 'object') {
                return;
            }
            const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
            const ptyId = typeof data.ptyId === 'string' ? data.ptyId : null;
            const exitCode = typeof data.exitCode === 'number' ? data.exitCode : null;
            if (!sessionId || !ptyId) {
                return;
            }

            if (!isScopeOwnerSocket(connection, sessionId)) {
                return;
            }

            broadcastToSessionApps(io, userId, sessionId, 'pty-exit', {
                sessionId,
                ptyId,
                exitCode,
                ...(data.reliable === true ? { reliable: true } : {})
            }, /* skip */ socket);
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in pty-exit: ${error}`);
        }
    });
}

/** True when this socket is the CLI/daemon that owns the PTY scope — either a
 *  session-scoped socket for a session id, or a machine-scoped socket for a
 *  machine id (the `happy ssh` path). */
function isScopeOwnerSocket(connection: ClientConnection, scopeId: string): boolean {
    if (connection.connectionType === 'session-scoped') {
        return connection.sessionId === scopeId;
    }
    if (connection.connectionType === 'machine-scoped') {
        return connection.machineId === scopeId;
    }
    return false;
}

/** Machine PTY scopes are owner-only: no sharing model exists for machines. */
async function isOwnedMachine(userId: string, machineId: string): Promise<boolean> {
    const machine = await db.machine.findFirst({
        where: { id: machineId, accountId: userId },
        select: { id: true }
    });
    return !!machine;
}

/**
 * Resolve the session's owning account so we can look up its rpcListeners.
 * Caller is guaranteed to have access (we checked first), so this is purely
 * about finding the canonical rpcListeners map.
 */
async function resolveOwnerId(sessionId: string, fallbackUserId: string): Promise<string> {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { accountId: true }
    });
    return session?.accountId ?? fallbackUserId;
}

/**
 * Broadcast a non-RPC PTY frame to every app socket interested in the
 * session — the owner's user-scoped + matching session-scoped sockets,
 * plus the same for shared users. Uses volatile emit because frames are
 * fire-and-forget; if a client is briefly slow, dropping is preferable
 * to head-of-line blocking on terminal output.
 */
function broadcastToSessionApps(
    _io: Server,
    ownerId: string,
    sessionId: string,
    eventName: 'pty-output' | 'pty-exit',
    payload: { sessionId: string; ptyId: string; [k: string]: any },
    skipSocket?: Socket
): void {
    // 1. Owner's connections.
    emitToSessionInterested(ownerId, sessionId, eventName, payload, skipSocket);

    // 2. Shared users — we deliberately fire-and-forget the share lookup.
    //    The common case is an owner-only session; the share fan-out only
    //    matters when a session is shared, and even then we don't want to
    //    block the output stream on a DB roundtrip per frame. We use
    //    setImmediate to detach the shared lookup from the hot path.
    void deliverToSharedUsers(sessionId, eventName, payload);
}

function emitToSessionInterested(
    userId: string,
    sessionId: string,
    eventName: 'pty-output' | 'pty-exit',
    payload: object,
    skipSocket?: Socket
): void {
    const connections = eventRouter.getConnections(userId);
    if (!connections) {
        return;
    }
    for (const conn of connections) {
        if (skipSocket && conn.socket === skipSocket) {
            continue;
        }
        // Same filter logic as 'all-interested-in-session' in eventRouter:
        // session-scoped only if sessionId matches, machine-scoped never,
        // user-scoped always.
        if (conn.connectionType === 'session-scoped') {
            if (conn.sessionId !== sessionId) {
                continue;
            }
        } else if (conn.connectionType === 'machine-scoped') {
            continue;
        }
        // Terminal frames stay volatile: when a client cannot keep up, stale
        // bytes are noise and queueing them only delays the live ones. A
        // streamed command is the opposite — a dropped frame truncates its
        // output, and a dropped exit leaves the caller waiting forever.
        if ((payload as { reliable?: boolean }).reliable) {
            conn.socket.emit(eventName, payload);
        } else {
            conn.socket.volatile.emit(eventName, payload);
        }
    }
}

async function deliverToSharedUsers(
    sessionId: string,
    eventName: 'pty-output' | 'pty-exit',
    payload: object
): Promise<void> {
    try {
        const shares = await db.sessionShare.findMany({
            where: { sessionId },
            select: { sharedWithUserId: true }
        });
        for (const share of shares) {
            emitToSessionInterested(share.sharedWithUserId, sessionId, eventName, payload);
        }
    } catch (error) {
        log({ module: 'websocket', level: 'error' }, `Error fanning out pty frame to shared users: ${error}`);
    }
}
