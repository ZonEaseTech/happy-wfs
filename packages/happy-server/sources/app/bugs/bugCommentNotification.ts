import { db } from '@/storage/db';
import { warn } from '@/utils/log';
import { NotificationConfigSchema } from 'happy-wire';
import {
    buildBugCommentNotificationCard,
    getGlobalFeishuMentionWebhook,
    sendFeishuMessage,
    type MentionRecipient,
} from '@/app/notifications/feishuAdapter';
import { bugDisplayId } from './bugPresenter';
import { stripBugImageMarkers } from './bugService';
import type { BugActor } from './bugTypes';

const DEFAULT_APP_URL = 'https://happy.zonease.org';

function getAppUrl(): string {
    return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}

/**
 * Feishu notification for a new bug comment, sent through the collaboration
 * mention webhooks. Candidates are the board owner, the bug creator, and the
 * commenting account, deduped by URL so one shared team bot receives a single
 * message. The bug creator renders as a real `<at>` ping when they configured
 * a Feishu user id and are not the commenter themselves. Failures only warn —
 * the comment itself has already been persisted.
 */
export async function notifyBugCommentToFeishu(bugId: string, actor: BugActor, commentBody: string, imageUrls: string[] = []): Promise<void> {
    // Inline images arrive as [[bug-image:N]] markers; image-only comments
    // have no text left once those go. Keep the notification readable.
    const previewBody = stripBugImageMarkers(commentBody) || '[图片]';
    const bug = await (db as any).bugReport.findUnique({
        where: { id: bugId },
        select: {
            displayNumber: true,
            title: true,
            ownerId: true,
            createdByUserId: true,
            createdByNickname: true,
            createdByUser: { select: { username: true } },
        },
    });
    if (!bug) return;

    const accountIds = Array.from(new Set(
        [bug.ownerId, bug.createdByUserId, actor.userId].filter((value): value is string => !!value),
    ));
    const accounts = await (db as any).account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, notificationConfig: true },
    });
    const configByAccountId = new Map<string, ReturnType<typeof NotificationConfigSchema.parse> | null>(
        accounts.map((account: any) => {
            const parsed = NotificationConfigSchema.safeParse(account.notificationConfig);
            return [account.id, parsed.success ? parsed.data : null] as const;
        }),
    );

    // A server-wide webhook overrides the per-account candidates entirely.
    const globalWebhook = getGlobalFeishuMentionWebhook();
    const webhooks: NonNullable<ReturnType<typeof NotificationConfigSchema.parse>['feishuMention']>[] = globalWebhook ? [globalWebhook] : [];
    if (!globalWebhook) {
        const seenUrls = new Set<string>();
        for (const accountId of accountIds) {
            const feishuMention = configByAccountId.get(accountId)?.feishuMention;
            if (!feishuMention?.enabled || !feishuMention.url || seenUrls.has(feishuMention.url)) {
                continue;
            }
            seenUrls.add(feishuMention.url);
            webhooks.push(feishuMention);
        }
    }
    if (webhooks.length === 0) return;

    const recipients: MentionRecipient[] = [];
    if (bug.createdByUserId && bug.createdByUserId !== actor.userId) {
        recipients.push({
            username: bug.createdByUser?.username ?? bug.createdByNickname ?? 'Happy 用户',
            feishuUserId: configByAccountId.get(bug.createdByUserId)?.feishuUserId ?? null,
        });
    }

    const card = buildBugCommentNotificationCard({
        bugDisplayId: bugDisplayId(bug.displayNumber),
        bugTitle: bug.title,
        actorName: actor.nickname,
        recipients,
        preview: previewBody,
        bugUrl: `${getAppUrl()}/bug`,
        imageUrls,
    });
    for (const webhook of webhooks) {
        try {
            await sendFeishuMessage(webhook, card);
        } catch (error) {
            warn({ error, bugId }, 'failed to send bug comment feishu notification');
        }
    }
}

/**
 * Clients post a comment first and upload its images afterwards, one request
 * each, so a notification sent when the comment is created has no images to
 * link. The body names how many to expect: every image carries a
 * [[bug-image:N]] marker. Hold the notification until that many are attached
 * to the comment, or until IMAGE_WAIT_MS passes, whichever comes first.
 */
const IMAGE_WAIT_MS = 60_000;

type PendingCommentNotification = {
    bugId: string;
    actor: BugActor;
    body: string;
    expectedImages: number;
    timer: ReturnType<typeof setTimeout>;
};

const pendingComments = new Map<string, PendingCommentNotification>();

export function countBugImageMarkers(body: string): number {
    let max = 0;
    for (const match of body.matchAll(/\[\[bug-image:(\d+)\]\]/g)) {
        max = Math.max(max, Number(match[1]));
    }
    return max;
}

async function commentImageUrls(commentId: string): Promise<string[]> {
    const rows = await (db as any).bugAttachment.findMany({
        where: { commentId },
        orderBy: { createdAt: 'asc' },
        select: { url: true },
    });
    return rows.map((row: { url: string }) => row.url);
}

async function flushCommentNotification(commentId: string): Promise<void> {
    const pending = pendingComments.get(commentId);
    if (!pending) return;
    pendingComments.delete(commentId);
    clearTimeout(pending.timer);
    const urls = await commentImageUrls(commentId).catch(() => []);
    await notifyBugCommentToFeishu(pending.bugId, pending.actor, pending.body, urls);
}

/** Notify now for a text-only comment, or once its images have arrived. */
export async function notifyBugCommentWhenReady(input: { commentId: string; bugId: string; actor: BugActor; body: string }): Promise<void> {
    const expectedImages = countBugImageMarkers(input.body);
    if (expectedImages === 0) {
        await notifyBugCommentToFeishu(input.bugId, input.actor, input.body);
        return;
    }
    const timer = setTimeout(() => {
        void flushCommentNotification(input.commentId).catch((error) => warn({ error, bugId: input.bugId }, 'failed to send bug comment feishu notification'));
    }, IMAGE_WAIT_MS);
    timer.unref?.();
    pendingComments.set(input.commentId, { bugId: input.bugId, actor: input.actor, body: input.body, expectedImages, timer });
}

/** Call after an image is attached; sends the held notification once the comment has them all. */
export async function onBugCommentImageAttached(commentId: string | undefined): Promise<void> {
    if (!commentId) return;
    const pending = pendingComments.get(commentId);
    if (!pending) return;
    try {
        const count = await (db as any).bugAttachment.count({ where: { commentId } });
        if (count >= pending.expectedImages) {
            await flushCommentNotification(commentId);
        }
    } catch (error) {
        // The fallback timer still sends it.
        warn({ error, bugId: pending.bugId }, 'failed to check bug comment images');
    }
}
