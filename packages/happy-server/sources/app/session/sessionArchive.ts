import { Context } from "@/context";
import { db } from "@/storage/db";
import { eventRouter, buildSessionActivityEphemeral } from "@/app/events/eventRouter";

/**
 * Mark a session inactive when its CLI process is already gone and cannot
 * send session-end itself. Used by the app when archiving a dead session
 * and by the daemon after it resumed a vanished session into a new one.
 *
 * lastActiveAt moves to now so a heartbeat still queued from the old
 * process (sessionCache only moves forward in time) cannot bring it back.
 *
 * @returns 'archived' when the flag flipped, 'already_inactive' when it was
 *          already off, 'not_found' when the session is not the user's
 */
export async function sessionArchive(ctx: Context, sessionId: string): Promise<'archived' | 'already_inactive' | 'not_found'> {
    const now = new Date();
    const updated = await db.session.updateMany({
        where: { id: sessionId, accountId: ctx.uid, active: true },
        data: { active: false, lastActiveAt: now }
    });

    if (updated.count === 0) {
        const exists = await db.session.findFirst({
            where: { id: sessionId, accountId: ctx.uid },
            select: { id: true }
        });
        return exists ? 'already_inactive' : 'not_found';
    }

    eventRouter.emitEphemeral({
        userId: ctx.uid,
        payload: buildSessionActivityEphemeral(sessionId, false, now.getTime(), false),
        recipientFilter: { type: 'user-scoped-only' }
    });
    return 'archived';
}
