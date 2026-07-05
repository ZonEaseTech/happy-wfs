import { describe, expect, it, vi, beforeEach } from "vitest";

const {
    dbMock,
    feedPostMock,
    sendExpoPushNotificationsMock,
    sendFeishuMessageMock,
    afterTxMock,
} = vi.hoisted(() => ({
    dbMock: {
        account: {
            findUnique: vi.fn(async () => ({ notificationConfig: null })),
        },
    },
    feedPostMock: vi.fn(async () => undefined),
    sendExpoPushNotificationsMock: vi.fn(async () => undefined),
    sendFeishuMessageMock: vi.fn(async () => undefined),
    afterTxMock: vi.fn((_tx: unknown, callback: () => void) => callback()),
}));

vi.mock("@/storage/db", () => ({
    db: dbMock,
}));

vi.mock("@/app/feed/feedPost", () => ({
    feedPost: feedPostMock,
}));

vi.mock("@/app/notifications/expoPush", () => ({
    sendExpoPushNotifications: sendExpoPushNotificationsMock,
}));

vi.mock("@/app/notifications/feishuAdapter", async () => {
    const actual = await vi.importActual<typeof import("@/app/notifications/feishuAdapter")>("@/app/notifications/feishuAdapter");
    return {
        ...actual,
        sendFeishuMessage: sendFeishuMessageMock,
    };
});

vi.mock("@/storage/inTx", () => ({
    afterTx: afterTxMock,
}));

vi.mock("@/utils/log", () => ({
    warn: vi.fn(),
}));

import { notifySessionMentionRecipients } from "./sessionMentionNotification";

describe("notifySessionMentionRecipients", () => {
    beforeEach(() => {
        dbMock.account.findUnique.mockReset();
        dbMock.account.findUnique.mockResolvedValue({ notificationConfig: null });
        feedPostMock.mockClear();
        sendExpoPushNotificationsMock.mockClear();
        sendFeishuMessageMock.mockClear();
        afterTxMock.mockClear();
        process.env.APP_URL = "https://happy.zonease.org";
    });

    it("creates one session_mention feed item per deduped target with badge", async () => {
        await notifySessionMentionRecipients({} as never, {
            ownerId: "u1",
            recipientUserIds: ["u2", "u2", "u3"],
            recipientUsernames: ["Bob", "Bob", "Chris"],
            actorId: "u1",
            actorName: "Alice",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: "Session title",
            preview: "Please check this",
        });

        expect(feedPostMock).toHaveBeenCalledTimes(2);
        expect(feedPostMock).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({ uid: "u2" }),
            expect.objectContaining({
                kind: "session_mention",
                sessionId: "session-1",
                actorId: "u1",
                actorName: "Alice",
                sessionTitle: "Session title",
                preview: "Please check this",
            }),
            "session-mention:session-1:local-1:u2",
            true,
            expect.anything(),
        );
        expect(feedPostMock).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({ uid: "u3" }),
            expect.anything(),
            "session-mention:session-1:local-1:u3",
            true,
            expect.anything(),
        );
    });

    it("does not notify the actor", async () => {
        await notifySessionMentionRecipients({} as never, {
            ownerId: "u1",
            recipientUserIds: ["u1", "u2"],
            recipientUsernames: ["Alice", "Bob"],
            actorId: "u1",
            actorName: "Alice",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: null,
            preview: "Please check this",
        });

        expect(feedPostMock).toHaveBeenCalledTimes(1);
        expect(feedPostMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ uid: "u2" }),
            expect.anything(),
            expect.anything(),
            true,
            expect.anything(),
        );
    });

    it("does not throw when push delivery fails", async () => {
        sendExpoPushNotificationsMock.mockRejectedValueOnce(new Error("push failed"));

        await expect(notifySessionMentionRecipients({} as never, {
            ownerId: "u1",
            recipientUserIds: ["u2"],
            recipientUsernames: ["Bob"],
            actorId: "u1",
            actorName: "Alice",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: null,
            preview: "Please check this",
        })).resolves.toBeUndefined();

        await Promise.resolve();
        expect(sendExpoPushNotificationsMock).toHaveBeenCalledTimes(1);
    });

    it("posts one Feishu mention notification to the session owner webhook after the transaction", async () => {
        dbMock.account.findUnique.mockResolvedValue({
            notificationConfig: {
                feishu: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/normal", enabled: true },
                feishuMention: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/mention", enabled: true, secret: "mention-secret" },
            },
        } as any);

        await notifySessionMentionRecipients({} as never, {
            ownerId: "owner-1",
            recipientUserIds: ["user-2"],
            recipientUsernames: ["youthqx"],
            actorId: "owner-1",
            actorName: "wfs",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: "支付问题排查",
            preview: "请来确认订单状态没有刷新",
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(dbMock.account.findUnique).toHaveBeenCalledWith({
            where: { id: "owner-1" },
            select: { notificationConfig: true },
        });
        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        expect(sendFeishuMessageMock).toHaveBeenCalledWith(
            { url: "https://open.feishu.cn/open-apis/bot/v2/hook/mention", enabled: true, secret: "mention-secret" },
            expect.objectContaining({
                msg_type: "text",
                content: expect.objectContaining({
                    text: expect.stringContaining("被 @：@youthqx"),
                }),
            }),
        );
        const payload = (sendFeishuMessageMock.mock.calls[0] as any)[1];
        expect(payload.content.text).toContain("https://happy.zonease.org/session/session-1");
    });
});
