import { createHash } from 'crypto';
import { db } from '@/storage/db';
import { inTx, type Tx } from '@/storage/inTx';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { BugStatusSchema, BugVisibilitySchema, type BugActor, type BugStatus } from './bugTypes';
import { bugDisplayId, presentBugDetail, presentBugSummary } from './bugPresenter';

const detailInclude = {
    attachments: { orderBy: { createdAt: 'asc' } },
    comments: { orderBy: { createdAt: 'asc' }, include: { attachments: { orderBy: { createdAt: 'asc' } } } },
    statusHistory: { orderBy: { createdAt: 'asc' } },
    _count: { select: { attachments: true, comments: true } },
};

const summaryInclude = {
    _count: { select: { attachments: true, comments: true } },
};

function bugDb(tx: Tx | typeof db = db): any {
    return tx as any;
}

function errorWithStatus(statusCode: number, message: string): Error & { statusCode: number } {
    const error = new Error(message) as Error & { statusCode: number };
    error.statusCode = statusCode;
    return error;
}

function actorUserId(actor: BugActor): string | null {
    return actor.userId ?? null;
}

function actorNickname(actor: BugActor): string {
    return actor.nickname.trim() || '匿名用户';
}

function stripBugImageMarkers(description: string): string {
    return description
        .replace(/\[\[bug-image:\d+\]\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function buildBugTitle(description: string): string {
    const normalized = stripBugImageMarkers(description).replace(/\s+/g, ' ');
    if (normalized.length <= 36) return normalized;
    return `${normalized.slice(0, 36)}…`;
}

export function normalizeBugStatusChange(currentStatus: string, input: { status: string; action?: string }) {
    const parsed = BugStatusSchema.parse(input.status);
    const action = input.action === 'return_to_pending'
        ? 'return_to_pending'
        : parsed === 'closed'
            ? 'closed'
            : 'status_change';
    return { fromStatus: currentStatus, toStatus: parsed, action };
}

export function hashBugShareAccessCode(accessCode: string): Buffer {
    return createHash('sha256').update(accessCode, 'utf8').digest();
}

export function generateBugShareAccessCode(): string {
    return randomKeyNaked(10);
}

function bugMatchesQuery(row: any, query: string): boolean {
    const normalized = query.trim().replace(/^#/, '').toLowerCase();
    if (!normalized) return true;
    const haystack = [
        bugDisplayId(row.displayNumber),
        String(row.displayNumber),
        row.title,
        row.description,
        row.createdByNickname ?? '',
        row.status,
    ].join('\n').toLowerCase();
    return haystack.includes(normalized);
}

async function findBugRowForOwner(tx: Tx | typeof db, ownerId: string, bugId: string) {
    const row = await bugDb(tx).bugReport.findFirst({
        where: { id: bugId, ownerId, deletedAt: null },
        include: detailInclude,
    });
    if (!row) throw errorWithStatus(404, 'Bug not found');
    return row;
}

export async function listBugsForOwner(ownerId: string, input: { status?: string; query?: string; limit?: number; publicOnly?: boolean }) {
    const status = input.status ? BugStatusSchema.parse(input.status) : undefined;
    const where = {
        ownerId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(input.publicOnly ? { visibility: 'shared' } : {}),
    };
    const [rows, pendingCount] = await Promise.all([
        bugDb().bugReport.findMany({
            where,
            orderBy: { lastActivityAt: 'desc' },
            take: Math.min(Math.max(input.limit ?? 100, 1), 200),
            include: summaryInclude,
        }),
        bugDb().bugReport.count({
            where: {
                ownerId,
                deletedAt: null,
                status: 'pending',
                ...(input.publicOnly ? { visibility: 'shared' } : {}),
            },
        }),
    ]);
    const bugs = rows
        .filter((row: any) => !input.query || bugMatchesQuery(row, input.query))
        .map(presentBugSummary);
    return { bugs, pendingCount };
}

export async function getBugForOwner(ownerId: string, bugId: string, input: { publicOnly?: boolean } = {}) {
    const row = await findBugRowForOwner(db, ownerId, bugId);
    if (input.publicOnly && row.visibility !== 'shared') throw errorWithStatus(404, 'Bug not found');
    return presentBugDetail(row);
}

export async function createBugForOwner(ownerId: string, actor: BugActor, input: { description: string; visibility?: string }) {
    const description = input.description.trim();
    if (!description) throw errorWithStatus(400, 'description is required');
    const visibility = BugVisibilitySchema.parse(input.visibility ?? 'shared');
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    const row = await inTx(async (tx) => {
        const bug = await bugDb(tx).bugReport.create({
            data: {
                ownerId,
                createdByUserId: userId,
                createdByNickname: nickname,
                title: buildBugTitle(description),
                description,
                status: 'pending',
                visibility,
                lastActivityAt: new Date(),
            },
        });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId: bug.id,
                actorUserId: userId,
                actorNickname: nickname,
                action: 'created',
                toStatus: 'pending',
            },
        });
        return await bugDb(tx).bugReport.findUnique({ where: { id: bug.id }, include: detailInclude });
    });
    return presentBugDetail(row);
}

export async function addBugComment(ownerId: string, bugId: string, actor: BugActor, body: string, input: { publicOnly?: boolean } = {}) {
    const trimmed = body.trim();
    if (!trimmed) throw errorWithStatus(400, 'body is required');
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    const result = await inTx(async (tx) => {
        const bug = await findBugRowForOwner(tx, ownerId, bugId);
        if (input.publicOnly && bug.visibility !== 'shared') throw errorWithStatus(404, 'Bug not found');
        const comment = await bugDb(tx).bugComment.create({
            data: {
                bugId,
                authorUserId: userId,
                authorNickname: nickname,
                body: trimmed,
            },
        });
        await bugDb(tx).bugReport.update({ where: { id: bugId }, data: { lastActivityAt: new Date() } });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId,
                actorUserId: userId,
                actorNickname: nickname,
                action: 'comment',
                fromStatus: bug.status,
                toStatus: bug.status,
            },
        });
        const updated = await bugDb(tx).bugReport.findUnique({ where: { id: bugId }, include: detailInclude });
        return { bug: updated, commentId: comment.id };
    });
    return { bug: presentBugDetail(result.bug), commentId: result.commentId };
}

