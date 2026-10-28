import { describe, expect, it } from 'vitest';
import { createSessionListCache, type CachedSessionRow } from './sessionListCache';
import type { SessionListCacheBackend } from './sessionListCacheBackend';

function memoryBackend(): SessionListCacheBackend & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>();
    return {
        data,
        get: async (key) => data.get(key),
        getAll: async (prefix) => [...data.entries()].filter(([key]) => key.startsWith(prefix)),
        putMany: async (entries) => { for (const [key, value] of entries) data.set(key, structuredClone(value)); },
        deleteMany: async (keys) => { for (const key of keys) data.delete(key); },
    };
}

function row(id: string, updatedAt: number, metadata = 'enc'): CachedSessionRow {
    return {
        id, seq: 1, metadata, metadataVersion: 1, agentState: null, agentStateVersion: 0, dataEncryptionKey: 'dek',
        active: false, activeAt: updatedAt, createdAt: 1, updatedAt, lastMessage: null,
    };
}

describe('sessionListCache', () => {
    it('keeps nothing until a fetch is saved', async () => {
        const cache = createSessionListCache(memoryBackend());
        expect(await cache.load('acct')).toBeNull();
    });

    it('returns saved rows with the cursor they are complete up to, merging later saves', async () => {
        const cache = createSessionListCache(memoryBackend());
        await cache.save('acct', [row('a', 10), row('b', 20)], 20);
        await cache.save('acct', [row('b', 30, 'enc-v2')], 30);

        const loaded = await cache.load('acct');
        expect(loaded?.cursor).toBe(30);
        expect(loaded?.rows.map(r => [r.id, r.metadata]).sort()).toEqual([['a', 'enc'], ['b', 'enc-v2']]);
    });

    it('keeps accounts apart', async () => {
        const cache = createSessionListCache(memoryBackend());
        await cache.save('alice', [row('a', 10)], 10);
        await cache.save('bob', [row('b', 10)], 10);

        expect((await cache.load('alice'))?.rows.map(r => r.id)).toEqual(['a']);
        expect((await cache.load('bob'))?.rows.map(r => r.id)).toEqual(['b']);
    });

    it('forgets removed sessions', async () => {
        const cache = createSessionListCache(memoryBackend());
        await cache.save('acct', [row('a', 10), row('b', 20)], 20);
        await cache.remove('acct', ['a']);

        expect((await cache.load('acct'))?.rows.map(r => r.id)).toEqual(['b']);
    });

    it('ignores what an older cache format left behind', async () => {
        const backend = memoryBackend();
        const cache = createSessionListCache(backend);
        await cache.save('acct', [row('a', 10)], 10);
        backend.data.set('meta:acct', { version: 0, cursor: 10 });

        expect(await cache.load('acct')).toBeNull();
    });

    it('acts as an empty cache when storage fails', async () => {
        const broken: SessionListCacheBackend = {
            get: async () => { throw new Error('quota'); },
            getAll: async () => { throw new Error('quota'); },
            putMany: async () => { throw new Error('quota'); },
            deleteMany: async () => { throw new Error('quota'); },
        };
        const cache = createSessionListCache(broken);
        await cache.save('acct', [row('a', 10)], 10);
        expect(await cache.load('acct')).toBeNull();
    });

    it('does nothing where the platform keeps no list', async () => {
        const cache = createSessionListCache(null);
        await cache.save('acct', [row('a', 10)], 10);
        expect(await cache.load('acct')).toBeNull();
    });
});
