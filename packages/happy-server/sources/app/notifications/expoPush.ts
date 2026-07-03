import axios from "axios";
import { db } from "@/storage/db";
import { warn } from "@/utils/log";

type ExpoPushNotification = {
    title: string;
    body: string;
    data?: Record<string, unknown>;
};

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

export async function sendExpoPushNotifications(
    userIds: string[],
    notification: ExpoPushNotification,
): Promise<void> {
    try {
        const uniqueUserIds = Array.from(new Set(userIds)).filter(Boolean);
        if (uniqueUserIds.length === 0) {
            return;
        }

        const tokens = await db.accountPushToken.findMany({
            where: {
                accountId: { in: uniqueUserIds },
            },
            select: {
                accountId: true,
                token: true,
            },
        });
        if (tokens.length === 0) {
            return;
        }

        const badgeByUserId = new Map<string, number>();
        for (const userId of uniqueUserIds) {
            const account = await db.account.update({
                where: { id: userId },
                data: { badgeCount: { increment: 1 } },
                select: { badgeCount: true },
            });
            badgeByUserId.set(userId, account.badgeCount);
        }

        const messages = tokens.map((item) => ({
            to: item.token,
            sound: "default",
            title: notification.title,
            body: notification.body,
            data: notification.data ?? {},
            badge: badgeByUserId.get(item.accountId) ?? undefined,
        }));

        for (const messagesChunk of chunk(messages, EXPO_PUSH_CHUNK_SIZE)) {
            await axios.post(EXPO_PUSH_ENDPOINT, messagesChunk, {
                timeout: 10_000,
                headers: {
                    "Content-Type": "application/json",
                },
            });
        }
    } catch (err) {
        warn({ err }, "failed to send expo push notifications");
    }
}
