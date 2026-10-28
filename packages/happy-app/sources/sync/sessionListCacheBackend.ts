export interface SessionListCacheBackend {
    get(key: string): Promise<unknown | undefined>;
    /** Every entry whose key starts with prefix */
    getAll(prefix: string): Promise<Array<[string, unknown]>>;
    putMany(entries: Array<[string, unknown]>): Promise<void>;
    deleteMany(keys: string[]): Promise<void>;
}

// Only the web build keeps the session list between visits (see the .web
// variant); native apps keep running and resume without reloading.
export function openSessionListCacheBackend(): SessionListCacheBackend | null {
    return null;
}
