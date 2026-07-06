import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const { dbMock, chatImageUploadMock } = vi.hoisted(() => ({
    dbMock: {
        session: {
            findFirst: vi.fn(async (_args: any) => null as unknown),
        },
    },
    chatImageUploadMock: vi.fn(async () => ({
        url: 'https://files.example.com/img.jpg',
        path: 'public/users/u/chat/s/img.jpg',
        width: 10,
        height: 10,
        thumbhash: 'hash',
        mimeType: 'image/jpeg',
    })),
}));

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/chat/chatImageUpload', () => ({ chatImageUpload: chatImageUploadMock }));

import { chatRoutes } from './chatRoutes';

async function createApp(userId = 'user-1') {
    const app = fastify();
    await app.register(import('@fastify/multipart'));
    const typed = app as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });
    chatRoutes(typed);
    await typed.ready();
    return typed;
}

function multipartBody(sessionId: string): { payload: Buffer; headers: Record<string, string> } {
    const boundary = 'testboundary';
    const payload = Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="image.png"',
        'Content-Type: image/png',
        '',
        'fake-png-bytes',
        `--${boundary}`,
        'Content-Disposition: form-data; name="sessionId"',
        '',
        sessionId,
        `--${boundary}--`,
        '',
    ].join('\r\n'));
    return {
        payload,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
}

describe('chatRoutes upload-image', () => {
    let app: Fastify;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('authorizes owners and shared users via the same session access filter', async () => {
        dbMock.session.findFirst.mockResolvedValue({ id: 'session-1' });
        const { payload, headers } = multipartBody('session-1');

        const res = await app.inject({ method: 'POST', url: '/v1/chat/upload-image', payload, headers });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: expect.objectContaining({ url: expect.any(String) }) });
        expect(dbMock.session.findFirst).toHaveBeenCalledWith({
            where: {
                id: 'session-1',
                OR: [
                    { accountId: 'user-1' },
                    { shares: { some: { sharedWithUserId: 'user-1' } } },
                ],
            },
            select: { id: true },
        });
        expect(chatImageUploadMock).toHaveBeenCalledWith('user-1', 'session-1', expect.any(Buffer), 'image/png');
    });

    it('returns 404 when the session is neither owned nor shared', async () => {
        dbMock.session.findFirst.mockResolvedValue(null);
        const { payload, headers } = multipartBody('session-1');

        const res = await app.inject({ method: 'POST', url: '/v1/chat/upload-image', payload, headers });

        expect(res.statusCode).toBe(404);
        expect(chatImageUploadMock).not.toHaveBeenCalled();
    });
});
