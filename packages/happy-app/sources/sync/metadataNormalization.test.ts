import { describe, expect, it } from 'vitest';

import { normalizeSessionMetadataForWrite, SESSION_METADATA_WRITE_KEYS } from './metadataNormalization';
import { MetadataSchema, type Metadata } from './storageTypes';

describe('normalizeSessionMetadataForWrite', () => {
    // A schema field left off the write list is erased by the next write
    // anything in the app makes: a dragged sidebar order snapped back as soon
    // as the session was opened, because opening it records completionDismissedAt.
    it('writes back every field the metadata schema knows', () => {
        const missing = Object.keys(MetadataSchema.shape)
            .filter((key) => !(SESSION_METADATA_WRITE_KEYS as readonly string[]).includes(key));
        expect(missing).toEqual([]);
    });

    it('keeps a dragged sidebar order through an unrelated write', () => {
        const metadata: Metadata = { path: '/workspace', host: 'wfs', sidebarOrder: 1792377473343.5 };

        expect({ ...normalizeSessionMetadataForWrite(metadata), completionDismissedAt: 1 }.sidebarOrder).toBe(1792377473343.5);
    });

    it('preserves auto review guard when normalizing metadata for writes', () => {
        const metadata: Metadata = {
            path: '/workspace',
            host: 'wfs',
            autoReviewGuard: {
                enabled: true,
                status: 'waiting',
                updatedAt: 1234,
                simplifyPending: true,
            },
        };

        expect(normalizeSessionMetadataForWrite(metadata).autoReviewGuard).toEqual(metadata.autoReviewGuard);
    });
});
