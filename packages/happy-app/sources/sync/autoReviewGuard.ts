import { sessionUpdateMetadataFields } from '@/sync/ops';
import { getSession, useSession } from '@/sync/storage';
import type { Metadata } from '@/sync/storageTypes';

export type AutoReviewGuard = NonNullable<Metadata['autoReviewGuard']>;

export function buildNextAutoReviewGuard(current: AutoReviewGuard | undefined, now = Date.now()): AutoReviewGuard {
    if (current?.enabled) {
        return {
            ...current,
            enabled: false,
            status: 'idle',
            updatedAt: now,
        };
    }

    return {
        ...current,
        enabled: true,
        status: current?.status && current.status !== 'needs_follow_up' ? current.status : 'idle',
        updatedAt: now,
    };
}

export function useAutoReviewGuard(sessionId: string): AutoReviewGuard | undefined {
    return useSession(sessionId)?.metadata?.autoReviewGuard;
}

export async function toggleAutoReviewGuard(sessionId: string): Promise<AutoReviewGuard | undefined> {
    const session = getSession(sessionId);
    if (!session?.metadata) return undefined;

    const next = buildNextAutoReviewGuard(session.metadata.autoReviewGuard);
    await sessionUpdateMetadataFields(
        sessionId,
        session.metadata,
        { autoReviewGuard: next },
        session.metadataVersion,
    );
    return next;
}
