import { create } from 'zustand';
import { getSession, storage } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';
import type { Session } from '@/sync/storageTypes';
import { log } from '@/log';
import { planSidebarOrder, sidebarOrderKey } from '@/utils/sidebarOrder';

/**
 * Saving a dragged order. The new sidebarOrder goes to the server as session
 * metadata; until the store holds it, the chosen value is kept here so the list
 * shows the new order straight away instead of snapping back. It is dropped
 * once the session's own metadata carries it, or as soon as the save fails —
 * the list then reverts.
 *
 * Every step goes to the app log (/dev/logs, "[sidebarOrder]") so a drag that
 * still snaps back on someone's device can be traced from there.
 */
export const useSidebarOrderOverrides = create<Record<string, number>>(() => ({}));

export async function saveSidebarOrder(ordered: Session[], movedId: string): Promise<void> {
    const overrides = useSidebarOrderOverrides.getState();
    const updates = planSidebarOrder(
        ordered.map((session) => ({ id: session.id, key: sidebarOrderKey(session, overrides) })),
        movedId,
    );
    log.log(`[sidebarOrder] drop ${movedId} in [${ordered.map((session) => session.id).join(', ')}] → ${JSON.stringify(updates)}`);
    useSidebarOrderOverrides.setState(updates);
    await Promise.all(Object.entries(updates).map(async ([sessionId, key]) => {
        try {
            const session = getSession(sessionId);
            if (!session?.metadata) throw new Error('metadata not loaded');
            const saved = await sessionUpdateMetadataFields(sessionId, session.metadata, { sidebarOrder: key }, session.metadataVersion);
            // Take the server's answer as the update instead of waiting for its
            // broadcast to come round; the broadcast then matches and is a no-op.
            const current = getSession(sessionId);
            if (current && current.metadataVersion < saved.version) {
                storage.getState().applySessions([{ ...current, metadata: saved.metadata, metadataVersion: saved.version }]);
            }
            log.log(`[sidebarOrder] saved ${sessionId} at v${saved.version}`);
            if (!await untilStored(sessionId, key)) {
                log.log(`[sidebarOrder] ${sessionId} still not ${key} in the store after 10s (has ${getSession(sessionId)?.metadata?.sidebarOrder}, v${getSession(sessionId)?.metadataVersion})`);
            }
        } catch (err) {
            // Best-effort, like the closure/review marks: dropping the override
            // below puts the row back where the server still has it.
            log.log(`[sidebarOrder] save failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        // A newer drag of the same row may have replaced the value meanwhile.
        if (useSidebarOrderOverrides.getState()[sessionId] === key) {
            useSidebarOrderOverrides.setState(({ [sessionId]: _dropped, ...rest }) => rest, true);
        }
    }));
}

/** Resolves true once the store's copy of the session carries `key`, false after 10s. */
function untilStored(sessionId: string, key: number): Promise<boolean> {
    return new Promise((resolve) => {
        const stored = () => getSession(sessionId)?.metadata?.sidebarOrder === key;
        if (stored()) {
            resolve(true);
            return;
        }
        const timer = setTimeout(() => finish(false), 10_000);
        const unsubscribe = storage.subscribe(() => {
            if (stored()) finish(true);
        });
        function finish(found: boolean) {
            clearTimeout(timer);
            unsubscribe();
            resolve(found);
        }
    });
}
