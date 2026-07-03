import type { Account, Company, CompanyInvite, CompanyMembership } from '@prisma/client';
import { getPublicUrl } from '@/storage/files';
import { getCompanyCapabilities } from './companyTypes';

type AvatarJson = {
    path?: string;
    url?: string;
    width?: number;
    height?: number;
    thumbhash?: string;
};

function formatAvatar(avatar: unknown) {
    if (!avatar || typeof avatar !== 'object' || !('path' in avatar)) {
        return null;
    }
    const value = avatar as AvatarJson;
    if (!value.path) {
        return null;
    }
    return {
        path: value.path,
        url: value.url || getPublicUrl(value.path),
        width: value.width,
        height: value.height,
        thumbhash: value.thumbhash,
    };
}

export function formatCompany(company: Company) {
    return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        createdAt: company.createdAt.getTime(),
        updatedAt: company.updatedAt.getTime(),
    };
}

export function formatMembership(membership: CompanyMembership) {
    return {
        companyId: membership.companyId,
        accountId: membership.accountId,
        role: membership.role,
        joinedAt: membership.joinedAt.getTime(),
        createdAt: membership.createdAt.getTime(),
        updatedAt: membership.updatedAt.getTime(),
    };
}

export function formatCompanyOverview(company: Company, membership: CompanyMembership) {
    return {
        company: formatCompany(company),
        membership: formatMembership(membership),
        capabilities: getCompanyCapabilities(membership.role),
    };
}

export function formatCompanyMember(membership: CompanyMembership & { account: Account }) {
    return {
        ...formatMembership(membership),
        profile: {
            id: membership.account.id,
            firstName: membership.account.firstName,
            lastName: membership.account.lastName,
            username: membership.account.username,
            avatar: formatAvatar(membership.account.avatar),
        },
    };
}

export function formatCompanyInvite(invite: CompanyInvite & { createdByUser?: Account | null }) {
    return {
        id: invite.id,
        companyId: invite.companyId,
        role: invite.role,
        createdByUserId: invite.createdByUserId,
        createdBy: invite.createdByUser ? {
            id: invite.createdByUser.id,
            firstName: invite.createdByUser.firstName,
            lastName: invite.createdByUser.lastName,
            username: invite.createdByUser.username,
        } : null,
        expiresAt: invite.expiresAt ? invite.expiresAt.getTime() : null,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
        revokedAt: invite.revokedAt ? invite.revokedAt.getTime() : null,
        createdAt: invite.createdAt.getTime(),
        updatedAt: invite.updatedAt.getTime(),
    };
}
