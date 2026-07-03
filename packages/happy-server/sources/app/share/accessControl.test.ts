import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => {
    const dbMock = {
        userRelationship: {
            findFirst: vi.fn(),
        },
        companyMembership: {
            findMany: vi.fn(),
        },
    };
    return { dbMock };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));

import { canDirectShareWithUser } from './accessControl';

describe('share access control', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('allows direct sharing between friends', async () => {
        dbMock.userRelationship.findFirst.mockResolvedValueOnce({ id: 'rel-1' });

        await expect(canDirectShareWithUser('owner-1', 'friend-1')).resolves.toBe(true);
        expect(dbMock.companyMembership.findMany).not.toHaveBeenCalled();
    });

    it('allows direct sharing between members of the same company', async () => {
        dbMock.userRelationship.findFirst.mockResolvedValueOnce(null);
        dbMock.companyMembership.findMany.mockResolvedValueOnce([
            { accountId: 'owner-1', companyId: 'company_default' },
            { accountId: 'coworker-1', companyId: 'company_default' },
        ]);

        await expect(canDirectShareWithUser('owner-1', 'coworker-1')).resolves.toBe(true);
    });

    it('rejects direct sharing for unrelated users', async () => {
        dbMock.userRelationship.findFirst.mockResolvedValueOnce(null);
        dbMock.companyMembership.findMany.mockResolvedValueOnce([
            { accountId: 'owner-1', companyId: 'company_default' },
            { accountId: 'stranger-1', companyId: 'other_company' },
        ]);

        await expect(canDirectShareWithUser('owner-1', 'stranger-1')).resolves.toBe(false);
    });
});
