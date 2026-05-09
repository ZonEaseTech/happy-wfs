import { create } from 'zustand';

/** Per-device "Pinned" flag a user can manually toggle on a session row.
 *  Pinned sessions appear at the top of the sidebar and render their full
 *  title without ellipsis — useful when a long task description is the only
 *  way the user remembers what they were doing yesterday. */
interface PinnedSessionsState {
    ids: string[];
    toggle: (sessionId: string) => void;
}

const STORAGE_KEY = 'happy.pinnedSessions';

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
export const usePinnedSessions = create<PinnedSessionsState>((set, get) => ({
    ids: readIds(),
    toggle: (sessionId: string) => {
        const ids = get().ids;
        const next = ids.includes(sessionId)
            ? ids.filter(x => x !== sessionId)
            : [sessionId, ...ids];
        writeIds(next);
        set({ ids: next });
    },
}));

export function useIsPinned(sessionId: string): boolean {
    return usePinnedSessions(s => s.ids.includes(sessionId));
}

export function usePinnedIds(): string[] {
    return usePinnedSessions(s => s.ids);
}
