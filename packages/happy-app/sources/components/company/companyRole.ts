import type { CompanyRole } from '@/sync/companyTypes';

export function getCompanyRoleLabelKey(role: CompanyRole) {
    return `company.roles.${role}` as const;
}

export function canCurrentUserManageMember(actorRole: CompanyRole, targetRole: CompanyRole, action: 'role' | 'remove') {
    if (actorRole === 'owner') {
        return true;
    }
    if (actorRole === 'admin') {
        return action === 'remove' && targetRole === 'member';
    }
    return false;
}
