import * as React from 'react';
import { storage, getSession, useSession } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';

/**
 * "Awaiting closure" mark.
 *
 * Persisted server-side on session.metadata.awaitingClosure (a stamped
 * { markedAt: number } record). Multi-device sync comes for free via the
 * existing encrypted-metadata pipeline used by summaryPinned / session
 * summary. localStorage is no longer the source of truth — the previous
 * client-only marks store was scrapped in favor of the metadata field.
 *
 * Public surface:
 *   useIsAwaitingClosure(id)        — boolean for one session
 *   useAwaitingClosureMarks()       — { sessionId: markedAt } map across all
 *                                      visible sessions, used by sorters
 *   toggleAwaitingClosure(id)       — async toggle that writes to server
 */

export function useIsAwaitingClosure(sessionId: string): boolean {
    const session = useSession(sessionId);
    return !!session?.metadata?.awaitingClosure;
}

/**
 * Map of sessionId → markedAt for every session in storage that has the
 * awaitingClosure mark. Used by sorters to compare two marked rows by
 * recency of marking. Returns a stable empty object reference when nothing
 * is marked so consumers can use it as a useMemo dep without flapping.
 */
const EMPTY_MARKS: Record<string, number> = Object.freeze({});

export function useAwaitingClosureMarks(): Record<string, number> {
    const sessions = storage(state => state.sessions);
    const sharedSessions = storage(state => state.sharedSessions);
    return React.useMemo(() => {
        const out: Record<string, number> = {};
        for (const s of Object.values(sessions)) {
            const m = s?.metadata?.awaitingClosure;
            if (m) out[s.id] = m.markedAt;
        }
        for (const s of Object.values(sharedSessions)) {
            const m = s?.metadata?.awaitingClosure;
            if (m) out[s.id] = m.markedAt;
        }
        return Object.keys(out).length === 0 ? EMPTY_MARKS : out;
    }, [sessions, sharedSessions]);
}

export async function toggleAwaitingClosure(sessionId: string): Promise<void> {
    const session = getSession(sessionId);
    if (!session?.metadata) return;
    const current = session.metadata.awaitingClosure;
    const next = current ? undefined : { markedAt: Date.now() };
    try {
        await sessionUpdateMetadataFields(
            sessionId,
            session.metadata,
            { awaitingClosure: next },
            session.metadataVersion,
        );
    } catch (err) {
        // Best-effort — leave the previous mark intact so the sidebar
        // sort doesn't lie. Real failure handling here would be a toast,
        // but we don't want to make this hook depend on UI plumbing.
        // eslint-disable-next-line no-console
        console.warn('[awaitingClosure] toggle failed:', err);
    }
}
