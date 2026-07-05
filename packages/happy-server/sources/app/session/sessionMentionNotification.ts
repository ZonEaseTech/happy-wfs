import { feedPost } from "@/app/feed/feedPost";
import { sendExpoPushNotifications } from "@/app/notifications/expoPush";
import { buildMentionNotificationCard, sendFeishuMessage } from "@/app/notifications/feishuAdapter";
import { Context } from "@/context";
import { db } from "@/storage/db";
import { afterTx, Tx } from "@/storage/inTx";
import { warn } from "@/utils/log";
import { NotificationConfigSchema } from "happy-wire";

const DEFAULT_APP_URL = "https://happy.zonease.org";

function getAppUrl(): string {
    return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

async function sendOwnerFeishuMentionNotification(params: {
    ownerId: string;
    recipientUsernames: string[];
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
        recipientUsernames: params.recipientUsernames,
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
            recipientUsernames: params.recipientUsernames,
            actorName: params.actorName,
            sessionId: params.sessionId,
            sessionTitle: params.sessionTitle,
            preview: params.preview,
        }).catch((err) => warn({ err }, "failed to send session mention feishu notification"));
    });
}
