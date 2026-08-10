/**
 * update-metadata replaces the whole document, so anything that narrows the
 * local copy is pushed to the server on the next write and the session renders
 * as "unknown" in every client. This guard is what stops a sparse copy from
 * propagating, and its failure is silent — the write succeeds, the damage only
 * shows up as a session that lost its name.
 */

import { describe, expect, it } from 'vitest';
import { adoptServerSessionMetadata } from './apiSession';

const full = {
    path: '/workspace/happy-wfs',
    host: 'wfs',
    machineId: 'machine-1',
    summary: { text: 'happy服务', updatedAt: 1 },
    model: 'opus',
} as any;

describe('adoptServerSessionMetadata', () => {
    it('keeps the local copy when the incoming one failed to decrypt', () => {
        expect(adoptServerSessionMetadata(full, null)).toBe(full);
    });

    it('restores identity fields a sparse copy dropped', () => {
        // What the autoReviewGuard handler produces from a missing base.
        const sparse = { autoReviewGuard: { state: 'idle' } } as any;
        const merged = adoptServerSessionMetadata(full, sparse)!;
        expect(merged.path).toBe('/workspace/happy-wfs');
        expect(merged.host).toBe('wfs');
        expect(merged.machineId).toBe('machine-1');
        expect(merged.summary).toEqual({ text: 'happy服务', updatedAt: 1 });
        expect((merged as any).autoReviewGuard).toEqual({ state: 'idle' });
    });

    it('lets the incoming copy win where it actually carries a value', () => {
        const renamed = { ...full, summary: { text: 'renamed', updatedAt: 2 } };
        expect(adoptServerSessionMetadata(full, renamed)!.summary).toEqual({ text: 'renamed', updatedAt: 2 });
    });

    it('takes the incoming copy when there is no local one yet', () => {
        expect(adoptServerSessionMetadata(null, full)).toBe(full);
    });
});
