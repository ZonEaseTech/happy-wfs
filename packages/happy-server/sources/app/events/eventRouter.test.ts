import { describe, expect, it, vi } from 'vitest';
import { db } from '@/storage/db';
import type { ClientConnection } from './eventRouter';

vi.mock('@/storage/files', () => ({
    getPublicUrl: vi.fn(() => ''),
}));
vi.mock('@/storage/db', () => ({
    db: {
        sessionShare: { findMany: vi.fn(async () => []) },
    },
}));
vi.mock('@/storage/seq', () => ({
    allocateUserSeq: vi.fn(async () => 1),
}));

function socket() {
    return { emit: vi.fn() } as any;
}

describe('eventRouter session delivery', () => {
    it('delivers app-origin user messages to user clients plus only one session-scoped CLI', async () => {
        const { eventRouter } = await import('./eventRouter');
        const userId = `user-${Date.now()}-${Math.random()}`;
        const sessionId = 'session-a';
        const userSocket = socket();
        const oldCliSocket = socket();
        const latestCliSocket = socket();
        const otherSessionSocket = socket();

        const connections: ClientConnection[] = [
            { connectionType: 'user-scoped', userId, socket: userSocket },
            { connectionType: 'session-scoped', userId, sessionId, socket: oldCliSocket, supportsMessageReceipt: true },
            { connectionType: 'session-scoped', userId, sessionId, socket: latestCliSocket, supportsMessageReceipt: true },
            { connectionType: 'session-scoped', userId, sessionId: 'other-session', socket: otherSessionSocket, supportsMessageReceipt: true },
        ];

        for (const connection of connections) {
            eventRouter.addConnection(userId, connection);
        }

        try {
            const stats = eventRouter.emitUpdate({
                userId,
                payload: { id: 'u1', seq: 1, body: { t: 'new-message' }, createdAt: 1 },
                recipientFilter: { type: 'all-interested-in-session-single-cli', sessionId },
            });

            expect(stats).toEqual({ total: 2, sessionScoped: 1 });
            expect(userSocket.emit).toHaveBeenCalledTimes(1);
            expect(oldCliSocket.emit).not.toHaveBeenCalled();
            expect(latestCliSocket.emit).toHaveBeenCalledTimes(1);
            expect(otherSessionSocket.emit).not.toHaveBeenCalled();
        } finally {
            for (const connection of connections) {
                eventRouter.removeConnection(userId, connection);
            }
        }
    });

    it('does not route app-origin user messages to a session viewer instead of the CLI', async () => {
        const { eventRouter } = await import('./eventRouter');
        const userId = `user-${Date.now()}-${Math.random()}`;
        const sessionId = 'session-viewer-after-cli';
        const userSocket = socket();
        const cliSocket = socket();
        const viewerSocket = socket();

        const connections: ClientConnection[] = [
            { connectionType: 'user-scoped', userId, socket: userSocket },
            { connectionType: 'session-scoped', userId, sessionId, socket: cliSocket, supportsMessageReceipt: true },
            { connectionType: 'session-scoped', userId, sessionId, socket: viewerSocket, supportsMessageReceipt: false },
        ];

        for (const connection of connections) {
            eventRouter.addConnection(userId, connection);
        }

        try {
            const stats = eventRouter.emitUpdate({
                userId,
                payload: { id: 'u1', seq: 1, body: { t: 'new-message' }, createdAt: 1 },
                recipientFilter: { type: 'all-interested-in-session-single-cli', sessionId },
            });

            expect(stats).toEqual({ total: 2, sessionScoped: 1 });
            expect(userSocket.emit).toHaveBeenCalledTimes(1);
            expect(cliSocket.emit).toHaveBeenCalledTimes(1);
            expect(viewerSocket.emit).not.toHaveBeenCalled();
        } finally {
            for (const connection of connections) {
                eventRouter.removeConnection(userId, connection);
            }
        }
    });

    it('falls back to the newest legacy session-scoped client when no receipt-capable CLI is connected', async () => {
        const { eventRouter } = await import('./eventRouter');
        const userId = `user-${Date.now()}-${Math.random()}`;
        const sessionId = 'session-legacy-cli';
        const userSocket = socket();
        const staleLegacySocket = socket();
        const latestLegacySocket = socket();
        const otherSessionSocket = socket();

        const connections: ClientConnection[] = [
            { connectionType: 'user-scoped', userId, socket: userSocket },
            { connectionType: 'session-scoped', userId, sessionId, socket: staleLegacySocket, supportsMessageReceipt: false },
            { connectionType: 'session-scoped', userId, sessionId, socket: latestLegacySocket, supportsMessageReceipt: false },
            { connectionType: 'session-scoped', userId, sessionId: 'other-session', socket: otherSessionSocket, supportsMessageReceipt: false },
        ];

        for (const connection of connections) {
            eventRouter.addConnection(userId, connection);
        }

        try {
            const stats = eventRouter.emitUpdate({
                userId,
                payload: { id: 'u1', seq: 1, body: { t: 'new-message' }, createdAt: 1 },
                recipientFilter: { type: 'all-interested-in-session-single-cli', sessionId },
            });

            expect(stats).toEqual({ total: 2, sessionScoped: 1 });
            expect(userSocket.emit).toHaveBeenCalledTimes(1);
            expect(staleLegacySocket.emit).not.toHaveBeenCalled();
            expect(latestLegacySocket.emit).toHaveBeenCalledTimes(1);
            expect(otherSessionSocket.emit).not.toHaveBeenCalled();
        } finally {
            for (const connection of connections) {
                eventRouter.removeConnection(userId, connection);
            }
        }
    });

    it('does not deliver shared session user messages to shared users session-scoped agents', async () => {
        const { eventRouter } = await import('./eventRouter');
        const ownerId = `owner-${Date.now()}-${Math.random()}`;
        const sharedUserId = `shared-${Date.now()}-${Math.random()}`;
        const sessionId = 'session-shared-single-agent';
        const ownerUserSocket = socket();
        const ownerCliSocket = socket();
        const sharedUserSocket = socket();
        const sharedCliSocket = socket();

        vi.mocked(db.sessionShare.findMany).mockResolvedValueOnce([
            { sharedWithUserId: sharedUserId },
        ] as any);

        const connections: ClientConnection[] = [
            { connectionType: 'user-scoped', userId: ownerId, socket: ownerUserSocket },
            { connectionType: 'session-scoped', userId: ownerId, sessionId, socket: ownerCliSocket, supportsMessageReceipt: true },
            { connectionType: 'user-scoped', userId: sharedUserId, socket: sharedUserSocket },
            { connectionType: 'session-scoped', userId: sharedUserId, sessionId, socket: sharedCliSocket, supportsMessageReceipt: true },
        ];

        for (const connection of connections) {
            eventRouter.addConnection(connection.userId, connection);
        }

        try {
            const result = await eventRouter.emitToSessionSubscribers({
                ownerId,
                sessionId,
                buildPayload: (_uid, seq) => ({ id: `u${seq}`, seq, body: { t: 'new-message' }, createdAt: 1 }),
                recipientFilter: { type: 'all-interested-in-session-single-cli', sessionId },
            });

            expect(result.ownerDelivery).toEqual({ total: 2, sessionScoped: 1 });
            expect(ownerUserSocket.emit).toHaveBeenCalledTimes(1);
            expect(ownerCliSocket.emit).toHaveBeenCalledTimes(1);
            expect(sharedUserSocket.emit).toHaveBeenCalledTimes(1);
            expect(sharedCliSocket.emit).not.toHaveBeenCalled();
        } finally {
            for (const connection of connections) {
                eventRouter.removeConnection(connection.userId, connection);
            }
        }
    });
});
