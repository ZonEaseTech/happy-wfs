import { create } from 'zustand';
import { getSession, storage } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';
import type { Session } from '@/sync/storageTypes';
import { planSidebarOrder, sidebarOrderKey } from '@/utils/sidebarOrder';

/**
 * Saving a dragged order. The new sidebarOrder goes to the server as session
 * metadata and only comes back as an update a moment later; until it does, the
 * chosen value is held here so the list shows the new order straight away
 * instead of snapping back. It is dropped once the session's own metadata
 * carries it, or as soon as the save fails — the list then reverts.
 */
export const useSidebarOrderOverrides = create<Record<string, number>>(() => ({}));

export async function saveSidebarOrder(ordered: Session[], movedId: string): Promise<void> {
    const overrides = useSidebarOrderOverrides.getState();
    const updates = planSidebarOrder(
        ordered.map((session) => ({ id: session.id, key: sidebarOrderKey(session, overrides) })),
        movedId,
    );
    useSidebarOrderOverrides.setState(updates);
    await Promise.all(Object.entries(updates).map(async ([sessionId, key]) => {
        try {
            const session = getSession(sessionId);
            if (!session?.metadata) throw new Error(`metadata of ${sessionId} not loaded`);
            await sessionUpdateMetadataFields(sessionId, session.metadata, { sidebarOrder: key }, session.metadataVersion);
            await untilStored(sessionId, key);
        } catch (err) {
            // Best-effort, like the closure/review marks: dropping the override
            // below puts the row back where the server still has it.
            // eslint-disable-next-line no-console
            console.warn('[sidebarOrder] save failed:', err);
        }
        // A newer drag of the same row may have replaced the value meanwhile.
        if (useSidebarOrderOverrides.getState()[sessionId] === key) {
            useSidebarOrderOverrides.setState(({ [sessionId]: _dropped, ...rest }) => rest, true);
        }
    }));
}

/** Resolves once the store's copy of the session carries `key`, or after 10s. */
function untilStored(sessionId: string, key: number): Promise<void> {
    return new Promise((resolve) => {
        const stored = () => getSession(sessionId)?.metadata?.sidebarOrder === key;
        if (stored()) {
            resolve();
            return;
        }
        const timer = setTimeout(finish, 10_000);
        const unsubscribe = storage.subscribe(() => {
            if (stored()) finish();
        });
        function finish() {
            clearTimeout(timer);
            unsubscribe();
            resolve();
        }
    });
}
