import { describe, expect, it, vi } from 'vitest';
import type { ClientConnection } from './eventRouter';

vi.mock('@/storage/files', () => ({
    getPublicUrl: vi.fn(() => ''),
}));
vi.mock('@/storage/db', () => ({
    db: {
        sessionShare: { findMany: vi.fn(async () => []) },
    },
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

    it('falls back to legacy session-scoped clients when no receipt-capable CLI is connected', async () => {
        const { eventRouter } = await import('./eventRouter');
        const userId = `user-${Date.now()}-${Math.random()}`;
        const sessionId = 'session-legacy-cli';
        const userSocket = socket();
        const legacyCliSocket = socket();
        const legacyViewerSocket = socket();
        const otherSessionSocket = socket();

        const connections: ClientConnection[] = [
            { connectionType: 'user-scoped', userId, socket: userSocket },
            { connectionType: 'session-scoped', userId, sessionId, socket: legacyCliSocket, supportsMessageReceipt: false },
            { connectionType: 'session-scoped', userId, sessionId, socket: legacyViewerSocket, supportsMessageReceipt: false },
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

            expect(stats).toEqual({ total: 3, sessionScoped: 2 });
            expect(userSocket.emit).toHaveBeenCalledTimes(1);
            expect(legacyCliSocket.emit).toHaveBeenCalledTimes(1);
            expect(legacyViewerSocket.emit).toHaveBeenCalledTimes(1);
            expect(otherSessionSocket.emit).not.toHaveBeenCalled();
        } finally {
            for (const connection of connections) {
                eventRouter.removeConnection(userId, connection);
            }
        }
    });

});
