import type { BugReportSummary, BugStatus } from '@/sync/bugTypes';
import { matchesBugSearch } from '@/sync/bugTypes';

export type BugShareBoardFilter = 'all' | 'open' | BugStatus | 'has_comments' | 'has_attachments';

export const BUG_SHARE_BOARD_FILTERS: BugShareBoardFilter[] = [
    'all',
    'open',
    'pending',
    'in_progress',
    'verify',
    'closed',
    'has_comments',
    'has_attachments',
];

export function getBugShareBoardCounts(bugs: BugReportSummary[]): Record<BugShareBoardFilter, number> {
    return {
        all: bugs.length,
        open: bugs.filter((bug) => bug.status !== 'closed').length,
        pending: bugs.filter((bug) => bug.status === 'pending').length,
        in_progress: bugs.filter((bug) => bug.status === 'in_progress').length,
        verify: bugs.filter((bug) => bug.status === 'verify').length,
        closed: bugs.filter((bug) => bug.status === 'closed').length,
        has_comments: bugs.filter((bug) => bug.commentCount > 0).length,
        has_attachments: bugs.filter((bug) => bug.attachmentCount > 0).length,
    };
}

function matchesFilter(bug: BugReportSummary, filter: BugShareBoardFilter): boolean {
    switch (filter) {
        case 'all': return true;
        case 'open': return bug.status !== 'closed';
        case 'has_comments': return bug.commentCount > 0;
        case 'has_attachments': return bug.attachmentCount > 0;
        default: return bug.status === filter;
    }
}

export function filterBugShareBoardItems(
    bugs: BugReportSummary[],
    { filter, query }: { filter: BugShareBoardFilter; query: string },
): BugReportSummary[] {
    return bugs
        .filter((bug) => matchesFilter(bug, filter))
        .filter((bug) => matchesBugSearch(bug, query))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
