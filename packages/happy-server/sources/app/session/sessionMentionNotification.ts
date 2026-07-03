import { feedPost } from "@/app/feed/feedPost";
import { sendExpoPushNotifications } from "@/app/notifications/expoPush";
import { Context } from "@/context";
import { afterTx, Tx } from "@/storage/inTx";
import { warn } from "@/utils/log";

export async function notifySessionMentionRecipients(
    tx: Tx,
    params: {
        recipientUserIds: string[];
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
    const preview = params.preview.slice(0, 240);

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
                preview,
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
            body: preview.slice(0, 160) || `${params.actorName ?? "Someone"} mentioned you in a session`,
            data: {
                url: `/session/${params.sessionId}`,
                sessionId: params.sessionId,
                kind: "session_mention",
            },
        }).catch((err) => warn({ err }, "failed to send session mention push notifications"));
    });
}
