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
            findMany: vi.fn(async () => [] as { id: string; notificationConfig: unknown }[]),
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
        dbMock.account.findMany.mockReset();
        dbMock.account.findMany.mockResolvedValue([]);
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

    it("posts one Feishu mention notification through the owner webhook after the transaction", async () => {
        dbMock.account.findMany.mockResolvedValue([
            {
                id: "owner-1",
                notificationConfig: {
                    feishu: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/normal", enabled: true },
                    feishuMention: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/mention", enabled: true, secret: "mention-secret" },
                },
            },
            { id: "user-2", notificationConfig: null },
        ] as any);

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

        expect(dbMock.account.findMany).toHaveBeenCalledWith({
            where: { id: { in: ["owner-1", "user-2"] } },
            select: { id: true, notificationConfig: true },
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

    it("renders a real <at> ping when the recipient account has a Feishu user id configured", async () => {
        dbMock.account.findMany.mockResolvedValue([
            {
                id: "owner-1",
                notificationConfig: {
                    feishuMention: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/mention", enabled: true },
                },
            },
            { id: "user-2", notificationConfig: { feishuUserId: "ou_abc123" } },
            { id: "user-3", notificationConfig: null },
        ] as any);

        await notifySessionMentionRecipients({} as never, {
            ownerId: "owner-1",
            recipientUserIds: ["user-2", "user-3"],
            recipientUsernames: ["youthqx", "bob"],
            actorId: "owner-1",
            actorName: "wfs",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: null,
            preview: "请确认",
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        const payload = (sendFeishuMessageMock.mock.calls[0] as any)[1];
        expect(payload.content.text).toContain('<at user_id="ou_abc123">youthqx</at>、@bob');
    });

    it("falls back to the actor webhook when a shared-session owner has no config", async () => {
        dbMock.account.findMany.mockResolvedValue([
            { id: "owner-9", notificationConfig: null },
            {
                id: "actor-1",
                notificationConfig: {
                    feishuMention: { url: "https://open.feishu.cn/open-apis/bot/v2/hook/team", enabled: true },
                },
            },
            { id: "user-2", notificationConfig: null },
        ] as any);

        await notifySessionMentionRecipients({} as never, {
            ownerId: "owner-9",
            recipientUserIds: ["user-2"],
            recipientUsernames: ["youthqx"],
            actorId: "actor-1",
            actorName: "wfs",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: null,
            preview: "请确认",
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        expect((sendFeishuMessageMock.mock.calls[0] as any)[0].url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/team");
    });

    it("dedupes webhooks by URL so a shared team bot receives one message", async () => {
        const teamHook = { url: "https://open.feishu.cn/open-apis/bot/v2/hook/team", enabled: true };
        dbMock.account.findMany.mockResolvedValue([
            { id: "owner-1", notificationConfig: { feishuMention: teamHook } },
            { id: "actor-1", notificationConfig: { feishuMention: teamHook } },
            { id: "user-2", notificationConfig: { feishuMention: teamHook, feishuUserId: "ou_abc" } },
        ] as any);

        await notifySessionMentionRecipients({} as never, {
            ownerId: "owner-1",
            recipientUserIds: ["user-2"],
            recipientUsernames: ["youthqx"],
            actorId: "actor-1",
            actorName: "wfs",
            sessionId: "session-1",
            messageLocalId: "local-1",
            sessionTitle: null,
            preview: "请确认",
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(sendFeishuMessageMock).toHaveBeenCalledTimes(1);
        expect((sendFeishuMessageMock.mock.calls[0] as any)[1].content.text).toContain('<at user_id="ou_abc">youthqx</at>');
    });
});
