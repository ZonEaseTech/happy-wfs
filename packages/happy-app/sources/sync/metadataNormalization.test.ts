import { describe, expect, it } from 'vitest';

import { normalizeSessionMetadataForWrite } from './metadataNormalization';
import type { Metadata } from './storageTypes';

describe('normalizeSessionMetadataForWrite', () => {
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
