import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fastify } from '../types';

const serviceMock = vi.hoisted(() => ({
    getCompanyOverviewForUser: vi.fn(),
    updateCompanyProfile: vi.fn(),
    listCompanyMembers: vi.fn(),
    updateCompanyMember: vi.fn(),
    createCompanyInvite: vi.fn(),
    listCompanyInvites: vi.fn(),
    revokeCompanyInvite: vi.fn(),
    acceptCompanyInvite: vi.fn(),
}));

vi.mock('@/app/company/companyService', () => serviceMock);

import { companyRoutes } from './companyRoutes';

async function createApp(userId = 'user-1') {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any) => {
        request.userId = userId;
    });
    companyRoutes(typed);
    await typed.ready();
    return typed;
}

describe('companyRoutes', () => {
    let app: Fastify;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await createApp();
    });

    afterEach(async () => {
        await app.close();
    });

    it('GET /v1/company returns current overview', async () => {
        serviceMock.getCompanyOverviewForUser.mockResolvedValue({
            company: { id: 'company_default' },
            membership: { role: 'owner' },
            capabilities: { canManageInvites: true },
        });
        const res = await app.inject({ method: 'GET', url: '/v1/company' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.getCompanyOverviewForUser).toHaveBeenCalledWith('user-1');
        expect(res.json().company.id).toBe('company_default');
    });

    it('PATCH /v1/company forwards profile updates', async () => {
        serviceMock.updateCompanyProfile.mockResolvedValue({ id: 'company_default', name: 'Acme', slug: 'acme' });
        const res = await app.inject({ method: 'PATCH', url: '/v1/company', payload: { name: 'Acme' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.updateCompanyProfile).toHaveBeenCalledWith('user-1', { name: 'Acme' });
        expect(res.json().company.name).toBe('Acme');
    });

    it('GET /v1/company/members forwards query and limit', async () => {
        serviceMock.listCompanyMembers.mockResolvedValue([{ accountId: 'member-1', role: 'member' }]);
        const res = await app.inject({ method: 'GET', url: '/v1/company/members?query=mem&limit=10' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.listCompanyMembers).toHaveBeenCalledWith('user-1', { query: 'mem', limit: 10 });
        expect(res.json().members).toHaveLength(1);
    });

    it('PATCH /v1/company/members/:accountId forwards member updates', async () => {
        serviceMock.updateCompanyMember.mockResolvedValue({ accountId: 'member-1', role: 'admin' });
        const res = await app.inject({ method: 'PATCH', url: '/v1/company/members/member-1', payload: { role: 'admin' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.updateCompanyMember).toHaveBeenCalledWith('user-1', 'member-1', { role: 'admin' });
        expect(res.json().role).toBe('admin');
    });

    it('POST /v1/company/invites returns token and url', async () => {
        serviceMock.createCompanyInvite.mockResolvedValue({ invite: { id: 'invite-1' }, token: 'token-1234567890123456' });
        const res = await app.inject({
            method: 'POST',
            url: '/v1/company/invites',
            headers: { origin: 'https://app.example' },
            payload: {},
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ token: 'token-1234567890123456', url: 'https://app.example/company/join/token-1234567890123456' });
    });

    it('GET /v1/company/invites returns invites', async () => {
        serviceMock.listCompanyInvites.mockResolvedValue([{ id: 'invite-1' }]);
        const res = await app.inject({ method: 'GET', url: '/v1/company/invites' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.listCompanyInvites).toHaveBeenCalledWith('user-1');
        expect(res.json().invites).toHaveLength(1);
    });

    it('DELETE /v1/company/invites/:id revokes an invite', async () => {
        serviceMock.revokeCompanyInvite.mockResolvedValue({ id: 'invite-1', revokedAt: 1 });
        const res = await app.inject({ method: 'DELETE', url: '/v1/company/invites/invite-1' });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.revokeCompanyInvite).toHaveBeenCalledWith('user-1', 'invite-1');
        expect(res.json().invite.revokedAt).toBe(1);
    });

    it('POST /v1/company/invites/accept forwards token acceptance', async () => {
        serviceMock.acceptCompanyInvite.mockResolvedValue({ alreadyMember: false, company: { id: 'company_default' }, membership: { accountId: 'user-1' } });
        const res = await app.inject({ method: 'POST', url: '/v1/company/invites/accept', payload: { token: 'token-1234567890123456' } });
        expect(res.statusCode).toBe(200);
        expect(serviceMock.acceptCompanyInvite).toHaveBeenCalledWith('user-1', 'token-1234567890123456');
        expect(res.json().alreadyMember).toBe(false);
    });

    it('maps service errors to response status codes', async () => {
        serviceMock.listCompanyInvites.mockRejectedValue({ statusCode: 403, message: 'Forbidden' });
        const res = await app.inject({ method: 'GET', url: '/v1/company/invites' });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Forbidden' });
    });
});
