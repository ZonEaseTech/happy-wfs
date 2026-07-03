import { describe, expect, it } from 'vitest';
import { MAX_CHAT_IMAGES } from './chatAttachmentLimits';

describe('chat attachment limits', () => {
    it('allows up to ten images per message', () => {
        expect(MAX_CHAT_IMAGES).toBe(10);
    });
});
