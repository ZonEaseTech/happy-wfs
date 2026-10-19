import type { Session } from '@/sync/storageTypes';

/**
 * Manual order of sessions inside a sidebar group.
 *
 * A session the user dragged carries metadata.sidebarOrder; larger sorts
 * first. Sessions never dragged have none and use createdAt instead, so new
 * sessions still land on top and a drag writes only the row that moved — it
 * takes the midpoint of its new neighbours.
 *
 * `overrides` hold values a drag chose whose save hasn't come back from the
 * server yet (sync/sidebarOrder.ts); they win so the list doesn't snap back.
 */
export function sidebarOrderKey(session: Session, overrides: Record<string, number>): number {
    return overrides[session.id] ?? session.metadata?.sidebarOrder ?? session.createdAt;
}

export function compareSidebarOrder(a: Session, b: Session, overrides: Record<string, number>): number {
    return sidebarOrderKey(b, overrides) - sidebarOrderKey(a, overrides)
        || b.createdAt - a.createdAt
        || b.id.localeCompare(a.id);
}

/**
 * New sidebarOrder values once `movedId` has been dropped into `ordered` (top
 * to bottom, already in its new place, each with its current key). Normally
 * only the moved row changes. When its neighbours leave no room — equal keys,
 * or a gap too small to halve — the whole group is renumbered one apart,
 * counting down from its current top.
 */
export function planSidebarOrder(ordered: { id: string; key: number }[], movedId: string): Record<string, number> {
    const index = ordered.findIndex((entry) => entry.id === movedId);
    if (index < 0 || ordered.length < 2) return {};
    const above = ordered[index - 1]?.key;
    const below = ordered[index + 1]?.key;
    const key = above === undefined ? below! + 1
        : below === undefined ? above - 1
        : (above + below) / 2;
    if ((above === undefined || key < above) && (below === undefined || key > below)) {
        return { [movedId]: key };
    }
    const top = Math.max(...ordered.map((entry) => entry.key));
    return Object.fromEntries(ordered.map((entry, position) => [entry.id, top - position]));
}
