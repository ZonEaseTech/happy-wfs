import { feedPost } from "@/app/feed/feedPost";
import { sendExpoPushNotifications } from "@/app/notifications/expoPush";
import { buildMentionNotificationCard, getGlobalFeishuMentionWebhook, sendFeishuMessage, type MentionRecipient } from "@/app/notifications/feishuAdapter";
import { Context } from "@/context";
import { db } from "@/storage/db";
import { afterTx, Tx } from "@/storage/inTx";
import { warn } from "@/utils/log";
import { NotificationConfigSchema } from "happy-wire";

const DEFAULT_APP_URL = "https://happy.zonease.org";

function getAppUrl(): string {
    return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

/**
 * Send the Feishu @ card for a mention. Webhook candidates are the session
 * owner, the actor, and every recipient (a shared session's actor/recipients
 * may have configured the team webhook even when the owner has not), deduped
 * by URL so a team sharing one group bot still gets exactly one message.
 * Recipients with a configured feishuUserId render as real `<at>` pings;
 * the rest degrade to plain text.
 */
async function sendFeishuMentionNotifications(params: {
    ownerId: string;
    actorId: string;
    recipients: { userId: string; username: string }[];
    actorName: string | null;
    sessionId: string;
    sessionTitle: string | null;
    preview: string;
}) {
    const accountIds = Array.from(new Set([
        params.ownerId,
        params.actorId,
        ...params.recipients.map((r) => r.userId),
    ]));
    const accounts = await db.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, notificationConfig: true },
    });
    const configByAccountId = new Map(accounts.map((account) => {
        const parsed = NotificationConfigSchema.safeParse(account.notificationConfig);
        return [account.id, parsed.success ? parsed.data : null] as const;
    }));

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
    if (webhooks.length === 0) {
        return;
    }

    const recipients: MentionRecipient[] = params.recipients.map((r) => ({
        username: r.username,
        feishuUserId: configByAccountId.get(r.userId)?.feishuUserId ?? null,
    }));
    const card = buildMentionNotificationCard({
        actorName: params.actorName,
        recipients,
        sessionTitle: params.sessionTitle,
        sessionUrl: `${getAppUrl()}/session/${params.sessionId}`,
        preview: params.preview,
    });
    for (const webhook of webhooks) {
        await sendFeishuMessage(webhook, card);
    }
}

export async function notifySessionMentionRecipients(
    tx: Tx,
    params: {
        ownerId: string;
        recipientUserIds: string[];
        recipientUsernames: string[];
        actorId: string;
        actorName: string | null;
        sessionId: string;
        messageLocalId: string;
        sessionTitle: string | null;
        preview: string;
    },
): Promise<void> {
    const recipientUserIds = Array.from(new Set(params.recipientUserIds))
        .filter((userId) => userId && userId !== params.actorId);
    if (recipientUserIds.length === 0) {
        return;
    }
    const usernameByUserId = new Map<string, string>();
    params.recipientUserIds.forEach((userId, index) => {
        const username = params.recipientUsernames[index];
        if (userId && username && !usernameByUserId.has(userId)) {
            usernameByUserId.set(userId, username);
        }
    });
    const recipients = recipientUserIds.map((userId) => ({
        userId,
        username: usernameByUserId.get(userId) ?? userId,
    }));
    const feedPreview = params.preview.slice(0, 240);

    for (const recipientUserId of recipientUserIds) {
        await feedPost(
            tx,
            Context.create(recipientUserId),
            {
                kind: "session_mention",
                sessionId: params.sessionId,
                actorId: params.actorId,
                actorName: params.actorName,
                sessionTitle: params.sessionTitle,
                preview: feedPreview,
            },
            `session-mention:${params.sessionId}:${params.messageLocalId}:${recipientUserId}`,
            true,
            {
                links: [{ label: "Open session", url: `/session/${params.sessionId}` }],
            },
        );
    }

    afterTx(tx, () => {
        void sendExpoPushNotifications(recipientUserIds, {
            title: "You were mentioned",
            body: feedPreview.slice(0, 160) || `${params.actorName ?? "Someone"} mentioned you in a session`,
            data: {
                url: `/session/${params.sessionId}`,
                sessionId: params.sessionId,
                kind: "session_mention",
            },
        }).catch((err) => warn({ err }, "failed to send session mention push notifications"));
        void sendFeishuMentionNotifications({
            ownerId: params.ownerId,
            actorId: params.actorId,
            recipients,
            actorName: params.actorName,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            preview: params.preview,
        }).catch((err) => warn({ err }, "failed to send session mention feishu notification"));
    });
}
