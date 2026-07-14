import type { BugStatus, BugVisibility } from './bugTypes';

export function bugDisplayId(displayNumber: number): string {
    return `BUG-${displayNumber}`;
}

export function presentBugAttachment(row: any) {
    return {
        id: row.id,
        url: row.url,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width ?? null,
        height: row.height ?? null,
        thumbhash: row.thumbhash ?? null,
        uploadedByNickname: row.uploadedByNickname ?? null,
        createdAt: row.createdAt.getTime(),
    };
}

export function presentBugSummary(row: any) {
    return {
        id: row.id,
        displayNumber: row.displayNumber,
        displayId: bugDisplayId(row.displayNumber),
        title: row.title,
        description: row.description,
        contentJson: row.contentJson ?? null,
        status: row.status as BugStatus,
        visibility: row.visibility as BugVisibility,
        // Account identity beats the free-text nickname: authenticated
        // creators show their username, share-code creators keep the
        // nickname they typed at login.
        createdByNickname: row.createdByUser?.username ?? row.createdByNickname ?? null,
        attachmentCount: row._count?.attachments ?? row.attachments?.length ?? 0,
        commentCount: row._count?.comments ?? row.comments?.length ?? 0,
        lastActivityAt: row.lastActivityAt.getTime(),
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    };
}

export function presentBugDetail(row: any) {
    return {
        ...presentBugSummary(row),
        sessionId: row.sessionId ?? null,
        attachments: (row.attachments ?? []).filter((attachment: any) => !attachment.commentId).map(presentBugAttachment),
        comments: (row.comments ?? []).map((comment: any) => ({
            id: comment.id,
            body: comment.body,
            authorNickname: comment.authorNickname ?? null,
            createdAt: comment.createdAt.getTime(),
            attachments: (comment.attachments ?? []).map(presentBugAttachment),
        })),
        statusHistory: (row.statusHistory ?? []).map((entry: any) => ({
            id: entry.id,
            action: entry.action,
            fromStatus: entry.fromStatus ?? null,
            toStatus: entry.toStatus,
            actorNickname: entry.actorNickname ?? null,
            note: entry.note ?? null,
            createdAt: entry.createdAt.getTime(),
        })),
    };
}
