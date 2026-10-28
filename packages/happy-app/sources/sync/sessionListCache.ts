import { openSessionListCacheBackend, type SessionListCacheBackend } from './sessionListCacheBackend';

/**
 * The session list as the server returned it — encrypted metadata and agent
 * state, as in GET /v1/sessions — kept between visits so a reload can show the
 * list at once and fetch only what changed (?since=). Nothing is stored
 * decrypted; a reload runs the cached rows through the same decryption as a
 * fresh fetch.
 */
export type CachedSessionRow = {
    id: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: string | null;
    active: boolean;
    activeAt: number;
    createdAt: number;
    updatedAt: number;
    lastMessage: unknown;
    isShared?: boolean;
};

// Bump when CachedSessionRow changes shape; older entries are then ignored.
const CACHE_VERSION = 1;

type CacheMeta = { version: number; cursor: number };

const metaKey = (accountId: string) => `meta:${accountId}`;
const rowPrefix = (accountId: string) => `row:${accountId}:`;

export function createSessionListCache(backend: SessionListCacheBackend | null) {
    return {
        /** Rows and the ?since= cursor they are complete up to, or null when nothing usable is kept */
        async load(accountId: string): Promise<{ cursor: number; rows: CachedSessionRow[] } | null> {
            if (!backend || !accountId) return null;
            try {
                const meta = await backend.get(metaKey(accountId)) as CacheMeta | undefined;
                if (!meta || meta.version !== CACHE_VERSION) return null;
                const rows = (await backend.getAll(rowPrefix(accountId))).map(([, value]) => value as CachedSessionRow);
                return rows.length > 0 ? { cursor: meta.cursor, rows } : null;
            } catch (error) {
                console.warn('[sessionListCache] load failed', error);
                return null;
            }
        },

        /** Upsert rows, then move the cursor; a crash in between leaves the cursor behind, which only refetches more */
        async save(accountId: string, rows: CachedSessionRow[], cursor: number): Promise<void> {
            if (!backend || !accountId) return;
            try {
                if (rows.length > 0) {
                    await backend.putMany(rows.map(row => [`${rowPrefix(accountId)}${row.id}`, row]));
                }
                await backend.putMany([[metaKey(accountId), { version: CACHE_VERSION, cursor } satisfies CacheMeta]]);
            } catch (error) {
                console.warn('[sessionListCache] save failed', error);
            }
        },

        async remove(accountId: string, sessionIds: string[]): Promise<void> {
            if (!backend || !accountId || sessionIds.length === 0) return;
            try {
                await backend.deleteMany(sessionIds.map(id => `${rowPrefix(accountId)}${id}`));
            } catch (error) {
                console.warn('[sessionListCache] remove failed', error);
            }
        },
    };
}

export const sessionListCache = createSessionListCache(openSessionListCacheBackend());
