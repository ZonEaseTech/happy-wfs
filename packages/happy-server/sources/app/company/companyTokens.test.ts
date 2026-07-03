import { describe, expect, it } from 'vitest';
import { createInviteToken, hashInviteToken } from './companyTokens';

describe('company invite tokens', () => {
    it('creates URL-safe opaque tokens', () => {
        const token = createInviteToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    });

    it('hashes the same token consistently without returning the token itself', () => {
        const token = 'sample-token';
        expect(hashInviteToken(token)).toBe(hashInviteToken(token));
        expect(hashInviteToken(token)).not.toBe(token);
    });

    it('hashes different tokens differently', () => {
        expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
    });
});
