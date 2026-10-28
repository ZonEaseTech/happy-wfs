import type { SessionListCacheBackend } from './sessionListCacheBackend';

export type { SessionListCacheBackend } from './sessionListCacheBackend';

const DB_NAME = 'happy-session-list-cache';
const STORE = 'kv';

/**
 * IndexedDB, not localStorage: the list runs to megabytes — Codex sessions
 * carry their skill list — well past localStorage's ~5MB per origin.
 */
export function openSessionListCacheBackend(): SessionListCacheBackend | null {
    if (typeof indexedDB === 'undefined') return null;

    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = () => {
        dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE)) {
                    request.result.createObjectStore(STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                dbPromise = null;
                reject(request.error);
            };
        });
        return dbPromise;
    };

    const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
        const database = await db();
        return await new Promise<T | undefined>((resolve, reject) => {
            const tx = database.transaction(STORE, mode);
            const request = fn(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request ? request.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    };

    return {
        get: (key) => run('readonly', store => store.get(key)),
        getAll: async (prefix) => {
            const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
            const database = await db();
            return await new Promise<Array<[string, unknown]>>((resolve, reject) => {
                const tx = database.transaction(STORE, 'readonly');
                const store = tx.objectStore(STORE);
                const keys = store.getAllKeys(range);
                const values = store.getAll(range);
                tx.oncomplete = () => resolve((keys.result as IDBValidKey[]).map((key, index) => [String(key), values.result[index]]));
                tx.onerror = () => reject(tx.error);
            });
        },
        putMany: async (entries) => {
            await run('readwrite', store => {
                for (const [key, value] of entries) store.put(value, key);
            });
        },
        deleteMany: async (keys) => {
            await run('readwrite', store => {
                for (const key of keys) store.delete(key);
            });
        },
    };
}
