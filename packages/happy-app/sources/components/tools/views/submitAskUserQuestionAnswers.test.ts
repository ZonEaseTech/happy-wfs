import { describe, expect, it, vi } from 'vitest';
import { submitAskUserQuestionAnswers } from './submitAskUserQuestionAnswers';

describe('submitAskUserQuestionAnswers', () => {
    it('sends an explicit user message and then resolves the structured permission when permission id exists', async () => {
        const sendOrQueueMessage = vi.fn().mockResolvedValue({ success: true });
        const allow = vi.fn().mockResolvedValue(undefined);
        const answers = { '用户分析项': '4 项：POS点餐 / 自助点餐机 / 扫码 / 外卖平台合计' };

        await submitAskUserQuestionAnswers({
            sessionId: 'session-1',
            permissionId: 'permission-1',
            answers,
        }, { sendOrQueueMessage, allow });

        expect(sendOrQueueMessage).toHaveBeenCalledWith(
            'session-1',
            '我的选择是：\n- 用户分析项：4 项：POS点餐 / 自助点餐机 / 扫码 / 外卖平台合计',
        );
        expect(allow).toHaveBeenCalledWith('session-1', 'permission-1', answers);
        expect(sendOrQueueMessage.mock.invocationCallOrder[0]).toBeLessThan(allow.mock.invocationCallOrder[0]);
    });

    it('only sends the explicit user message when there is no structured permission id', async () => {
        const sendOrQueueMessage = vi.fn().mockResolvedValue({ success: true });
        const allow = vi.fn().mockResolvedValue(undefined);
        const answers = { Scope: '先跟我说说 当前任务要做什么事' };

        await submitAskUserQuestionAnswers({
            sessionId: 'session-1',
            permissionId: undefined,
            answers,
        }, { sendOrQueueMessage, allow });

        expect(sendOrQueueMessage).toHaveBeenCalledWith(
            'session-1',
            '我的选择是：\n- Scope：先跟我说说 当前任务要做什么事',
        );
        expect(allow).not.toHaveBeenCalled();
    });
});
