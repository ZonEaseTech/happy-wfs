import { feedPost } from "@/app/feed/feedPost";
import { sendExpoPushNotifications } from "@/app/notifications/expoPush";
import { buildMentionNotificationCard, sendFeishuMessage, type MentionRecipient } from "@/app/notifications/feishuAdapter";
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
 * Resolve each recipient's self-configured Feishu identity so the owner's
 * mention webhook can render a real `<at>` ping. Missing/invalid configs
 * degrade to null → plain-text fallback in the card.
 */
async function resolveMentionRecipients(
    recipients: { userId: string; username: string }[],
): Promise<MentionRecipient[]> {
    if (recipients.length === 0) {
        return [];
    }
    const accounts = await db.account.findMany({
        where: { id: { in: recipients.map((r) => r.userId) } },
        select: { id: true, notificationConfig: true },
    });
    const feishuUserIdByAccountId = new Map<string, string>();
    for (const account of accounts) {
        const parsed = NotificationConfigSchema.safeParse(account.notificationConfig);
        if (parsed.success && parsed.data.feishuUserId) {
            feishuUserIdByAccountId.set(account.id, parsed.data.feishuUserId);
        }
    }
    return recipients.map((r) => ({
        username: r.username,
        feishuUserId: feishuUserIdByAccountId.get(r.userId) ?? null,
    }));
}

async function sendOwnerFeishuMentionNotification(params: {
    ownerId: string;
    recipients: { userId: string; username: string }[];
    actorName: string | null;
    sessionId: string;
    sessionTitle: string | null;
    preview: string;
}) {
    const account = await db.account.findUnique({
        where: { id: params.ownerId },
        select: { notificationConfig: true },
    });
    const parsed = NotificationConfigSchema.safeParse(account?.notificationConfig);
    if (!parsed.success) {
        return;
    }
    const feishuMention = parsed.data.feishuMention;
    if (!feishuMention?.enabled || !feishuMention.url) {
        return;
    }

    await sendFeishuMessage(feishuMention, buildMentionNotificationCard({
        actorName: params.actorName,
        recipients: await resolveMentionRecipients(params.recipients),
        sessionTitle: params.sessionTitle,
        sessionUrl: `${getAppUrl()}/session/${params.sessionId}`,
        preview: params.preview,
    }));
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
        void sendOwnerFeishuMentionNotification({
            ownerId: params.ownerId,
            recipients,
            actorName: params.actorName,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            preview: params.preview,
        }).catch((err) => warn({ err }, "failed to send session mention feishu notification"));
    });
}
