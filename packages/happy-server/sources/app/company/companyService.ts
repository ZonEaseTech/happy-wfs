import { CompanyRole } from '@prisma/client';
import { db } from '@/storage/db';
import { DEFAULT_COMPANY_ID, ensureDefaultCompanyMemberships } from './companyBootstrap';
import { createInviteToken, hashInviteToken } from './companyTokens';
import { formatCompany, formatCompanyInvite, formatCompanyMember, formatCompanyOverview, formatMembership } from './companyPresenter';

export class CompanyServiceError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message);
    }
}

function forbidden(message = 'Forbidden'): never {
    throw new CompanyServiceError(403, message);
}

function notFound(message = 'Not found'): never {
    throw new CompanyServiceError(404, message);
}

function gone(message = 'Invite is no longer valid'): never {
    throw new CompanyServiceError(410, message);
}

function conflict(message: string): never {
    throw new CompanyServiceError(409, message);
}

async function getDefaultCompanyOrCreate() {
    const company = await db.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
    if (company) {
        return company;
    }
    return ensureDefaultCompanyMemberships();
}

async function getMembershipOrThrow(accountId: string) {
    const company = await getDefaultCompanyOrCreate();
    const membership = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId: company.id, accountId } },
    });
    if (!membership) {
        forbidden('Account is not a company member');
    }
    return { company, membership };
}

async function assertNotLastOwner(companyId: string, accountId: string) {
    const target = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId, accountId } },
    });
    if (target?.role !== CompanyRole.owner) {
        return;
    }
    const ownerCount = await db.companyMembership.count({ where: { companyId, role: CompanyRole.owner } });
    if (ownerCount <= 1) {
        conflict('Cannot remove or demote the last owner');
    }
}

export async function getCompanyOverviewForUser(accountId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    return formatCompanyOverview(company, membership);
}

export async function listCompanyMembers(accountId: string, options: { query?: string; limit?: number }) {
    const { company } = await getMembershipOrThrow(accountId);
    const query = options.query?.trim();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
    const members = await db.companyMembership.findMany({
        where: {
            companyId: company.id,
            ...(query ? {
                account: {
                    OR: [
                        { username: { contains: query, mode: 'insensitive' as const } },
                        { firstName: { contains: query, mode: 'insensitive' as const } },
                        { lastName: { contains: query, mode: 'insensitive' as const } },
                    ],
                },
            } : {}),
        },
        include: { account: true },
        orderBy: [{ role: 'asc' as const }, { joinedAt: 'asc' as const }],
        take: limit,
    });
    return members.map(formatCompanyMember);
}

export async function updateCompanyProfile(accountId: string, body: { name?: string; slug?: string }) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const name = body.name?.trim();
    const slug = body.slug?.trim().toLowerCase();
    const updated = await db.company.update({
        where: { id: company.id },
        data: {
            ...(name ? { name } : {}),
            ...(slug ? { slug } : {}),
        },
    });
    return formatCompany(updated);
}

export async function updateCompanyMember(actorAccountId: string, targetAccountId: string, body: { role?: CompanyRole; remove?: boolean }) {
    const { company, membership: actor } = await getMembershipOrThrow(actorAccountId);
    if (actor.role !== CompanyRole.owner && actor.role !== CompanyRole.admin) {
        forbidden();
    }
    const target = await db.companyMembership.findUnique({
        where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
    });
    if (!target) {
        notFound('Company member not found');
    }

    if (body.remove) {
        if (actor.role === CompanyRole.admin && target.role !== CompanyRole.member) {
            forbidden('Admins can only remove members');
        }
        await assertNotLastOwner(company.id, targetAccountId);
        await db.companyMembership.delete({
            where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
        });
        return { removed: true as const };
    }

    if (!body.role) {
        return formatMembership(target);
    }
    if (actor.role !== CompanyRole.owner) {
        forbidden('Only owners can change roles');
    }
    if (target.role === CompanyRole.owner && body.role !== CompanyRole.owner) {
        await assertNotLastOwner(company.id, targetAccountId);
    }
    const updated = await db.companyMembership.update({
        where: { companyId_accountId: { companyId: company.id, accountId: targetAccountId } },
        data: { role: body.role },
    });
    return formatMembership(updated);
}

export async function listCompanyInvites(accountId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const invites = await db.companyInvite.findMany({
        where: { companyId: company.id },
        include: { createdByUser: true },
        orderBy: { createdAt: 'desc' },
    });
    return invites.map(formatCompanyInvite);
}

function normalizeInviteRole(actorRole: CompanyRole, requestedRole?: CompanyRole) {
    const role = requestedRole ?? CompanyRole.member;
    if (actorRole === CompanyRole.admin && role !== CompanyRole.member) {
        forbidden('Admins can only create member invites');
    }
    return role;
}

export async function createCompanyInvite(accountId: string, body: { role?: CompanyRole; expiresAt?: number; maxUses?: number }) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const token = createInviteToken();
    const invite = await db.companyInvite.create({
        data: {
            companyId: company.id,
            tokenHash: hashInviteToken(token),
            role: normalizeInviteRole(membership.role, body.role),
            createdByUserId: accountId,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            maxUses: typeof body.maxUses === 'number' ? body.maxUses : null,
        },
        include: { createdByUser: true },
    });
    return {
        invite: formatCompanyInvite(invite),
        token,
    };
}

export async function revokeCompanyInvite(accountId: string, inviteId: string) {
    const { company, membership } = await getMembershipOrThrow(accountId);
    if (membership.role !== CompanyRole.owner && membership.role !== CompanyRole.admin) {
        forbidden();
    }
    const invite = await db.companyInvite.findFirst({ where: { id: inviteId, companyId: company.id } });
    if (!invite) {
        notFound('Company invite not found');
    }
    const updated = await db.companyInvite.update({
        where: { id: inviteId },
        data: { revokedAt: new Date() },
        include: { createdByUser: true },
    });
    return formatCompanyInvite(updated);
}

export async function acceptCompanyInvite(accountId: string, token: string) {
    return db.$transaction(async (tx) => {
        const tokenHash = hashInviteToken(token);
        const invite = await tx.companyInvite.findUnique({
            where: { tokenHash },
            include: { company: true },
        });
        if (!invite) {
            notFound('Company invite not found');
        }
        if (invite.revokedAt || (invite.expiresAt && invite.expiresAt.getTime() <= Date.now())) {
            gone();
        }
        if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
            gone();
        }

        const existing = await tx.companyMembership.findUnique({
            where: { companyId_accountId: { companyId: invite.companyId, accountId } },
        });
        if (existing) {
            return {
                company: formatCompany(invite.company),
                membership: formatMembership(existing),
                alreadyMember: true,
            };
        }

        const membership = await tx.companyMembership.create({
            data: {
                companyId: invite.companyId,
                accountId,
                role: invite.role,
            },
        });
        await tx.companyInvite.update({
            where: { id: invite.id },
            data: { useCount: { increment: 1 } },
        });
        return {
            company: formatCompany(invite.company),
            membership: formatMembership(membership),
            alreadyMember: false,
        };
    });
}
