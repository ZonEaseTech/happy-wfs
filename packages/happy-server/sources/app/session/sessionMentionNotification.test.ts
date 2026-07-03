import { describe, expect, it, vi, beforeEach } from "vitest";

const {
    feedPostMock,
    sendExpoPushNotificationsMock,
    afterTxMock,
} = vi.hoisted(() => ({
    feedPostMock: vi.fn(async () => undefined),
    sendExpoPushNotificationsMock: vi.fn(async () => undefined),
    afterTxMock: vi.fn((_tx: unknown, callback: () => void) => callback()),
}));

vi.mock("@/app/feed/feedPost", () => ({
    feedPost: feedPostMock,
}));

vi.mock("@/app/notifications/expoPush", () => ({
    sendExpoPushNotifications: sendExpoPushNotificationsMock,
}));

vi.mock("@/storage/inTx", () => ({
    afterTx: afterTxMock,
}));

vi.mock("@/utils/log", () => ({
    warn: vi.fn(),
}));

import { notifySessionMentionRecipients } from "./sessionMentionNotification";

describe("notifySessionMentionRecipients", () => {
    beforeEach(() => {
        feedPostMock.mockClear();
        sendExpoPushNotificationsMock.mockClear();
        afterTxMock.mockClear();
    });

    it("creates one session_mention feed item per deduped target with badge", async () => {
        await notifySessionMentionRecipients({} as never, {
            recipientUserIds: ["u2", "u2", "u3"],
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
            recipientUserIds: ["u1", "u2"],
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
            recipientUserIds: ["u2"],
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
});