export async function changeBugStatus(ownerId: string, bugId: string, actor: BugActor, input: { status: string; action?: string; publicOnly?: boolean }) {
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    const row = await inTx(async (tx) => {
        const bug = await findBugRowForOwner(tx, ownerId, bugId);
        if (input.publicOnly && bug.visibility !== 'shared') throw errorWithStatus(404, 'Bug not found');
        const change = normalizeBugStatusChange(bug.status, input);
        await bugDb(tx).bugReport.update({
            where: { id: bugId },
            data: { status: change.toStatus, lastActivityAt: new Date() },
        });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId,
                actorUserId: userId,
                actorNickname: nickname,
                action: change.action,
                fromStatus: change.fromStatus,
                toStatus: change.toStatus,
            },
        });
        return await bugDb(tx).bugReport.findUnique({ where: { id: bugId }, include: detailInclude });
    });
    return presentBugDetail(row);
}

export async function softDeleteBugForOwner(ownerId: string, bugId: string, actor: BugActor) {
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    await inTx(async (tx) => {
        const bug = await findBugRowForOwner(tx, ownerId, bugId);
        const now = new Date();
        await bugDb(tx).bugReport.update({
            where: { id: bugId },
            data: { deletedAt: now, lastActivityAt: now },
        });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId,
                actorUserId: userId,
                actorNickname: nickname,
                action: 'deleted',
                fromStatus: bug.status,
                toStatus: bug.status,
                note: 'delete_hide',
            },
        });
    });
}

