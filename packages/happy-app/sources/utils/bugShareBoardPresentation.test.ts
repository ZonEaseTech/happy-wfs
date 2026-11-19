import { describe, expect, it } from 'vitest';
import type { BugReportSummary } from '@/sync/bugTypes';
import {
    bugsInProject,
    filterBugShareBoardItems,
    getBugBoardProjects,
    pickBugBoardProject,
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
        contentJson: overrides.contentJson ?? null,
        status: overrides.status,
        visibility: 'shared',
        createdByNickname: overrides.createdByNickname ?? 'Happy 用户',
        attachmentCount: overrides.attachmentCount ?? 0,
        commentCount: overrides.commentCount ?? 0,
        project: overrides.project ?? null,
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

describe('bug board projects', () => {
    const bugs = [
        bug({ id: 'a', displayNumber: 1, status: 'pending', lastActivityAt: 10, project: 'lite-pos' }),
        bug({ id: 'b', displayNumber: 2, status: 'closed', lastActivityAt: 50, project: 'TTPOS' }),
        bug({ id: 'c', displayNumber: 3, status: 'pending', lastActivityAt: 30, project: 'TTPOS' }),
        bug({ id: 'd', displayNumber: 4, status: 'closed', lastActivityAt: 90 }),
    ];

    it('lists named projects alphabetically with the unassigned bugs last', () => {
        expect(getBugBoardProjects(bugs)).toEqual([
            { name: 'lite-pos', count: 1, lastActivityAt: 10 },
            { name: 'TTPOS', count: 2, lastActivityAt: 50 },
            { name: null, count: 1, lastActivityAt: 90 },
        ]);
    });

    it('keeps the remembered project while it exists, else the most recently active one', () => {
        const projects = getBugBoardProjects(bugs);
        expect(pickBugBoardProject(projects, 'TTPOS')).toBe('TTPOS');
        expect(pickBugBoardProject(projects, null)).toBeNull();
        expect(pickBugBoardProject(projects, 'gone')).toBeNull();
        expect(pickBugBoardProject(getBugBoardProjects(bugs.slice(0, 3)), undefined)).toBe('TTPOS');
        expect(pickBugBoardProject([], 'TTPOS')).toBeUndefined();
    });

    it('scopes bugs to one project tab', () => {
        expect(bugsInProject(bugs, 'TTPOS').map((item) => item.id)).toEqual(['b', 'c']);
        expect(bugsInProject(bugs, null).map((item) => item.id)).toEqual(['d']);
        expect(bugsInProject(bugs, undefined)).toHaveLength(4);
    });
});
