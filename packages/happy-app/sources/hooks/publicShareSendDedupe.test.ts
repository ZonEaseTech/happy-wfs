import { describe, expect, it } from 'vitest';
import { createPublicShareSendDeduper, buildPublicShareSendSignature, buildPublicShareLocalId, createPublicShareLocalIdCache } from './publicShareSendDedupe';

describe('public share send dedupe', () => {
    it('suppresses the same message and attachments inside the dedupe window', () => {
        const deduper = createPublicShareSendDeduper(2000);
        const signature = buildPublicShareSendSignature('  你好  ', [
            { name: 'a.png', size: 12, mimeType: 'image/png' },
        ], [
            { name: 'note.txt', size: 34, mimeType: 'text/plain' },
        ]);

        expect(deduper.shouldSend(signature, 1000)).toBe(true);
        expect(deduper.shouldSend(signature, 2500)).toBe(false);
        expect(deduper.shouldSend(signature, 3101)).toBe(true);
    });

    it('treats different attachments as different sends', () => {
        const deduper = createPublicShareSendDeduper(2000);
        const first = buildPublicShareSendSignature('你好', [], [{ name: 'a.txt', size: 1, mimeType: 'text/plain' }]);
        const second = buildPublicShareSendSignature('你好', [], [{ name: 'b.txt', size: 1, mimeType: 'text/plain' }]);

        expect(deduper.shouldSend(first, 1000)).toBe(true);
        expect(deduper.shouldSend(second, 1200)).toBe(true);
    });

    it('builds stable local ids for equivalent sends in the same idempotency window', () => {
        const signature = buildPublicShareSendSignature('你好');

        expect(buildPublicShareLocalId(signature, 1000)).toBe(buildPublicShareLocalId(signature, 5000));
        expect(buildPublicShareLocalId(signature, 1000)).not.toBe(buildPublicShareLocalId(signature, 62001));
    });

    it('keeps the same local id for repeated equivalent sends during the idempotency window', () => {
        const cache = createPublicShareLocalIdCache(60000);
        const signature = buildPublicShareSendSignature('你好');

        expect(cache.getOrCreate(signature, 1000)).toBe(buildPublicShareLocalId(signature, 1000));
        expect(cache.getOrCreate(signature, 5000)).toBe(buildPublicShareLocalId(signature, 1000));
        expect(cache.getOrCreate(signature, 62001)).toBe(buildPublicShareLocalId(signature, 62001));
    });

    it('uses the same stable local id after forgetting a failed send inside the same window', () => {
        const cache = createPublicShareLocalIdCache(60000);
        const signature = buildPublicShareSendSignature('你好');

        expect(cache.getOrCreate(signature, 1000)).toBe(buildPublicShareLocalId(signature, 1000));
        cache.forget(signature);
        expect(cache.getOrCreate(signature, 1100)).toBe(buildPublicShareLocalId(signature, 1100));
    });
});
