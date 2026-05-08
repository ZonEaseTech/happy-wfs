import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Per-device "Pending review" flag a user can manually toggle on a session row.
 *  Used to mark a session whose agent reported "done" but the user still wants
 *  to actually verify the result. Distinct from hasUnreadCompletion (auto-set
 *  when the agent posts a completion message): this one is user-driven and
 *  only the user can clear it. */
interface ReviewPendingState {
    ids: string[];
    toggle: (sessionId: string) => void;
}

export const useReviewPending = create<ReviewPendingState>()(
    persist(
        (set, get) => ({
            ids: [],
            toggle: (sessionId: string) => {
                const ids = get().ids;
                const next = ids.includes(sessionId)
                    ? ids.filter(x => x !== sessionId)
                    : [...ids, sessionId];
                set({ ids: next });
            },
        }),
        {
            name: 'happy.reviewPending',
            storage: createJSONStorage(() => localStorage),
        },
    ),
);

/** Selector hook: subscribe to whether a single session id is pending review.
 *  Returns a boolean — strict-equality means toggling another session won't
 *  cause this row to re-render. */
export function useIsReviewPending(sessionId: string): boolean {
    return useReviewPending(s => s.ids.includes(sessionId));
}
