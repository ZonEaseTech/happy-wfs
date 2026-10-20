import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { compareSidebarOrder } from '@/utils/sidebarOrder';
import { storage } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';
import { saveSidebarOrder, useSidebarOrderOverrides } from './sidebarOrder';

vi.mock('@/sync/storage', async () => {
    const { create } = await import('zustand');
    type State = { sessions: Record<string, Session>; sharedSessions: Record<string, Session>; applySessions: (list: Session[]) => void };
    const storage = create<State>((set) => ({
        sessions: {},
        sharedSessions: {},
        applySessions: (list) => set((state) => ({ sessions: { ...state.sessions, ...Object.fromEntries(list.map((s) => [s.id, s])) } })),
    }));
    return { storage, getSession: (id: string) => storage.getState().sessions[id] };
});
vi.mock('@/sync/ops', () => ({ sessionUpdateMetadataFields: vi.fn() }));

const store = storage as unknown as {
    getState: () => { sessions: Record<string, Session> };
    setState: (state: { sessions: Record<string, Session> }) => void;
};

function seed(): Record<string, Session> {
    const sessions = Object.fromEntries(['a', 'b', 'c'].map((id, index) => [id, {
        id, createdAt: 300 - index * 100, metadata: { path: '/p' }, metadataVersion: 1,
    } as unknown as Session]));
    store.setState({ sessions });
    return sessions;
}

/** Order the sidebar would show right now. */
function shown(): string[] {
    const overrides = useSidebarOrderOverrides.getState();
    return Object.values(store.getState().sessions).sort((x, y) => compareSidebarOrder(x, y, overrides)).map((s) => s.id);
}

/** What the server broadcast does to the store once a save went through. */
function echo(id: string, sidebarOrder: number) {
    const sessions = store.getState().sessions;
    store.setState({ sessions: { ...sessions, [id]: { ...sessions[id], metadata: { ...sessions[id].metadata!, sidebarOrder }, metadataVersion: 2 } } });
}

const saveSucceeds = () => vi.mocked(sessionUpdateMetadataFields).mockImplementation(async (_id, metadata, updates) => (
    { version: 2, metadata: { ...metadata, ...updates } }
));

describe('saveSidebarOrder', () => {
    it('shows the dropped order at once and keeps it after the server echo lands', async () => {
        const s = seed();
        saveSucceeds();
        vi.mocked(sessionUpdateMetadataFields).mockImplementationOnce(async (id, metadata, updates) => {
            setTimeout(() => echo(id, updates.sidebarOrder!), 50);
            return { version: 2, metadata: { ...metadata, ...updates } };
        });
        const saving = saveSidebarOrder([s.b, s.c, s.a], 'a');
        expect(shown()).toEqual(['b', 'c', 'a']);
        await saving;
        expect(useSidebarOrderOverrides.getState()).toEqual({});
        expect(shown()).toEqual(['b', 'c', 'a']);
    });

    it('keeps the dropped order even when the broadcast never comes back', async () => {
        const s = seed();
        saveSucceeds();
        await saveSidebarOrder([s.b, s.c, s.a], 'a');
        expect(useSidebarOrderOverrides.getState()).toEqual({});
        expect(shown()).toEqual(['b', 'c', 'a']);
    });

    it('goes back to the stored order when the save fails', async () => {
        const s = seed();
        vi.mocked(sessionUpdateMetadataFields).mockRejectedValue(new Error('boom'));
        await saveSidebarOrder([s.b, s.c, s.a], 'a');
        expect(useSidebarOrderOverrides.getState()).toEqual({});
        expect(shown()).toEqual(['a', 'b', 'c']);
    });
});
