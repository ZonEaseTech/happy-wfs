import { create } from 'zustand';

/** Per-device "Pending review" flag a user can manually toggle on a session row.
 *  Used to mark a session whose agent reported "done" but the user still wants
 *  to actually verify the result. Distinct from hasUnreadCompletion (auto-set
 *  when the agent posts a completion message): this one is user-driven and
 *  only the user can clear it. */
interface ReviewPendingState {
    ids: string[];
    toggle: (sessionId: string) => void;
}

const STORAGE_KEY = 'happy.reviewPending';

function readIds(): string[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

function writeIds(ids: string[]) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch { /* quota / private mode — best effort */ }
}

// NOTE: avoiding zustand/middleware (persist + devtools) on purpose — it
// references `import.meta.env` which Metro emits unchanged into a non-module
// script bundle, throwing SyntaxError on web and breaking the whole app.
// Manual localStorage sync gives us the same UX with zero polyfill risk.
export const useReviewPending = create<ReviewPendingState>((set, get) => ({
    ids: readIds(),
    toggle: (sessionId: string) => {
        const ids = get().ids;
        const next = ids.includes(sessionId)
            ? ids.filter(x => x !== sessionId)
            : [...ids, sessionId];
        writeIds(next);
        set({ ids: next });
    },
}));

export function useIsReviewPending(sessionId: string): boolean {
    return useReviewPending(s => s.ids.includes(sessionId));
}
