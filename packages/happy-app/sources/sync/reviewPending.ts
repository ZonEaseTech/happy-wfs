import { getSession, useSession } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';

/**
 * "Pending review" mark.
 *
 * Persisted server-side on session.metadata.reviewPending (a stamped
 * { markedAt: number } record). Multi-device sync comes for free via the
 * existing encrypted-metadata pipeline — same approach as awaitingClosure.
 *
 * Used by the sidebar to highlight rows the user wants to come back and
 * verify even though the agent has reported "done". Distinct from
 * hasUnreadCompletion (auto, blue) in that only the user clears it.
 */

export function useIsReviewPending(sessionId: string): boolean {
    const session = useSession(sessionId);
    return !!session?.metadata?.reviewPending;
}

export async function toggleReviewPending(sessionId: string): Promise<void> {
    const session = getSession(sessionId);
    if (!session?.metadata) return;
    const current = session.metadata.reviewPending;
    const next = current ? undefined : { markedAt: Date.now() };
    try {
        await sessionUpdateMetadataFields(
            sessionId,
            session.metadata,
            { reviewPending: next },
            session.metadataVersion,
        );
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[reviewPending] toggle failed:', err);
    }
}
