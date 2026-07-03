import { CompanyRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, dbMock, resetState } = vi.hoisted(() => {
    type AccountRow = {
        id: string;
        publicKey: string;
        firstName: string | null;
        lastName: string | null;
        username: string | null;
        avatar: unknown;
        createdAt: Date;
        updatedAt: Date;
    };
    type CompanyRow = { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date };
    type MembershipRow = { companyId: string; accountId: string; role: any; joinedAt: Date; createdAt: Date; updatedAt: Date };
    type InviteRow = {
        id: string;
        companyId: string;
        tokenHash: string;
        role: any;
        createdByUserId: string;
        expiresAt: Date | null;
        maxUses: number | null;
        useCount: number;
        revokedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    };

    const state = {
        companies: [] as CompanyRow[],
        memberships: [] as MembershipRow[],
        invites: [] as InviteRow[],
        accounts: [] as AccountRow[],
        nextInvite: 1,
    };

    const withAccount = (membership: MembershipRow) => ({
        ...membership,
        account: state.accounts.find((account) => account.id === membership.accountId)!,
    });
    const withInviteRelations = (invite: InviteRow, include?: any) => ({
        ...invite,
        ...(include?.createdByUser ? { createdByUser: state.accounts.find((account) => account.id === invite.createdByUserId) || null } : {}),
        ...(include?.company ? { company: state.companies.find((company) => company.id === invite.companyId)! } : {}),
    });

    const resetState = () => {
        state.companies = [{ id: 'company_default', name: 'Happy Company', slug: 'default', createdAt: new Date(0), updatedAt: new Date(0) }];
        state.accounts = [];
        state.memberships = [];
        state.invites = [];
        state.nextInvite = 1;
    };

    const dbMock = {
        company: {
            findUnique: vi.fn(async (args: any) => state.companies.find((company) => company.id === args.where.id) || null),
            create: vi.fn(async (args: any) => {
                const company = { ...args.data, createdAt: new Date(0), updatedAt: new Date(0) };
                state.companies.push(company);
                return company;
            }),
            update: vi.fn(async (args: any) => {
                const company = state.companies.find((item) => item.id === args.where.id)!;
                Object.assign(company, args.data, { updatedAt: new Date(10) });
                return company;
            }),
        },
        companyMembership: {
            findUnique: vi.fn(async (args: any) => {
                const key = args.where.companyId_accountId;
                return state.memberships.find((membership) => membership.companyId === key.companyId && membership.accountId === key.accountId) || null;
            }),
            findMany: vi.fn(async (args: any) => {
                let rows = state.memberships.filter((membership) => membership.companyId === args.where.companyId);
                const query = args.where.account?.OR?.[0]?.username?.contains;
                if (query) {
                    const lower = query.toLowerCase();
                    rows = rows.filter((membership) => {
                        const account = state.accounts.find((item) => item.id === membership.accountId);
                        return [account?.username, account?.firstName, account?.lastName].some((value) => value?.toLowerCase().includes(lower));
                    });
                }
                rows = [...rows].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).slice(0, args.take ?? rows.length);
                return args.include?.account ? rows.map(withAccount) : rows;
            }),
            count: vi.fn(async (args: any) => state.memberships.filter((membership) => (
                membership.companyId === args.where.companyId && (!args.where.role || membership.role === args.where.role)
            )).length),
            update: vi.fn(async (args: any) => {
                const key = args.where.companyId_accountId;
                const membership = state.memberships.find((item) => item.companyId === key.companyId && item.accountId === key.accountId)!;
                Object.assign(membership, args.data, { updatedAt: new Date(10) });
                return membership;
            }),
            delete: vi.fn(async (args: any) => {
                const key = args.where.companyId_accountId;
                const index = state.memberships.findIndex((item) => item.companyId === key.companyId && item.accountId === key.accountId);
                const [removed] = state.memberships.splice(index, 1);
                return removed;
            }),
            create: vi.fn(async (args: any) => {
                const membership = { ...args.data, joinedAt: new Date(20), createdAt: new Date(20), updatedAt: new Date(20) };
                state.memberships.push(membership);
                return membership;
            }),
            upsert: vi.fn(),
        },
        companyInvite: {
            create: vi.fn(async (args: any) => {
                const invite = {
                    id: `invite-${state.nextInvite++}`,
                    companyId: args.data.companyId,
                    tokenHash: args.data.tokenHash,
                    role: args.data.role,
                    createdByUserId: args.data.createdByUserId,
                    expiresAt: args.data.expiresAt ?? null,
                    maxUses: args.data.maxUses ?? null,
                    useCount: 0,
                    revokedAt: null,
                    createdAt: new Date(30),
                    updatedAt: new Date(30),
                };
                state.invites.push(invite);
                return withInviteRelations(invite, args.include);
            }),
            findMany: vi.fn(async (args: any) => state.invites
                .filter((invite) => invite.companyId === args.where.companyId)
                .map((invite) => withInviteRelations(invite, args.include))),
            findFirst: vi.fn(async (args: any) => state.invites.find((invite) => invite.id === args.where.id && invite.companyId === args.where.companyId) || null),
            findUnique: vi.fn(async (args: any) => {
                const invite = state.invites.find((item) => item.tokenHash === args.where.tokenHash);
                return invite ? withInviteRelations(invite, args.include) : null;
            }),
            update: vi.fn(async (args: any) => {
                const invite = state.invites.find((item) => item.id === args.where.id)!;
                if (args.data.revokedAt) {
                    invite.revokedAt = args.data.revokedAt;
                }
                if (args.data.useCount?.increment) {
                    invite.useCount += args.data.useCount.increment;
                }
                invite.updatedAt = new Date(40);
                return withInviteRelations(invite, args.include);
            }),
        },
        account: {
            findMany: vi.fn(async () => state.accounts.map((account) => ({ id: account.id }))),
            findUnique: vi.fn(async (args: any) => state.accounts.find((account) => account.id === args.where.id || account.username === args.where.username) || null),
            findFirst: vi.fn(async () => state.accounts[0] ? { id: state.accounts[0].id } : null),
        },
        $transaction: vi.fn(async (callback: any) => callback(dbMock)),
    };

    return { state, dbMock, resetState };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/storage/files', () => ({ getPublicUrl: (path: string) => `https://files.example/${path}` }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import {
    acceptCompanyInvite,
    createCompanyInvite,
    getCompanyOverviewForUser,
    listCompanyMembers,
    revokeCompanyInvite,
    updateCompanyMember,
} from './companyService';

