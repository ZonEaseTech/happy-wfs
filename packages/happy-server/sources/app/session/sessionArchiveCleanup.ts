import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { log } from "@/utils/log";
import { shutdownSignal } from "@/utils/shutdown";
import { sessionDelete } from "@/app/session/sessionDelete";

const ARCHIVE_RETENTION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days after last activity
const SWEEP_INTERVAL_MS = 1000 * 60 * 60; // hourly
const BATCH_SIZE = 50;

/**
 * Permanently deletes archived sessions — inactive, with no activity for the
 * retention window — for every account, shared ones included. Each goes
 * through sessionDelete, so its messages, usage reports and access keys go
 * with it, shares cascade, and the owner's clients are told it is gone.
 *
 * A session stays only as long as something keeps it active: a heartbeat
 * moves lastActiveAt, so one that comes back to life is never in range.
 */
export async function deleteExpiredArchivedSessions(now: number = Date.now()): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    // Everything tried this sweep is left out of the next query, so the loop
    // ends even if a row changes under it; failures get another go next hour.
    const seen = new Set<string>();
    const cutoff = new Date(now - ARCHIVE_RETENTION_MS);
    while (!shutdownSignal.aborted) {
        const expired = await db.session.findMany({
            where: {
                active: false,
                lastActiveAt: { lt: cutoff },
                ...(seen.size > 0 ? { id: { notIn: Array.from(seen) } } : {}),
            },
            select: { id: true, accountId: true },
            orderBy: { lastActiveAt: 'asc' },
            take: BATCH_SIZE,
        });
        if (expired.length === 0) break;
        for (const session of expired) {
            seen.add(session.id);
            try {
                // A session that turned active again since the query is no longer expired.
                const still = await db.session.findFirst({
                    where: { id: session.id, active: false, lastActiveAt: { lt: cutoff } },
                    select: { id: true },
                });
                if (!still) continue;
                if (await sessionDelete({ uid: session.accountId }, session.id)) {
                    deleted++;
                } else {
                    failed++;
                }
            } catch (error) {
                failed++;
                log({ module: 'session-archive-cleanup', level: 'error', sessionId: session.id }, `Failed to delete archived session: ${error}`);
            }
        }
    }
    if (deleted > 0 || failed > 0) {
        log({ module: 'session-archive-cleanup' }, `Deleted ${deleted} archived sessions older than 30 days, ${failed} failed`);
    }
    return { deleted, failed };
}

export function startSessionArchiveCleanup() {
    forever('session-archive-cleanup', async () => {
        await deleteExpiredArchivedSessions();
        await delay(SWEEP_INTERVAL_MS, shutdownSignal);
    });
}
