import { describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/sync/friendTypes';
import type { SessionShare } from '@/sync/sharingTypes';

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/sync/apiSharing', () => ({
    createSessionShare: vi.fn(),
}));

vi.mock('@/sync/directShareEncryption', () => ({
    encryptDataKeyForRecipientV0: vi.fn(),
    verifyRecipientContentPublicKeyBinding: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        getCredentials: vi.fn(),
        getSessionDataKey: vi.fn(),
    },
}));

import {
    getMentionShareTargets,
    shareSessionWithMentionedFriendsWithDeps,
} from './sessionMentionSharing';

function friend(id: string, username: string, overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        id,
        username,
        firstName: username,
        lastName: null,
        avatar: null,
        bio: null,
        status: 'friend',
        publicKey: `public-${id}`,
        contentPublicKey: `content-${id}`,
        contentPublicKeySig: `sig-${id}`,
        ...overrides,
    };
}

function share(userId: string): SessionShare {
    return {
        id: `share-${userId}`,
        sessionId: 'session-1',
        sharedWithUser: {
            id: userId,
            username: userId,
            firstName: null,
            lastName: null,
            avatar: null,
        },
        accessLevel: 'view',
        createdAt: 1,
        updatedAt: 1,
    };
}

describe('session mention sharing', () => {
    it('filters friends that already have direct shares', () => {
        expect(getMentionShareTargets(
            [friend('u1', 'alice'), friend('u2', 'bob')],
            [share('u1')],
        ).map(item => item.id)).toEqual(['u2']);
    });

    it('creates edit shares with encrypted data keys for each mention target', async () => {
        const createShare = vi.fn().mockResolvedValue(share('u1'));
        const credentials = { token: 'token' } as never;
        const dataKey = new Uint8Array([1, 2, 3]);

        await shareSessionWithMentionedFriendsWithDeps('session-1', [friend('u1', 'alice')], {
            getCredentials: () => credentials,
            getSessionDataKey: () => dataKey,
            verifyBinding: vi.fn().mockReturnValue(true),
            encryptDataKey: vi.fn().mockReturnValue('encrypted-key'),
            createShare,
        });

        expect(createShare).toHaveBeenCalledWith(credentials, 'session-1', {
            userId: 'u1',
            accessLevel: 'edit',
            encryptedDataKey: 'encrypted-key',
        });
    });
});
