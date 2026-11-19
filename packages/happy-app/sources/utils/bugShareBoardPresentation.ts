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

/** One project tab on the board. `name` is null for bugs without a project. */
export interface BugBoardProject {
    name: string | null;
    count: number;
    lastActivityAt: number;
}

/**
 * The project tabs: named projects alphabetically, then the bugs without a
 * project, if any. Alphabetical so tabs keep their place as bugs move.
 */
export function getBugBoardProjects(bugs: BugReportSummary[]): BugBoardProject[] {
    const byName = new Map<string | null, BugBoardProject>();
    for (const bug of bugs) {
        const name = bug.project || null;
        const entry = byName.get(name) ?? { name, count: 0, lastActivityAt: 0 };
        entry.count += 1;
        entry.lastActivityAt = Math.max(entry.lastActivityAt, bug.lastActivityAt);
        byName.set(name, entry);
    }
    return [...byName.values()].sort((a, b) => {
        if (a.name === null) return 1;
        if (b.name === null) return -1;
        return a.name.localeCompare(b.name);
    });
}

/**
 * The project tab to show. The board has no "all projects" tab, so one is
 * always picked: the one remembered on this device while it still exists,
 * otherwise the project with the most recent activity. Undefined only when
 * the board has no bugs at all.
 */
export function pickBugBoardProject(projects: BugBoardProject[], remembered: string | null | undefined): string | null | undefined {
    if (remembered !== undefined && projects.some((project) => project.name === remembered)) return remembered;
    let latest: BugBoardProject | undefined;
    for (const project of projects) {
        if (!latest || project.lastActivityAt > latest.lastActivityAt) latest = project;
    }
    return latest?.name;
}

/** Bugs under one project tab; null picks the bugs without a project. */
export function bugsInProject(bugs: BugReportSummary[], project: string | null | undefined): BugReportSummary[] {
    if (project === undefined) return bugs;
    return bugs.filter((bug) => (bug.project || null) === project);
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
