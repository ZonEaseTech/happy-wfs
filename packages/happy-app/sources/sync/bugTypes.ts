import { stripBugImageMarkers } from './bugRichContent';
export const BUG_IMAGE_LIMITS = {
    maxImages: 10,
    maxSizeBytes: 20 * 1024 * 1024,
} as const;

export type BugStatus = 'pending' | 'in_progress' | 'verify' | 'closed';
export type BugVisibility = 'shared' | 'private';
export type BugStatusHistoryAction = 'created' | 'status_change' | 'return_to_pending' | 'comment' | 'attachment' | 'start_session' | 'closed' | 'deleted';

export interface BugAttachment {
    id: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
    uploadedByNickname: string | null;
    createdAt: number;
}

export interface BugComment {
    id: string;
    body: string;
    authorNickname: string | null;
    createdAt: number;
    attachments: BugAttachment[];
}

export interface BugStatusHistoryEntry {
    id: string;
    action: BugStatusHistoryAction;
    fromStatus: BugStatus | null;
    toStatus: BugStatus;
    actorNickname: string | null;
    note: string | null;
    createdAt: number;
}

export interface BugReportSummary {
    id: string;
    displayNumber: number;
    displayId: string;
    title: string;
    description: string;
    status: BugStatus;
    visibility: BugVisibility;
    createdByNickname: string | null;
    attachmentCount: number;
    commentCount: number;
    lastActivityAt: number;
    createdAt: number;
    updatedAt: number;
}

export interface BugReportDetail extends BugReportSummary {
    sessionId: string | null;
    attachments: BugAttachment[];
    comments: BugComment[];
    statusHistory: BugStatusHistoryEntry[];
}

export function bugDisplayId(displayNumber: number): string {
    return `BUG-${displayNumber}`;
}

export function bugStatusLabel(status: BugStatus): string {
    switch (status) {
        case 'pending': return '待处理';
        case 'in_progress': return '进行中';
        case 'verify': return '待验证';
        case 'closed': return '已关闭';
    }
}

export function buildBugTitle(description: string): string {
    const normalized = stripBugImageMarkers(description).replace(/\s+/g, ' ');
    if (normalized.length <= 36) return normalized;
    return `${normalized.slice(0, 36)}…`;
}

export function formatBugStatusHistoryAction(entry: Pick<BugStatusHistoryEntry, 'action' | 'fromStatus' | 'toStatus'>): string {
    if (entry.action === 'return_to_pending') {
        return `打回待处理：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.action === 'start_session') {
        return `开启修复会话：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.action === 'closed') {
        return `关闭 Bug：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.action === 'deleted') {
        return `删除不显示：${entry.fromStatus ? bugStatusLabel(entry.fromStatus) : '无状态'} → ${bugStatusLabel(entry.toStatus)}`;
    }
    if (entry.fromStatus) {
        return `状态变更：${bugStatusLabel(entry.fromStatus)} → ${bugStatusLabel(entry.toStatus)}`;
    }
    return bugStatusLabel(entry.toStatus);
}

export function matchesBugSearch(bug: BugReportSummary, query: string): boolean {
    const normalized = query.trim().replace(/^#/, '').toLowerCase();
    if (!normalized) return true;
    const haystack = [
        bug.displayId,
        String(bug.displayNumber),
        bug.title,
        bug.description,
        bug.createdByNickname ?? '',
        bugStatusLabel(bug.status),
    ].join('\n').toLowerCase();
    return haystack.includes(normalized);
}
