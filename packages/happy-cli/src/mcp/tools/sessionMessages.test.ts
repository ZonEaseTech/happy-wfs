import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    axiosGetMock,
    fetchSessionByIdMock,
    decryptMessageMock,
} = vi.hoisted(() => ({
    axiosGetMock: vi.fn(),
    fetchSessionByIdMock: vi.fn(),
    decryptMessageMock: vi.fn((raw: any) => raw.decrypted),
}));

vi.mock('axios', () => ({
    default: {
        get: axiosGetMock,
    },
}));

vi.mock('../sessionFetch', () => ({
    fetchSessionById: fetchSessionByIdMock,
}));

vi.mock('../messageDecrypt', () => ({
    decryptMessage: decryptMessageMock,
}));

import { runSessionMessages } from './sessionMessages';

describe('runSessionMessages', () => {
    beforeEach(() => {
        axiosGetMock.mockReset();
        fetchSessionByIdMock.mockReset();
        decryptMessageMock.mockClear();

        fetchSessionByIdMock.mockResolvedValue({
            id: 'session-1',
            encryptionKey: new Uint8Array([1]),
            encryptionVariant: 'legacy',
        });
        axiosGetMock.mockResolvedValue({
            data: {
                hasMore: false,
                messages: [
                    {
                        decrypted: {
                            id: 'm1',
                            seq: 1,
                            role: 'user',
                            content: { type: 'text', text: '@BenDaye please inspect' },
                            meta: { humanOnly: true, skipAiContext: true },
                            sentBy: null,
                            sentByName: null,
                            createdAt: 1000,
                            updatedAt: 1000,
                        },
                    },
                    {
                        decrypted: {
                            id: 'm2',
                            seq: 2,
                            role: 'user',
                            content: { type: 'text', text: 'normal prompt' },
                            meta: null,
                            sentBy: null,
                            sentByName: null,
                            createdAt: 2000,
                            updatedAt: 2000,
                        },
                    },
                ],
            },
        });
    });

    it('filters human-only collaboration notes by default', async () => {
        const result = await runSessionMessages({ token: 'token' } as never, {
            sessionId: 'session-1',
        });

        expect(result.messages.map((message) => message.seq)).toEqual([2]);
        expect(result.nextBeforeSeq).toBe(2);
        expect(result.nextAfterSeq).toBe(2);
    });

    it('can include human-only collaboration notes when explicitly requested', async () => {
        const result = await runSessionMessages({ token: 'token' } as never, {
            sessionId: 'session-1',
            includeHumanOnly: true,
        });

        expect(result.messages.map((message) => message.seq)).toEqual([1, 2]);
        expect(result.nextBeforeSeq).toBe(1);
        expect(result.nextAfterSeq).toBe(2);
    });
});
