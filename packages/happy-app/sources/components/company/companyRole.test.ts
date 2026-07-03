import { describe, expect, it } from 'vitest';
import { canCurrentUserManageMember, getCompanyRoleLabelKey } from './companyRole';

describe('companyRole helpers', () => {
    it('returns translation keys for roles', () => {
        expect(getCompanyRoleLabelKey('owner')).toBe('company.roles.owner');
        expect(getCompanyRoleLabelKey('admin')).toBe('company.roles.admin');
        expect(getCompanyRoleLabelKey('member')).toBe('company.roles.member');
    });

    it('allows admins to remove members only', () => {
        expect(canCurrentUserManageMember('admin', 'member', 'remove')).toBe(true);
        expect(canCurrentUserManageMember('admin', 'admin', 'remove')).toBe(false);
        expect(canCurrentUserManageMember('admin', 'owner', 'remove')).toBe(false);
        expect(canCurrentUserManageMember('admin', 'member', 'role')).toBe(false);
    });

    it('allows owners to manage role changes and removals', () => {
        expect(canCurrentUserManageMember('owner', 'admin', 'role')).toBe(true);
        expect(canCurrentUserManageMember('owner', 'owner', 'remove')).toBe(true);
    });

    it('denies members all management actions', () => {
        expect(canCurrentUserManageMember('member', 'member', 'remove')).toBe(false);
    });
});
