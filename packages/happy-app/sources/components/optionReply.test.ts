import { describe, expect, it } from 'vitest';
import { buildOptionReplyText, buildAnswersReplyText } from './optionReply';

describe('buildOptionReplyText', () => {
    it('wraps option title as an explicit user choice for the agent', () => {
        expect(buildOptionReplyText('驱动因素：提前规划')).toBe('我的选择是：驱动因素：提前规划');
    });
});

describe('buildAnswersReplyText', () => {
    it('formats a single answer like a plain option reply', () => {
        expect(buildAnswersReplyText({ '意图': '梳理现有实现' })).toBe('我的选择是：梳理现有实现');
    });

    it('lists each question header with its answer for multiple questions', () => {
        expect(buildAnswersReplyText({ '意图': '梳理现有实现', '范围': '仅后端' }))
            .toBe('我的选择是：\n- 意图：梳理现有实现\n- 范围：仅后端');
    });
});
