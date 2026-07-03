import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';
import { createBugShareToken } from '@/app/bugs/bugShareToken';

const serviceMock = vi.hoisted(() => ({
    findBugShareConfigByAccessCode: vi.fn(),
    getValidBugShareConfig: vi.fn(),
    listBugsForOwner: vi.fn(),
    createBugForOwner: vi.fn(),
    getBugForOwner: vi.fn(),
    addBugComment: vi.fn(),
    changeBugStatus: vi.fn(),
    recordBugAttachment: vi.fn(),
}));

vi.mock('@/app/bugs/bugService', () => serviceMock);
vi.mock('@/app/bugs/bugImageUpload', () => ({
    uploadBugImage: vi.fn(async () => ({ path: 'p', url: 'https://files/p', mimeType: 'image/png', sizeBytes: 10, width: 1, height: 1, thumbhash: null })),
}));

import { bugPublicRoutes } from './bugPublicRoutes';

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    bugPublicRoutes(typed);
    await typed.ready();
    return typed;
}

describe('bugPublicRoutes', () => {
    let app: Fastify;

    beforeEach(async () => {
        process.env.HANDY_MASTER_SECRET = 'test-secret';
        vi.clearAllMocks();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('rejects wrong access code', async () => {
        serviceMock.findBugShareConfigByAccessCode.mockResolvedValue(null);
        const res = await app.inject({ method: 'POST', url: '/v1/bug-share/login', payload: { accessCode: 'bad', nickname: '测试李' } });
        expect(res.statusCode).toBe(401);
    });

    it('returns expired when token version no longer matches', async () => {
        serviceMock.getValidBugShareConfig.mockRejectedValue(Object.assign(new Error('bug_share_expired'), { statusCode: 401 }));
        const token = createBugShareToken({ configId: 'cfg-1', ownerId: 'owner-1', nickname: '测试李', version: 1 });
        const res = await app.inject({ method: 'GET', url: '/v1/bug-share/bugs', headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'bug_share_expired' });
    });

    it('public create uses nickname from token', async () => {
        serviceMock.getValidBugShareConfig.mockResolvedValue({ id: 'cfg-1', ownerId: 'owner-1', accessCodeVersion: 2, enabled: true });
        serviceMock.createBugForOwner.mockResolvedValue({ id: 'bug-1' });
        const token = createBugShareToken({ configId: 'cfg-1', ownerId: 'owner-1', nickname: '测试李', version: 2 });
        const res = await app.inject({ method: 'POST', url: '/v1/bug-share/bugs', headers: { authorization: `Bearer ${token}` }, payload: { description: '页面空白' } });
        expect(res.statusCode).toBe(201);
        expect(serviceMock.createBugForOwner).toHaveBeenCalledWith('owner-1', { nickname: '测试李' }, { description: '页面空白', visibility: 'shared' });
    });
});