function seedAccount(id: string, role: CompanyRole) {
    const account = {
        id,
        publicKey: `${id}-pk`,
        firstName: id,
        lastName: null,
        username: id,
        avatar: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
    };
    state.accounts.push(account);
    state.memberships.push({
        companyId: 'company_default',
        accountId: id,
        role,
        joinedAt: new Date(state.memberships.length),
        createdAt: new Date(0),
        updatedAt: new Date(0),
    });
    return account;
}

describe('companyService', () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it('returns overview for a member', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(getCompanyOverviewForUser('member-1')).resolves.toMatchObject({
            company: { id: 'company_default' },
            membership: { accountId: 'member-1', role: CompanyRole.member },
            capabilities: { canManageInvites: false },
        });
    });

    it('allows members to list members', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(listCompanyMembers('member-1', {})).resolves.toHaveLength(1);
    });

    it('rejects member invite creation', async () => {
        seedAccount('member-1', CompanyRole.member);
        await expect(createCompanyInvite('member-1', {})).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows admin to create member invite', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        await expect(createCompanyInvite('admin-1', { role: CompanyRole.member })).resolves.toMatchObject({
            invite: { role: CompanyRole.member },
            token: expect.any(String),
        });
    });

    it('rejects admin owner invite creation', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        await expect(createCompanyInvite('admin-1', { role: CompanyRole.owner })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows owner to promote a member', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('owner-1', 'member-1', { role: CompanyRole.admin })).resolves.toMatchObject({ role: CompanyRole.admin });
    });

    it('rejects admin role changes', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('admin-1', 'member-1', { role: CompanyRole.admin })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows admin to remove a member', async () => {
        seedAccount('admin-1', CompanyRole.admin);
        seedAccount('member-1', CompanyRole.member);
        await expect(updateCompanyMember('admin-1', 'member-1', { remove: true })).resolves.toMatchObject({ removed: true });
    });

    it('rejects removing the last owner', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        await expect(updateCompanyMember('owner-1', 'owner-1', { remove: true })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('accepts a valid invite for a non-member', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        state.accounts.push({ id: 'new-1', publicKey: 'new-1-pk', username: 'new-1', firstName: null, lastName: null, avatar: null, createdAt: new Date(1), updatedAt: new Date(1) });
        const created = await createCompanyInvite('owner-1', {});
        await expect(acceptCompanyInvite('new-1', created.token)).resolves.toMatchObject({
            membership: { accountId: 'new-1', role: CompanyRole.member },
            alreadyMember: false,
        });
    });

    it('does not increment use count for an already-member accept', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        const created = await createCompanyInvite('owner-1', {});
        await expect(acceptCompanyInvite('owner-1', created.token)).resolves.toMatchObject({ alreadyMember: true });
        expect(state.invites[0].useCount).toBe(0);
    });

    it('rejects expired, revoked, and overused invites', async () => {
        seedAccount('owner-1', CompanyRole.owner);
        state.accounts.push({ id: 'new-1', publicKey: 'new-1-pk', username: 'new-1', firstName: null, lastName: null, avatar: null, createdAt: new Date(1), updatedAt: new Date(1) });
        state.accounts.push({ id: 'new-2', publicKey: 'new-2-pk', username: 'new-2', firstName: null, lastName: null, avatar: null, createdAt: new Date(2), updatedAt: new Date(2) });

        const expired = await createCompanyInvite('owner-1', { expiresAt: Date.now() - 1000 });
        await expect(acceptCompanyInvite('new-1', expired.token)).rejects.toMatchObject({ statusCode: 410 });

        const revoked = await createCompanyInvite('owner-1', {});
        await revokeCompanyInvite('owner-1', revoked.invite.id);
        await expect(acceptCompanyInvite('new-1', revoked.token)).rejects.toMatchObject({ statusCode: 410 });

        const overused = await createCompanyInvite('owner-1', { maxUses: 1 });
        await acceptCompanyInvite('new-1', overused.token);
        await expect(acceptCompanyInvite('new-2', overused.token)).rejects.toMatchObject({ statusCode: 410 });
    });
});
