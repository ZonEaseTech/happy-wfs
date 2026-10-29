import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/storage/db", () => ({ db: { sessionShare: { findMany } } }));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock("@/storage/files", () => ({ getPublicUrl: (p: string) => p }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));

import { buildNewMessageUpdate, buildUpdateSessionUpdate, eventRouter, type ClientConnection } from "./eventRouter";
import { messageFocusHandler } from "@/app/api/socket/messageFocusHandler";

type FakeSocket = {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    receive: (event: string, data: unknown) => void;
};

function socket(): FakeSocket {
    const handlers = new Map<string, (data: unknown) => void>();
    return {
        emit: vi.fn(),
        on: vi.fn((event: string, handler: (data: unknown) => void) => handlers.set(event, handler)),
        receive: (event: string, data: unknown) => handlers.get(event)?.(data),
    };
}

/** Payload of the n-th thing a fake socket was sent */
const sent = (s: FakeSocket, n = 0) => s.emit.mock.calls[n][1];

const message = {
    id: "m1", seq: 41, content: { t: "encrypted", c: "a-long-ciphertext" }, localId: null,
    sentBy: null, sentByName: null, createdAt: new Date(1000), updatedAt: new Date(1000),
};

async function sendMessage(userId: string, sessionId: string) {
    findMany.mockResolvedValue([]);
    await eventRouter.emitToSessionSubscribers({
        ownerId: userId,
        sessionId,
        buildPayload: (_uid, seq) => buildNewMessageUpdate(message, sessionId, seq, "u1"),
        recipientFilter: { type: "all-interested-in-session", sessionId },
    });
}

function focusedApp(userId: string): FakeSocket {
    const fake = socket();
    const messageFocus = { all: false, sessionIds: new Set<string>() };
    messageFocusHandler(fake as any, messageFocus);
    eventRouter.addConnection(userId, { connectionType: "user-scoped", socket: fake as any, userId, messageFocus });
    return fake;
}

function plain(connection: { connectionType: ClientConnection["connectionType"]; userId: string; sessionId?: string }): FakeSocket {
    const fake = socket();
    eventRouter.addConnection(connection.userId, { ...connection, socket: fake } as any);
    return fake;
}

describe("focused delivery of new messages", () => {
    it("sends the body only to clients showing the session, a hint to the rest", async () => {
        const viewer = focusedApp("a");
        const elsewhere = focusedApp("a");
        viewer.receive("message-focus", { sessionIds: ["s1"] });
        elsewhere.receive("message-focus", { sessionIds: ["s2"] });

        await sendMessage("a", "s1");

        expect(sent(viewer).body.t).toBe("new-message");
        const hint = sent(elsewhere);
        expect(hint.body).toEqual({ t: "new-message-hint", sid: "s1", messageSeq: 41 });
        expect(hint.seq).toBe(sent(viewer).seq);
    });

    it("leaves clients that did not ask for it, and CLI sessions, on full delivery", async () => {
        const oldApp = plain({ connectionType: "user-scoped", userId: "b" });
        const cli = plain({ connectionType: "session-scoped", sessionId: "s1", userId: "b" });

        await sendMessage("b", "s1");

        expect(sent(oldApp).body.t).toBe("new-message");
        expect(sent(cli).body.t).toBe("new-message");
    });

    it("hints until the client says what it shows, and sends everything when it asks for all", async () => {
        const app = focusedApp("c");

        await sendMessage("c", "s1");
        expect(sent(app).body.t).toBe("new-message-hint");

        app.receive("message-focus", { all: true, sessionIds: [] });
        await sendMessage("c", "s1");
        expect(sent(app, 1).body.t).toBe("new-message");
    });

    it("does not touch other updates of a session the client is not showing", async () => {
        const app = focusedApp("d");
        findMany.mockResolvedValue([]);

        await eventRouter.emitToSessionSubscribers({
            ownerId: "d",
            sessionId: "s1",
            buildPayload: (_uid, seq) => buildUpdateSessionUpdate("s1", seq, "u3", { value: "x", version: 2 }),
            recipientFilter: { type: "all-interested-in-session", sessionId: "s1" },
        });

        expect(sent(app).body.t).toBe("update-session");
    });
});
