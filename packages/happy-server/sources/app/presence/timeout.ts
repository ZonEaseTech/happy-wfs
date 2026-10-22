import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";
import { buildMachineActivityEphemeral, buildSessionActivityEphemeral, eventRouter } from "@/app/events/eventRouter";
import { onSessionCompleted } from "@/app/notifications/notifier";

const SESSION_TIMEOUT_MS = 1000 * 60 * 60 * 3;

export function startTimeout() {
    forever('session-timeout', async () => {
        // Find timed out sessions. A CLI that exits cleanly sends session-end
        // and goes inactive at once; this sweep only catches the ones that
        // vanished. Give those three hours: a machine that drops off the
        // network or stalls under IO for a while must not land its sessions
        // in the archived tab, and a heartbeat after reconnect brings them
        // back (sessionCache) without anyone pressing resume.
        const sessions = await db.session.findMany({
            where: {
                active: true,
                lastActiveAt: {
                    lte: new Date(Date.now() - SESSION_TIMEOUT_MS)
                }
            }
        });
        for (const session of sessions) {
            const updated = await db.session.updateManyAndReturn({
                where: { id: session.id, active: true },
                data: { active: false }
            });
            if (updated.length === 0) {
                continue;
            }
            eventRouter.emitEphemeral({
                userId: session.accountId,
                payload: buildSessionActivityEphemeral(session.id, false, updated[0].lastActiveAt.getTime(), false),
                recipientFilter: { type: 'user-scoped-only' }
            });
            void onSessionCompleted({
                userId: session.accountId,
                sessionId: session.id,
                completedAt: updated[0].lastActiveAt,
            });
        }

        // Find timed out machines
        const machines = await db.machine.findMany({
            where: {
                active: true,
                lastActiveAt: {
                    lte: new Date(Date.now() - 1000 * 60 * 10) // 10 minutes
                }
            }
        });
        for (const machine of machines) {
            const updated = await db.machine.updateManyAndReturn({
                where: { id: machine.id, active: true },
                data: { active: false }
            });
            if (updated.length === 0) {
                continue;
            }
            eventRouter.emitEphemeral({
                userId: machine.accountId,
                payload: buildMachineActivityEphemeral(machine.id, false, updated[0].lastActiveAt.getTime()),
                recipientFilter: { type: 'user-scoped-only' }
            });
        }

        await delay(1000 * 60, shutdownSignal);
    });
}