import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storageMock, syncMock, sessionUpdateMetadataFieldsMock } = vi.hoisted(() => ({
    storageMock: {
        getState: vi.fn(() => ({ sessions: {} as Record<string, unknown> })),
    },
    syncMock: {
        refreshSessions: vi.fn(async () => undefined),
    },
    sessionUpdateMetadataFieldsMock: vi.fn(async () => ({ version: 2 })),
}));

vi.mock('@/sync/storage', () => ({ storage: storageMock, getSession: vi.fn() }));
vi.mock('@/sync/sync', () => ({ sync: syncMock, sessionLastViewedAt: vi.fn(() => null) }));
vi.mock('@/sync/ops', () => ({ sessionUpdateMetadataFields: sessionUpdateMetadataFieldsMock }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { copySessionMetadata } from './sessionUtils';

const originalSession = {
    metadata: {
        externalContext: { source: 'github', resourceType: 'issue', resourceId: 'org/repo#759' },
        sessionIcon: null,
    },
} as never;

function seedNewSession(metadataVersion = 1) {
    storageMock.getState.mockReturnValue({
        sessions: {
            'new-session': { metadata: { path: '/tmp' }, metadataVersion },
        },
    });
}

describe('copySessionMetadata', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        storageMock.getState.mockReturnValue({ sessions: {} });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does nothing when the original session has no externalContext or icon', async () => {
        await copySessionMetadata({ metadata: {} } as never, 'new-session');
        expect(sessionUpdateMetadataFieldsMock).not.toHaveBeenCalled();
    });

    it('writes immediately when the new session is already in storage', async () => {
        seedNewSession();

        await copySessionMetadata(originalSession, 'new-session');

        expect(sessionUpdateMetadataFieldsMock).toHaveBeenCalledTimes(1);
        expect(sessionUpdateMetadataFieldsMock).toHaveBeenCalledWith(
            'new-session',
            { path: '/tmp' },
            { externalContext: { source: 'github', resourceType: 'issue', resourceId: 'org/repo#759' } },
            1,
        );
    });

    it('returns without blocking and keeps retrying until the session registers', async () => {
        await copySessionMetadata(originalSession, 'new-session');
        // Returned while nothing was written — navigation is not blocked.
        expect(sessionUpdateMetadataFieldsMock).not.toHaveBeenCalled();

        // Session shows up a few seconds later (cold CLI boot on the machine).
        await vi.advanceTimersByTimeAsync(3000);
        seedNewSession();
        await vi.advanceTimersByTimeAsync(1500);

        expect(syncMock.refreshSessions).toHaveBeenCalled();
        expect(sessionUpdateMetadataFieldsMock).toHaveBeenCalledTimes(1);
    });

    it('retries when the write throws while session encryption is not ready yet', async () => {
        seedNewSession();
        sessionUpdateMetadataFieldsMock
            .mockRejectedValueOnce(new Error('Session encryption not found'))
            .mockResolvedValueOnce({ version: 2 });

        await copySessionMetadata(originalSession, 'new-session');
        expect(sessionUpdateMetadataFieldsMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1500);
        expect(sessionUpdateMetadataFieldsMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after the retry budget without hanging forever', async () => {
        await copySessionMetadata(originalSession, 'new-session');

        await vi.advanceTimersByTimeAsync(8 * 1500 + 100);

        expect(sessionUpdateMetadataFieldsMock).not.toHaveBeenCalled();
        // 8 background attempts, each preceded by a refresh.
        expect(syncMock.refreshSessions).toHaveBeenCalledTimes(8);
    });
});
