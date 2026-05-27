import { describe, expect, it } from 'vitest';
import { isValidPortProxySlug, makePortProxySlug } from './slug';

describe('port proxy slugs', () => {
    it('creates valid slugs with the pp_ prefix', () => {
        const slug = makePortProxySlug();

        expect(slug.startsWith('pp_')).toBe(true);
        expect(isValidPortProxySlug(slug)).toBe(true);
    });

    it('rejects path traversal and undersized slugs', () => {
        expect(isValidPortProxySlug('../secret')).toBe(false);
        expect(isValidPortProxySlug('pp_x')).toBe(false);
    });
});
