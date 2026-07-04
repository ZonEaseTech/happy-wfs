import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const serviceMock = vi.hoisted(() => ({
    listBugsForOwner: vi.fn(),
    createBugForOwner: vi.fn(),
    getBugForOwner: vi.fn(),
    updateBugContent: vi.fn(),
    addBugComment: vi.fn(),
    changeBugStatus: vi.fn(),
    createOrRotateBugShareConfig: vi.fn(),
    getBugShareConfig: vi.fn(),
    linkBugSession: vi.fn(),
    recordBugAttachment: vi.fn(),
    softDeleteBugForOwner: vi.fn(),
}));

vi.mock('@/app/bugs/bugService', () => serviceMock);
vi.mock('@/app/bugs/bugImageUpload', () => ({
    uploadBugImage: vi.fn(async () => ({ path: 'p', url: 'https://files/p', mimeType: 'image/png', sizeBytes: 10, width: 1, height: 1, thumbhash: null })),
}));

import { bugRoutes } from './bugRoutes';

async function createApp(userId = 'user-1') {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });
    bugRoutes(typed);
    await typed.ready();
    return typed;
}

describe('bugRoutes', () => {
    let app: Fastify;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /v1/bugs forwards owner and query', async () => {
        serviceMock.listBugsForOwner.mockResolvedValue({ bugs: [], pendingCount: 0 });
        const res = await app.inject({ method: 'GET', url: '/v1/bugs?query=BUG-1&limit=10' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.listBugsForOwner).toHaveBeenCalledWith('user-1', { query: 'BUG-1', limit: 10, status: undefined });
    });

    it('POST /v1/bugs rejects blank descriptions', async () => {
        const res = await app.inject({ method: 'POST', url: '/v1/bugs', payload: { description: '' } });
        expect(res.statusCode).toBe(400);
        expect(serviceMock.createBugForOwner).not.toHaveBeenCalled();
    });

    it('POST /v1/bugs forwards Tiptap contentJson for structured bug descriptions', async () => {
        const contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '页面空白' }] }] };
        serviceMock.createBugForOwner.mockResolvedValue({ id: 'bug-1' });

        const res = await app.inject({
            method: 'POST',
            url: '/v1/bugs',
            payload: { description: '页面空白', visibility: 'shared', contentJson },
        });

        expect(res.statusCode).toBe(201);
        expect(serviceMock.createBugForOwner).toHaveBeenCalledWith('user-1', { userId: 'user-1', nickname: 'Happy 用户' }, { description: '页面空白', visibility: 'shared', contentJson });
    });

    it('PATCH /v1/bugs/:bugId/status forwards return-to-pending action', async () => {
        serviceMock.changeBugStatus.mockResolvedValue({ id: 'bug-1' });
        const res = await app.inject({ method: 'PATCH', url: '/v1/bugs/bug-1/status', payload: { status: 'pending', action: 'return_to_pending' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.changeBugStatus).toHaveBeenCalledWith('user-1', 'bug-1', { userId: 'user-1', nickname: 'Happy 用户' }, { status: 'pending', action: 'return_to_pending' });
    });

    it('PATCH /v1/bugs/:bugId/content forwards edited description and contentJson', async () => {
        const contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '更新后的说明' }] }] };
        serviceMock.updateBugContent.mockResolvedValue({ id: 'bug-1' });

        const res = await app.inject({
            method: 'PATCH',
            url: '/v1/bugs/bug-1/content',
            payload: { description: '更新后的说明', contentJson },
        });

        expect(res.statusCode).toBe(200);
        expect(serviceMock.updateBugContent).toHaveBeenCalledWith('user-1', 'bug-1', { userId: 'user-1', nickname: 'Happy 用户' }, { description: '更新后的说明', contentJson });
    });

    it('DELETE /v1/bugs/:bugId soft-deletes the bug for the Happy owner', async () => {
        serviceMock.softDeleteBugForOwner.mockResolvedValue(undefined);
        const res = await app.inject({ method: 'DELETE', url: '/v1/bugs/bug-1' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.softDeleteBugForOwner).toHaveBeenCalledWith('user-1', 'bug-1', { userId: 'user-1', nickname: 'Happy 用户' });
    });

    it('GET /v1/bugs/share-config returns the current share password for owner copy-back', async () => {
        serviceMock.getBugShareConfig.mockResolvedValue({
            enabled: true,
            accessCode: 'abc123',
            accessCodeVersion: 2,
            createdAt: new Date(1000),
            updatedAt: new Date(2000),
        });

        const res = await app.inject({ method: 'GET', url: '/v1/bugs/share-config' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            shareConfig: {
                accessCode: 'abc123',
                version: 2,
            },
        });
    });
});
