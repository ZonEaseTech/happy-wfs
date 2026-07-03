import type { AuthCredentials } from '@/auth/tokenStorage';
import { t } from '@/text';
import { createSessionShare } from '@/sync/apiSharing';
import { encryptDataKeyForRecipientV0, verifyRecipientContentPublicKeyBinding } from '@/sync/directShareEncryption';
import type { UserProfile } from '@/sync/friendTypes';
import type { CreateSessionShareRequest, SessionShare } from '@/sync/sharingTypes';
import { sync } from '@/sync/sync';
import { HappyError } from '@/utils/errors';

export function getMentionShareTargets(mentionedFriends: UserProfile[], existingShares: SessionShare[]): UserProfile[] {
    const alreadySharedUserIds = new Set(existingShares.map(share => share.sharedWithUser.id));
    return mentionedFriends.filter(friend => !alreadySharedUserIds.has(friend.id));
}

interface ShareMentionDeps {
    getCredentials: () => AuthCredentials;
    getSessionDataKey: (sessionId: string) => Uint8Array | null;
    verifyBinding: typeof verifyRecipientContentPublicKeyBinding;
    encryptDataKey: typeof encryptDataKeyForRecipientV0;
    createShare: (credentials: AuthCredentials, sessionId: string, request: CreateSessionShareRequest) => Promise<SessionShare>;
}

export async function shareSessionWithMentionedFriendsWithDeps(
    sessionId: string,
    targets: UserProfile[],
    deps: ShareMentionDeps,
): Promise<void> {
    if (targets.length === 0) {
        return;
    }

    const credentials = deps.getCredentials();
    const dataKey = deps.getSessionDataKey(sessionId);
    if (!dataKey) {
        throw new HappyError(t('errors.sessionNotFound'), false);
    }

    for (const friend of targets) {
        if (!friend.contentPublicKey || !friend.contentPublicKeySig) {
            throw new HappyError(t('session.sharing.recipientMissingKeys'), false);
        }

        const isValidBinding = deps.verifyBinding({
            signingPublicKeyHex: friend.publicKey,
            contentPublicKeyB64: friend.contentPublicKey,
            contentPublicKeySigB64: friend.contentPublicKeySig,
        });
        if (!isValidBinding) {
            throw new HappyError(t('errors.operationFailed'), false);
        }

        const encryptedDataKey = deps.encryptDataKey(dataKey, friend.contentPublicKey);
        await deps.createShare(credentials, sessionId, {
            userId: friend.id,
            accessLevel: 'edit',
            encryptedDataKey,
        });
    }
}

export async function shareSessionWithMentionedFriends(sessionId: string, targets: UserProfile[]): Promise<void> {
    await shareSessionWithMentionedFriendsWithDeps(sessionId, targets, {
        getCredentials: () => sync.getCredentials(),
        getSessionDataKey: sync.getSessionDataKey.bind(sync),
        verifyBinding: verifyRecipientContentPublicKeyBinding,
        encryptDataKey: encryptDataKeyForRecipientV0,
        createShare: createSessionShare,
    });
}
