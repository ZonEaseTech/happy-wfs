import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    acceptCompanyInvite,
    buildCompanyInviteUrl,
    createCompanyInvite,
    getCompanyOverview,
    listCompanyInvites,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
    updateCompanyProfile,
} from './apiCompany';

vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.example/api/' }));
vi.mock('@/utils/time', () => ({ backoff: <T>(callback: () => Promise<T>) => callback() }));

const credentials: AuthCredentials = { token: 'token-1', secret: 'secret-1' };

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('apiCompany', () => {
    it('fetches company overview', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            company: { id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: 1, updatedAt: 2 },
            membership: { companyId: 'company_default', accountId: 'user-1', role: 'owner', joinedAt: 1, createdAt: 1, updatedAt: 1 },
            capabilities: { canEditCompany: true, canManageMembers: true, canManageOwners: true, canManageInvites: true },
        }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getCompanyOverview(credentials)).resolves.toMatchObject({ company: { slug: 'default' } });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company', {
            method: 'GET',
            headers: { Authorization: 'Bearer token-1' },
        });
    });

    it('lists company members with query parameters', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ members: [] }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(listCompanyMembers(credentials, { query: 'ali', limit: 10 })).resolves.toEqual({ members: [] });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/members?query=ali&limit=10', {
            method: 'GET',
            headers: { Authorization: 'Bearer token-1' },
        });
    });

    it('updates company profile', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ company: { id: 'company_default', name: 'Acme', slug: 'acme', createdAt: 1, updatedAt: 2 } }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(updateCompanyProfile(credentials, { name: 'Acme' })).resolves.toMatchObject({ company: { name: 'Acme' } });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Acme' }),
        });
    });

    it('updates company member role', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ accountId: 'member-1', role: 'admin' }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(updateCompanyMember(credentials, 'member-1', { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/members/member-1', {
            method: 'PATCH',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'admin' }),
        });
    });

    it('creates an invite with authenticated JSON POST', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            invite: {
                id: 'invite-1', companyId: 'company_default', role: 'member', createdByUserId: 'user-1', createdBy: null,
                expiresAt: null, maxUses: null, useCount: 0, revokedAt: null, createdAt: 1, updatedAt: 1,
            },
            token: 'token-1',
            url: 'https://app.example/company/join/token-1',
        }, { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(createCompanyInvite(credentials, {})).resolves.toMatchObject({ token: 'token-1' });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/invites', {
            method: 'POST',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
    });

    it('lists invites and revokes an invite', async () => {
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            if (init.method === 'GET') return jsonResponse({ invites: [] });
            return jsonResponse({ invite: { id: 'invite-1' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(listCompanyInvites(credentials)).resolves.toEqual({ invites: [] });
        await expect(revokeCompanyInvite(credentials, 'invite-1')).resolves.toMatchObject({ invite: { id: 'invite-1' } });
    });

    it('accepts an invite token', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({
            company: { id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: 1, updatedAt: 1 },
            membership: { companyId: 'company_default', accountId: 'user-1', role: 'member', joinedAt: 1, createdAt: 1, updatedAt: 1 },
            alreadyMember: false,
        }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(acceptCompanyInvite(credentials, 'token-1')).resolves.toMatchObject({ alreadyMember: false });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.example/api/v1/company/invites/accept', {
            method: 'POST',
            headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'token-1' }),
        });
    });

    it('builds local invite URLs when server returns only a token', () => {
        expect(buildCompanyInviteUrl('https://app.example/', 'abc token')).toBe('https://app.example/company/join/abc%20token');
        expect(buildCompanyInviteUrl('happy://', 'abc')).toBe('happy://company/join/abc');
    });
});
