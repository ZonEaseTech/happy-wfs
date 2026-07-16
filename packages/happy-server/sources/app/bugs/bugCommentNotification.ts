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
export async function notifyBugCommentToFeishu(bugId: string, actor: BugActor, commentBody: string): Promise<void> {
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
        preview: commentBody,
        bugUrl: `${getAppUrl()}/bug`,
    });
    for (const webhook of webhooks) {
        try {
            await sendFeishuMessage(webhook, card);
        } catch (error) {
            warn({ error, bugId }, 'failed to send bug comment feishu notification');
        }
    }
}
