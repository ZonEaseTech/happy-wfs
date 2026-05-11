import { create } from 'zustand';

/** Per-device "Awaiting closure" flag — the user has verified the agent's
 *  output and is keeping the session pinned to the top until they explicitly
 *  close it out. Sister flag to reviewPending; the two are intentionally
 *  independent booleans (you can be both, or just one). The sidebar sorter
 *  reads this to lift awaiting-closure rows above plain rows.
 *
 *  Each entry also stores the marked-at timestamp so multiple awaiting-
 *  closure rows sort against each other by recency of marking, not by their
 *  original createdAt.
 */
interface AwaitingClosureState {
    /** sessionId → ms timestamp when it was marked. */
    marks: Record<string, number>;
    toggle: (sessionId: string) => void;
}

const STORAGE_KEY = 'happy.awaitingClosure';

function readMarks(): Record<string, number> {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const out: Record<string, number> = {};
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === 'number') out[k] = v;
            }
            return out;
        }
        return {};
    } catch {
        return {};
    }
}

function writeMarks(marks: Record<string, number>) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
    } catch { /* quota / private mode — best effort */ }
}

// Same rationale as reviewPending: avoid zustand/middleware persist (pulls in
// import.meta.env which Metro emits unchanged into a non-module bundle).
export const useAwaitingClosure = create<AwaitingClosureState>((set, get) => ({
    marks: readMarks(),
    toggle: (sessionId: string) => {
        const marks = get().marks;
        const next = { ...marks };
        if (sessionId in next) {
            delete next[sessionId];
        } else {
            next[sessionId] = Date.now();
        }
        writeMarks(next);
        set({ marks: next });
    },
}));

export function useIsAwaitingClosure(sessionId: string): boolean {
    return useAwaitingClosure(s => sessionId in s.marks);
}

/** Marked-at timestamp for sort ordering. 0 if not marked. */
export function getAwaitingClosureMarkedAt(sessionId: string, marks: Record<string, number>): number {
    return marks[sessionId] ?? 0;
}
