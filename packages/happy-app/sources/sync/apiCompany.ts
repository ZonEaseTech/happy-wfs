import type { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import {
    CompanyInviteAcceptResponseSchema,
    CompanyInviteCreateResponseSchema,
    CompanyInvitesResponseSchema,
    CompanyMembersResponseSchema,
    CompanyOverviewResponseSchema,
    CompanyUpdateResponseSchema,
    type CompanyInviteAcceptResponse,
    type CompanyInviteCreateResponse,
    type CompanyOverviewResponse,
    type CompanyRole,
    type CompanyUpdateResponse,
    type CompanyMembersResponse,
    type CompanyInvitesResponse,
} from './companyTypes';

function apiUrl(path: string) {
    return `${getServerUrl().replace(/\/+$/, '')}${path}`;
}

function authHeaders(credentials: AuthCredentials) {
    return { Authorization: `Bearer ${credentials.token}` };
}

function jsonHeaders(credentials: AuthCredentials) {
    return { ...authHeaders(credentials), 'Content-Type': 'application/json' };
}

async function parseJson<T>(response: Response, schema: { parse(value: unknown): T }, message: string): Promise<T> {
    if (!response.ok) {
        throw new Error(`${message}: ${response.status}`);
    }
    return schema.parse(await response.json());
}

export function buildCompanyInviteUrl(appOrigin: string, token: string) {
    if (appOrigin.endsWith('://')) {
        return `${appOrigin}company/join/${encodeURIComponent(token)}`;
    }
    return `${appOrigin.replace(/\/+$/, '')}/company/join/${encodeURIComponent(token)}`;
}

export async function getCompanyOverview(credentials: AuthCredentials): Promise<CompanyOverviewResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company'), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyOverviewResponseSchema,
        'Failed to get company overview'
    ));
}

export async function updateCompanyProfile(credentials: AuthCredentials, input: { name?: string; slug?: string }): Promise<CompanyUpdateResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company'), { method: 'PATCH', headers: jsonHeaders(credentials), body: JSON.stringify(input) }),
        CompanyUpdateResponseSchema,
        'Failed to update company'
    ));
}

export async function listCompanyMembers(credentials: AuthCredentials, options: { query?: string; limit?: number } = {}): Promise<CompanyMembersResponse> {
    const params = new URLSearchParams();
    if (options.query) params.set('query', options.query);
    if (options.limit) params.set('limit', String(options.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return backoff(async () => parseJson(
        await fetch(apiUrl(`/v1/company/members${suffix}`), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyMembersResponseSchema,
        'Failed to list company members'
    ));
}

export async function updateCompanyMember(credentials: AuthCredentials, accountId: string, input: { role?: CompanyRole; remove?: boolean }) {
    const response = await fetch(apiUrl(`/v1/company/members/${encodeURIComponent(accountId)}`), {
        method: 'PATCH',
        headers: jsonHeaders(credentials),
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        throw new Error(`Failed to update company member: ${response.status}`);
    }
    return response.json();
}

export async function listCompanyInvites(credentials: AuthCredentials): Promise<CompanyInvitesResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites'), { method: 'GET', headers: authHeaders(credentials) }),
        CompanyInvitesResponseSchema,
        'Failed to list company invites'
    ));
}

export async function createCompanyInvite(credentials: AuthCredentials, input: { role?: CompanyRole; expiresAt?: number; maxUses?: number }): Promise<CompanyInviteCreateResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites'), { method: 'POST', headers: jsonHeaders(credentials), body: JSON.stringify(input) }),
        CompanyInviteCreateResponseSchema,
        'Failed to create company invite'
    ));
}

export async function revokeCompanyInvite(credentials: AuthCredentials, inviteId: string) {
    const response = await fetch(apiUrl(`/v1/company/invites/${encodeURIComponent(inviteId)}`), {
        method: 'DELETE',
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        throw new Error(`Failed to revoke company invite: ${response.status}`);
    }
    return response.json();
}

export async function acceptCompanyInvite(credentials: AuthCredentials, token: string): Promise<CompanyInviteAcceptResponse> {
    return backoff(async () => parseJson(
        await fetch(apiUrl('/v1/company/invites/accept'), {
            method: 'POST',
            headers: jsonHeaders(credentials),
            body: JSON.stringify({ token }),
        }),
        CompanyInviteAcceptResponseSchema,
        'Failed to accept company invite'
    ));
}
