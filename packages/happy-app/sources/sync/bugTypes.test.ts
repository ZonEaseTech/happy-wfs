import { describe, expect, it } from 'vitest';
import {
    BUG_IMAGE_LIMITS,
    bugDisplayId,
    bugStatusLabel,
    buildBugTitle,
    formatBugStatusHistoryAction,
    matchesBugSearch,
    type BugReportSummary,
} from './bugTypes';

describe('bugTypes', () => {
    it('formats display ids and status labels', () => {
        expect(bugDisplayId(1042)).toBe('BUG-1042');
        expect(bugStatusLabel('pending')).toBe('待处理');
        expect(bugStatusLabel('in_progress')).toBe('进行中');
        expect(bugStatusLabel('verify')).toBe('待验证');
        expect(bugStatusLabel('closed')).toBe('已关闭');
    });

    it('uses explicit return-to-pending wording for status history', () => {
        expect(formatBugStatusHistoryAction({ action: 'return_to_pending', fromStatus: 'verify', toStatus: 'pending' })).toBe('打回待处理：待验证 → 待处理');
        expect(formatBugStatusHistoryAction({ action: 'status_change', fromStatus: 'pending', toStatus: 'in_progress' })).toBe('状态变更：待处理 → 进行中');
        expect(formatBugStatusHistoryAction({ action: 'deleted', fromStatus: 'pending', toStatus: 'pending' })).toBe('删除不显示：待处理 → 待处理');
    });

    it('builds a title from the first characters of the problem description', () => {
        expect(buildBugTitle('  提交订单后页面一直转圈，无法完成支付，需要刷新后才恢复。  ')).toBe('提交订单后页面一直转圈，无法完成支付，需要刷新后才恢复。');
        expect(buildBugTitle('a'.repeat(80))).toBe(`${'a'.repeat(36)}…`);
    });

    it('does not include rich image markers in generated titles', () => {
        expect(buildBugTitle('支付后订单状态没有刷新\n\n[[bug-image:1]]\n\n补充说明')).toBe('支付后订单状态没有刷新 补充说明');
    });

    it('matches bug search by display id, title, description, nickname, and status label', () => {
        const bug: BugReportSummary = {
            id: 'bug-1',
            displayNumber: 1042,
            displayId: 'BUG-1042',
            title: '提交订单后页面一直转圈',
            description: '支付成功后没有跳转',
            status: 'pending',
            visibility: 'shared',
            createdByNickname: '测试李',
            attachmentCount: 2,
            commentCount: 1,
            lastActivityAt: Date.UTC(2026, 6, 3),
            createdAt: Date.UTC(2026, 6, 3),
            updatedAt: Date.UTC(2026, 6, 3),
        };
        expect(matchesBugSearch(bug, '#1042')).toBe(true);
        expect(matchesBugSearch(bug, '支付成功')).toBe(true);
        expect(matchesBugSearch(bug, '测试李')).toBe(true);
        expect(matchesBugSearch(bug, '待处理')).toBe(true);
        expect(matchesBugSearch(bug, '不存在')).toBe(false);
    });

    it('keeps screenshot limits explicit', () => {
        expect(BUG_IMAGE_LIMITS.maxImages).toBe(10);
        expect(BUG_IMAGE_LIMITS.maxSizeBytes).toBe(20 * 1024 * 1024);
    });
});
