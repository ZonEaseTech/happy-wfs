import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";

const READ_RETENTION_MS = 1000 * 60 * 60 * 24 * 7; // 7 days after being read
const SWEEP_INTERVAL_MS = 1000 * 60 * 60; // hourly

/**
 * Periodically deletes read feed items (badge cleared) whose last update is
 * older than the retention window. Unread items are kept indefinitely; the
 * badge flip on read bumps updatedAt, so retention counts from read time.
 */
export function startFeedCleanup() {
    forever('feed-cleanup', async () => {
        await db.userFeedItem.deleteMany({
            where: {
                badge: false,
                updatedAt: {
                    lte: new Date(Date.now() - READ_RETENTION_MS)
                }
            }
        });
        await delay(SWEEP_INTERVAL_MS, shutdownSignal);
    });
}
