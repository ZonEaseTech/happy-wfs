import * as React from 'react';
import { AuthCredentials } from '@/auth/tokenStorage';
import { listMemories, type MemoryRow, type MemoryArchiveFilter } from './apiMemory';
import { loadMemoryCache, saveMemoryCache } from './persistence';

/**
 * Shared, MMKV-backed cache for the user's memory rows.
 *
 * Every consumer (memory screen, picker sheet, injected-memories modal) reads
 * from this one store instead of firing its own `GET /v1/memory`, which is why
 * opening any of them is instant after the first load:
 *
 *   - The cached list is restored from MMKV on first access, so the very first
 *     render after app start already has rows — no spinner, no request wait.
 *   - `refreshMemories` revalidates in the background (stale-while-revalidate)
 *     and only hits the network when the cache is older than STALE_AFTER_MS,
 *     unless `force` is passed (pull-to-refresh).
 *   - Concurrent refresh calls share a single in-flight request.
 *
 * The cache always holds the *full* list (active + archived). The three archive
 * tabs are derived locally, so switching tabs costs zero requests.
 *
 * Mutations apply the row the server echoes back straight into the cache rather
 * than refetching the whole list.
 *
 * The cache is per-account by construction: logout wipes all of MMKV and
 * reloads the JS bundle, which drops the in-memory copy too.
 */

const STALE_AFTER_MS = 30_000;

interface MemoryCacheState {
    /** null until the first load (cached or network) completes. */
    items: MemoryRow[] | null;
    /** ms timestamp of the last successful network load, 0 if never. */
    updatedAt: number;
    /** A background revalidation is in flight. */
    refreshing: boolean;
}

let state: MemoryCacheState = { items: null, updatedAt: 0, refreshing: false };
let hydrated = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function isMemoryRow(value: unknown): value is MemoryRow {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<MemoryRow>;
    return typeof row.id === 'string'
        && typeof row.content === 'string'
        && typeof row.createdAt === 'number';
}

/**
 * Restores the persisted list on first access. Kept lazy so importing this
 * module doesn't touch storage during app startup.
 */
function hydrate() {
    if (hydrated) return;
    hydrated = true;
    const entry = loadMemoryCache();
    if (!entry) return;
    const items = entry.items.filter(isMemoryRow);
    state = { items, updatedAt: entry.updatedAt, refreshing: false };
}

function setState(next: Partial<MemoryCacheState>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
}

function persist(items: MemoryRow[], updatedAt: number) {
    saveMemoryCache({ items, updatedAt });
}

function subscribe(listener: () => void): () => void {
    hydrate();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot(): MemoryCacheState {
    hydrate();
    return state;
}

/**
 * Loads the memory list, serving the cache first. Returns once the in-flight
 * request settles; callers that only want the cached rows can ignore it.
 *
 * `listMemories` retries with backoff and never rejects, matching the app-wide
 * "never show a load error, keep retrying" rule.
 */
export function refreshMemories(
    credentials: AuthCredentials,
    options?: { force?: boolean },
): Promise<void> {
    hydrate();
    const force = options?.force ?? false;
    if (!force && state.items !== null && Date.now() - state.updatedAt < STALE_AFTER_MS) {
        return Promise.resolve();
    }
    if (inflight) return inflight;

    setState({ refreshing: true });
    inflight = (async () => {
        try {
            const items = await listMemories(credentials, { archived: 'all' });
            const updatedAt = Date.now();
            persist(items, updatedAt);
            setState({ items, updatedAt, refreshing: false });
        } finally {
            inflight = null;
            if (state.refreshing) setState({ refreshing: false });
        }
    })();
    return inflight;
}

/** Inserts or replaces a row after a create/update/archive/unarchive. */
export function upsertMemory(row: MemoryRow) {
    hydrate();
    const current = state.items ?? [];
    const index = current.findIndex((m) => m.id === row.id);
    const items = index === -1
        ? [row, ...current]
        : current.map((m) => (m.id === row.id ? row : m));
    persist(items, state.updatedAt);
    setState({ items });
}

/** Drops a row after a delete. */
export function removeMemory(id: string) {
    hydrate();
    if (!state.items) return;
    const items = state.items.filter((m) => m.id !== id);
    persist(items, state.updatedAt);
    setState({ items });
}

function matchesFilter(m: MemoryRow, filter: MemoryArchiveFilter): boolean {
    if (filter === 'all') return true;
    return filter === 'archived' ? m.archivedAt !== null : m.archivedAt === null;
}

export interface UseMemoriesResult {
    /** Rows matching `filter`, newest first. Empty while still loading. */
    memories: MemoryRow[];
    /** Every cached row regardless of archive state. */
    allMemories: MemoryRow[];
    /** True only when there is nothing cached to show yet. */
    isLoading: boolean;
    /** A background revalidation is running on top of visible rows. */
    isRefreshing: boolean;
}

/**
 * Subscribes to the cache and derives the rows for one archive tab. Triggers a
 * background revalidation on mount; the returned rows come from the cache
 * immediately, so the caller renders without waiting on the network.
 */
export function useMemories(
    credentials: AuthCredentials | null,
    filter: MemoryArchiveFilter,
): UseMemoriesResult {
    const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    React.useEffect(() => {
        if (!credentials) return;
        void refreshMemories(credentials);
    }, [credentials]);

    const memories = React.useMemo(() => {
        const items = snapshot.items ?? [];
        return items
            .filter((m) => matchesFilter(m, filter))
            .sort((a, b) => b.createdAt - a.createdAt);
    }, [snapshot.items, filter]);

    return {
        memories,
        allMemories: snapshot.items ?? [],
        isLoading: snapshot.items === null,
        isRefreshing: snapshot.refreshing,
    };
}
