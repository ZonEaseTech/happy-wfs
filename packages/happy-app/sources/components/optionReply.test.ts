import { describe, expect, it } from 'vitest';
import { buildOptionReplyText } from './optionReply';

describe('buildOptionReplyText', () => {
    it('wraps option title as an explicit user choice for the agent', () => {
        expect(buildOptionReplyText('驱动因素：提前规划')).toBe('我的选择是：驱动因素：提前规划');
    });
});
