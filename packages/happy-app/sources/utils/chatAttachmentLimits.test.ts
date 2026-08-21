import { describe, expect, it } from 'vitest';
import { MAX_CHAT_IMAGES } from './chatAttachmentLimits';

describe('chat attachment limits', () => {
    it('allows up to twenty images per message', () => {
        expect(MAX_CHAT_IMAGES).toBe(20);
    });
});