export async function linkBugSession(ownerId: string, bugId: string, sessionId: string, actor: BugActor) {
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    const row = await inTx(async (tx) => {
        const [bug, session] = await Promise.all([
            findBugRowForOwner(tx, ownerId, bugId),
            bugDb(tx).session.findFirst({ where: { id: sessionId, accountId: ownerId } }),
        ]);
        if (!session) throw errorWithStatus(404, 'Session not found');
        await bugDb(tx).bugReport.update({
            where: { id: bugId },
            data: { sessionId, status: 'in_progress', lastActivityAt: new Date() },
        });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId,
                actorUserId: userId,
                actorNickname: nickname,
                action: 'start_session',
                fromStatus: bug.status,
                toStatus: 'in_progress',
            },
        });
        return await bugDb(tx).bugReport.findUnique({ where: { id: bugId }, include: detailInclude });
    });
    return presentBugDetail(row);
}

export async function recordBugAttachment(ownerId: string, bugId: string, actor: BugActor, attachment: {
    commentId?: string;
    path: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    thumbhash: string | null;
}, input: { publicOnly?: boolean } = {}) {
    const nickname = actorNickname(actor);
    const userId = actorUserId(actor);
    const row = await inTx(async (tx) => {
        const bug = await findBugRowForOwner(tx, ownerId, bugId);
        if (input.publicOnly && bug.visibility !== 'shared') throw errorWithStatus(404, 'Bug not found');
        if (attachment.commentId) {
            const comment = await bugDb(tx).bugComment.findFirst({ where: { id: attachment.commentId, bugId } });
            if (!comment) throw errorWithStatus(404, 'Comment not found');
        }
        await bugDb(tx).bugAttachment.create({
            data: {
                bugId,
                commentId: attachment.commentId ?? null,
                uploadedByUserId: userId,
                uploadedByNickname: nickname,
                path: attachment.path,
                url: attachment.url,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                width: attachment.width,
                height: attachment.height,
                thumbhash: attachment.thumbhash,
            },
        });
        await bugDb(tx).bugReport.update({ where: { id: bugId }, data: { lastActivityAt: new Date() } });
        await bugDb(tx).bugStatusHistory.create({
            data: {
                bugId,
                actorUserId: userId,
                actorNickname: nickname,
                action: 'attachment',
                fromStatus: bug.status,
                toStatus: bug.status,
            },
        });
        return await bugDb(tx).bugReport.findUnique({ where: { id: bugId }, include: detailInclude });
    });
    return presentBugDetail(row);
}

export async function createOrRotateBugShareConfig(ownerId: string, accessCode?: string) {
    const nextAccessCode = accessCode?.trim() || generateBugShareAccessCode();
    const hash = hashBugShareAccessCode(nextAccessCode);
    const config = await inTx(async (tx) => {
        const existing = await bugDb(tx).bugShareConfig.findUnique({ where: { ownerId } });
        if (!existing) {
            return await bugDb(tx).bugShareConfig.create({
                data: { ownerId, accessCode: nextAccessCode, accessCodeHash: hash, enabled: true },
            });
        }
        return await bugDb(tx).bugShareConfig.update({
            where: { ownerId },
            data: {
                accessCode: nextAccessCode,
                accessCodeHash: hash,
                accessCodeVersion: { increment: 1 },
                enabled: true,
            },
        });
    });
    return { config, accessCode: nextAccessCode };
}

export async function getBugShareConfig(ownerId: string) {
    return await bugDb().bugShareConfig.findUnique({
        where: { ownerId },
        select: { id: true, ownerId: true, enabled: true, accessCode: true, accessCodeVersion: true, createdAt: true, updatedAt: true },
    });
}

export async function findBugShareConfigByAccessCode(accessCode: string) {
    return await bugDb().bugShareConfig.findUnique({
        where: { accessCodeHash: hashBugShareAccessCode(accessCode) },
    });
}

export async function getValidBugShareConfig(configId: string, version: number) {
    const config = await bugDb().bugShareConfig.findUnique({ where: { id: configId } });
    if (!config || !config.enabled || config.accessCodeVersion !== version) {
        throw errorWithStatus(401, 'bug_share_expired');
    }
    return config;
}

export function assertBugStatus(status: string): BugStatus {
    return BugStatusSchema.parse(status);
}
