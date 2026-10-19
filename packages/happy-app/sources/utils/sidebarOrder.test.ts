import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { compareSidebarOrder, planSidebarOrder } from './sidebarOrder';

const session = (id: string, createdAt: number, sidebarOrder?: number) =>
    ({ id, createdAt, metadata: sidebarOrder === undefined ? {} : { sidebarOrder } }) as unknown as Session;

const sorted = (sessions: Session[], overrides: Record<string, number> = {}) =>
    [...sessions].sort((a, b) => compareSidebarOrder(a, b, overrides)).map((s) => s.id);

describe('compareSidebarOrder', () => {
    it('puts the newest session first until anything is dragged', () => {
        expect(sorted([session('old', 100), session('new', 300), session('mid', 200)])).toEqual(['new', 'mid', 'old']);
    });

    it('places a dragged session by its own value among undragged ones', () => {
        expect(sorted([session('a', 300), session('b', 200), session('c', 100, 250)])).toEqual(['a', 'c', 'b']);
    });

    it('lets an unsaved drag win over the stored value', () => {
        expect(sorted([session('a', 300), session('b', 200, 400)], { b: 150 })).toEqual(['a', 'b']);
    });
});

describe('planSidebarOrder', () => {
    it('writes only the moved row, halfway between its neighbours', () => {
        expect(planSidebarOrder([{ id: 'a', key: 300 }, { id: 'x', key: 50 }, { id: 'b', key: 200 }], 'x')).toEqual({ x: 250 });
    });

    it('goes just above the old top when moved to the top', () => {
        expect(planSidebarOrder([{ id: 'x', key: 50 }, { id: 'a', key: 300 }], 'x')).toEqual({ x: 301 });
    });

    it('goes just below the old bottom when moved to the bottom', () => {
        expect(planSidebarOrder([{ id: 'a', key: 300 }, { id: 'x', key: 900 }], 'x')).toEqual({ x: 299 });
    });

    it('renumbers the group when the neighbours leave no room', () => {
        const plan = planSidebarOrder([{ id: 'a', key: 200 }, { id: 'x', key: 50 }, { id: 'b', key: 200 }], 'x');
        expect(plan).toEqual({ a: 200, x: 199, b: 198 });
    });

    it('keeps the dropped order after saving, whatever the move', () => {
        const start = [session('a', 500), session('b', 400), session('c', 300), session('d', 200), session('e', 100)];
        for (let from = 0; from < start.length; from++) {
            for (let to = 0; to < start.length; to++) {
                const ordered = start.map((s) => s.id);
                const [moved] = ordered.splice(from, 1);
                ordered.splice(to, 0, moved);
                const byId = Object.fromEntries(start.map((s) => [s.id, s]));
                const plan = planSidebarOrder(ordered.map((id) => ({ id, key: byId[id].createdAt })), moved);
                expect(sorted(start, plan)).toEqual(ordered);
            }
        }
    });

    it('does nothing for a lone row', () => {
        expect(planSidebarOrder([{ id: 'x', key: 1 }], 'x')).toEqual({});
    });
});
