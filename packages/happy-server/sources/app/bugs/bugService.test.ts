import { describe, expect, it } from 'vitest';
import { bugMatchesQuery, buildBugTitle, compareBugRowsForList, normalizeBugStatusChange } from './bugService';

describe('bugService pure helpers', () => {
    it('generates compact titles from descriptions', () => {
        expect(buildBugTitle('  页面空白，控制台有 500 错误  ')).toBe('页面空白，控制台有 500 错误');
        expect(buildBugTitle('测'.repeat(50))).toBe(`${'测'.repeat(36)}…`);
    });

    it('removes rich content image markers from generated titles', () => {
        expect(buildBugTitle('支付后订单状态没有刷新\n\n[[bug-image:1]]\n\n补充说明')).toBe('支付后订单状态没有刷新 补充说明');
    });

    it('normalizes return-to-pending as a pending status with explicit action', () => {
        expect(normalizeBugStatusChange('verify', { status: 'pending', action: 'return_to_pending' })).toEqual({
            fromStatus: 'verify',
            toStatus: 'pending',
            action: 'return_to_pending',
        });
    });

    it('normalizes close as closed action', () => {
        expect(normalizeBugStatusChange('in_progress', { status: 'closed' })).toEqual({
            fromStatus: 'in_progress',
            toStatus: 'closed',
            action: 'closed',
        });
    });
});

describe('bugMatchesQuery', () => {
    const row = {
        displayNumber: 21,
        title: '批量没有区分本店自建',
        description: '子店不可修改时批量操作异常',
        createdByNickname: null,
        createdByUser: { username: 'youthqx' },
        status: 'pending',
    };

    it('matches the Chinese status label shown in the UI', () => {
        expect(bugMatchesQuery(row, '待处理')).toBe(true);
        expect(bugMatchesQuery(row, '已关闭')).toBe(false);
    });

    it('still matches raw status, display id, and creator username', () => {
        expect(bugMatchesQuery(row, 'pending')).toBe(true);
        expect(bugMatchesQuery(row, 'BUG-21')).toBe(true);
        expect(bugMatchesQuery(row, 'youthqx')).toBe(true);
    });
});

describe('compareBugRowsForList', () => {
    it('floats pending above other statuses regardless of recency', () => {
        const rows = [
            { status: 'closed', lastActivityAt: new Date('2026-07-14') },
            { status: 'pending', lastActivityAt: new Date('2026-07-01') },
            { status: 'verify', lastActivityAt: new Date('2026-07-13') },
            { status: 'pending', lastActivityAt: new Date('2026-07-10') },
            { status: 'in_progress', lastActivityAt: new Date('2026-07-12') },
        ];
        const sorted = [...rows].sort(compareBugRowsForList);
        expect(sorted.map((row) => row.status)).toEqual(['pending', 'pending', 'in_progress', 'verify', 'closed']);
        expect(sorted[0].lastActivityAt.toISOString().slice(0, 10)).toBe('2026-07-10');
    });
});
