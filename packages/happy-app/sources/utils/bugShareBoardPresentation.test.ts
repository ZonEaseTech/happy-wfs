import { describe, expect, it } from 'vitest';
import type { BugReportSummary } from '@/sync/bugTypes';
import {
    filterBugShareBoardItems,
    getBugShareBoardCounts,
    type BugShareBoardFilter,
} from './bugShareBoardPresentation';

function bug(overrides: Partial<BugReportSummary> & Pick<BugReportSummary, 'id' | 'displayNumber' | 'status' | 'lastActivityAt'>): BugReportSummary {
    return {
        id: overrides.id,
        displayNumber: overrides.displayNumber,
        displayId: `BUG-${overrides.displayNumber}`,
        title: overrides.title ?? `Bug ${overrides.displayNumber}`,
        description: overrides.description ?? '',
        status: overrides.status,
        visibility: 'shared',
        createdByNickname: overrides.createdByNickname ?? 'Happy 用户',
        attachmentCount: overrides.attachmentCount ?? 0,
        commentCount: overrides.commentCount ?? 0,
        lastActivityAt: overrides.lastActivityAt,
        createdAt: overrides.createdAt ?? overrides.lastActivityAt,
        updatedAt: overrides.updatedAt ?? overrides.lastActivityAt,
    };
}

describe('bug share board presentation', () => {
    const bugs = [
        bug({ id: 'closed', displayNumber: 4, status: 'closed', lastActivityAt: 40, title: '已关闭问题' }),
        bug({ id: 'pending', displayNumber: 3, status: 'pending', lastActivityAt: 30, title: '支付状态异常', attachmentCount: 2 }),
        bug({ id: 'progress', displayNumber: 2, status: 'in_progress', lastActivityAt: 50, title: '库存同步错误', commentCount: 1 }),
        bug({ id: 'verify', displayNumber: 1, status: 'verify', lastActivityAt: 20, description: '需要同事确认' }),
    ];

    it('defaults to unfinished bugs sorted by recent activity', () => {
        expect(filterBugShareBoardItems(bugs, { filter: 'open', query: '' }).map(item => item.id))
            .toEqual(['progress', 'pending', 'verify']);
    });

    it('combines status filter and search query', () => {
        expect(filterBugShareBoardItems(bugs, { filter: 'pending', query: '支付' }).map(item => item.id))
            .toEqual(['pending']);
        expect(filterBugShareBoardItems(bugs, { filter: 'pending', query: '库存' })).toEqual([]);
    });

    it('supports attachment and comment quick filters', () => {
        expect(filterBugShareBoardItems(bugs, { filter: 'has_attachments', query: '' }).map(item => item.id))
            .toEqual(['pending']);
        expect(filterBugShareBoardItems(bugs, { filter: 'has_comments', query: '' }).map(item => item.id))
            .toEqual(['progress']);
    });

    it('counts all status and quick filter groups', () => {
        expect(getBugShareBoardCounts(bugs)).toMatchObject({
            all: 4,
            open: 3,
            pending: 1,
            in_progress: 1,
            verify: 1,
            closed: 1,
            has_comments: 1,
            has_attachments: 1,
        } satisfies Record<BugShareBoardFilter, number>);
    });
});
