import { db } from "@/storage/db";
import { Context } from "@/context";

/**
 * Clears the badge on every unread feed item belonging to the context user.
 *
 * Only rows that still carry a badge are touched, so a repeated call is a
 * no-op and does not bump `updatedAt` on already-read items — which matters
 * because feed cleanup counts its retention window from that timestamp.
 */
export async function feedMarkAllRead(ctx: Context): Promise<number> {
    const result = await db.userFeedItem.updateMany({
        where: {
            userId: ctx.uid,
            badge: true
        },
        data: { badge: false }
    });
    return result.count;
}
