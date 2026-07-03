import type { CompanyRole } from '@prisma/client';

export type CompanyCapabilityFlags = {
    canEditCompany: boolean;
    canManageMembers: boolean;
    canManageOwners: boolean;
    canManageInvites: boolean;
};

export const COMPANY_ROLE_ORDER: Record<CompanyRole, number> = {
    member: 0,
    admin: 1,
    owner: 2,
};

export function hasCompanyRole(role: CompanyRole, minimum: CompanyRole): boolean {
    return COMPANY_ROLE_ORDER[role] >= COMPANY_ROLE_ORDER[minimum];
}

export function getCompanyCapabilities(role: CompanyRole): CompanyCapabilityFlags {
    return {
        canEditCompany: role === 'owner' || role === 'admin',
        canManageMembers: role === 'owner' || role === 'admin',
        canManageOwners: role === 'owner',
        canManageInvites: role === 'owner' || role === 'admin',
    };
}
