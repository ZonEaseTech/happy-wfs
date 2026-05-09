import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Per-device "Pinned" flag a user can manually toggle on a session row.
 *  Pinned sessions appear at the top of the sidebar and render their full
 *  title without ellipsis — useful when a long task description is the only
 *  way the user remembers what they were doing yesterday. */
interface PinnedSessionsState {
    ids: string[];
    toggle: (sessionId: string) => void;
}

export const usePinnedSessions = create<PinnedSessionsState>()(
    persist(
        (set, get) => ({
            ids: [],
            toggle: (sessionId: string) => {
                const ids = get().ids;
                const next = ids.includes(sessionId)
                    ? ids.filter(x => x !== sessionId)
                    : [sessionId, ...ids];
                set({ ids: next });
            },
        }),
        {
            name: 'happy.pinnedSessions',
            storage: createJSONStorage(() => localStorage),
        },
    ),
);

/** Selector hook: subscribe to whether one session id is pinned.
 *  Boolean return → strict-equal means pinning another session won't
 *  re-render unrelated rows. */
export function useIsPinned(sessionId: string): boolean {
    return usePinnedSessions(s => s.ids.includes(sessionId));
}

/** Returns the array of pinned ids. Caller can wrap in useMemo + Set for
 *  membership checks. Reference is stable until toggle() runs. */
export function usePinnedIds(): string[] {
    return usePinnedSessions(s => s.ids);
}
