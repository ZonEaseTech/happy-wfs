import { create } from 'zustand';

/** Per-device map: sessionId → custom title text the user pinned from a chat
 *  message. When set, the sidebar row for that session renders this text
 *  (multi-line, no ellipsis) instead of the auto-generated sessionName, so
 *  the user can come back tomorrow and see exactly what they were working
 *  on without opening the session. */
interface PinnedMessagesState {
    titles: Record<string, string>;
    set: (sessionId: string, title: string) => void;
    clear: (sessionId: string) => void;
}

const STORAGE_KEY = 'happy.pinnedMessages';

function readTitles(): Record<string, string> {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
            if (typeof k === 'string' && typeof v === 'string') out[k] = v;
        }
        return out;
    } catch {
        return {};
    }
}

function writeTitles(titles: Record<string, string>) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(titles));
    } catch { /* quota / private mode — best effort */ }
}

export const usePinnedMessages = create<PinnedMessagesState>((setState, get) => ({
    titles: readTitles(),
    set: (sessionId: string, title: string) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        const next = { ...get().titles, [sessionId]: trimmed };
        writeTitles(next);
        setState({ titles: next });
    },
    clear: (sessionId: string) => {
        const current = get().titles;
        if (!(sessionId in current)) return;
        const next = { ...current };
        delete next[sessionId];
        writeTitles(next);
        setState({ titles: next });
    },
}));

/** Selector returning the pinned title for a single session, or undefined.
 *  Strict-equal selector → toggling another session's title won't re-render
 *  unrelated rows. */
export function usePinnedTitle(sessionId: string): string | undefined {
    return usePinnedMessages(s => s.titles[sessionId]);
}
