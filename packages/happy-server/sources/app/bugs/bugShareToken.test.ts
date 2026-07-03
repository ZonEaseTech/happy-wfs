import { describe, expect, it } from 'vitest';
import { createBugShareToken, verifyBugShareToken } from './bugShareToken';

describe('bugShareToken', () => {
    it('round-trips config id, owner id, nickname, and version', () => {
        const token = createBugShareToken({ configId: 'cfg-1', ownerId: 'owner-1', nickname: '测试李', version: 3 });
        expect(verifyBugShareToken(token)).toMatchObject({
            configId: 'cfg-1',
            ownerId: 'owner-1',
            nickname: '测试李',
            version: 3,
        });
    });

    it('returns null for invalid tokens', () => {
        expect(verifyBugShareToken('not-a-token')).toBeNull();
    });
});
