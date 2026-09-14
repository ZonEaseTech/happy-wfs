import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * localStorage throws once the origin quota is full instead of evicting, so
 * every persisted write has to survive that. These tests drive a fake MMKV
 * whose quota can be filled on demand.
 */

const store = new Map<string, string>();
let quotaBytes = Infinity;

function usedBytes(skipKey?: string): number {
    let total = 0;
    for (const [k, v] of store) {
        if (k === skipKey) continue;
        total += k.length + v.length;
    }
    return total;
}

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) { return store.get(key); }
        set(key: string, value: string) {
            // Mirror localStorage: the write is rejected as a whole when the
            // resulting total would exceed the quota.
            if (usedBytes(key) + key.length + value.length > quotaBytes) {
                throw new Error(`Setting the value of '${key}' exceeded the quota.`);
            }
            store.set(key, value);
        }
        delete(key: string) { store.delete(key); }
    },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const persistence = await import('./persistence');

function cacheEntry(size: number) {
    return { messages: ['x'.repeat(size)], oldestSeq: 1, hasMore: false };
}

describe('persisted writes under a full quota', () => {
    beforeEach(() => {
        store.clear();
        quotaBytes = Infinity;
    });

    it('saves pending settings instead of throwing when storage is full', () => {
        persistence.saveSessionMessagesCache('old-session', cacheEntry(400));
        quotaBytes = usedBytes() + 80;

        // Before the fix this threw the "exceeded the quota" error that reached
        // the user as an error dialog.
        expect(() => persistence.savePendingSettings({ viewInline: true } as never)).not.toThrow();
        expect(persistence.loadPendingSettings()).toEqual({ viewInline: true });
    });

    it('frees cached sessions to make room rather than dropping the write', () => {
        persistence.saveSessionMessagesCache('old-session', cacheEntry(400));
        expect(persistence.loadSessionMessagesCache('old-session')).not.toBeNull();

        // Only enough headroom for the new value once the cache is gone.
        quotaBytes = usedBytes() + 30;
        persistence.saveSettings({ viewInline: true } as never, 1);

        expect(persistence.loadSessionMessagesCache('old-session')).toBeNull();
        expect(store.has('settings')).toBe(true);
    });

    it('gives up quietly when nothing is left to evict', () => {
        quotaBytes = 40;
        expect(() => persistence.saveSettings({ viewInline: true } as never, 1)).not.toThrow();
        expect(store.has('settings')).toBe(false);
    });

    it('keeps at most 6 cached sessions on web so the cache cannot fill the origin', () => {
        for (let i = 0; i < 10; i++) {
            persistence.saveSessionMessagesCache(`session-${i}`, cacheEntry(50));
        }
        const cached = [...store.keys()].filter((k) => k.startsWith('session-messages.v1.') && !k.endsWith('.index'));
        expect(cached).toHaveLength(6);
        // The most recent survive; the oldest are shed.
        expect(persistence.loadSessionMessagesCache('session-9')).not.toBeNull();
        expect(persistence.loadSessionMessagesCache('session-0')).toBeNull();
    });
});
