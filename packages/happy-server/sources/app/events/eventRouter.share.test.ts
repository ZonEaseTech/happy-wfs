import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/storage/db", () => ({ db: { sessionShare: { findMany } } }));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock("@/storage/files", () => ({ getPublicUrl: (p: string) => p }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));

import { buildUpdateSessionUpdate, eventRouter, type ClientConnection } from "./eventRouter";

function socket() {
    return { emit: vi.fn() } as any;
}

describe("emitToSessionSubscribers", () => {
    it("does not hand a shared session's updates to the shared user's CLI sessions for other sessions", async () => {
        findMany.mockResolvedValue([{ sharedWithUserId: "friend" }]);

        const ownerCli = { connectionType: "session-scoped", sessionId: "shared-session", socket: socket(), userId: "owner" } as ClientConnection;
        const ownerOtherCli = { connectionType: "session-scoped", sessionId: "owner-other", socket: socket(), userId: "owner" } as ClientConnection;
        const friendApp = { connectionType: "user-scoped", socket: socket(), userId: "friend" } as ClientConnection;
        const friendCli = { connectionType: "session-scoped", sessionId: "friend-own-session", socket: socket(), userId: "friend" } as ClientConnection;
        const friendMachine = { connectionType: "machine-scoped", machineId: "m", socket: socket(), userId: "friend" } as ClientConnection;
        for (const c of [ownerCli, ownerOtherCli]) eventRouter.addConnection("owner", c);
        for (const c of [friendApp, friendCli, friendMachine]) eventRouter.addConnection("friend", c);

        await eventRouter.emitToSessionSubscribers({
            ownerId: "owner",
            sessionId: "shared-session",
            buildPayload: (_uid, seq) => buildUpdateSessionUpdate("shared-session", seq, "u1", { value: "x", version: 2383 }),
            recipientFilter: { type: "all-interested-in-session", sessionId: "shared-session" },
        });

        expect(ownerCli.socket.emit).toHaveBeenCalledTimes(1);
        expect(ownerOtherCli.socket.emit).not.toHaveBeenCalled();
        expect(friendApp.socket.emit).toHaveBeenCalledTimes(1);
        expect(friendCli.socket.emit).not.toHaveBeenCalled();
        expect(friendMachine.socket.emit).not.toHaveBeenCalled();
    });

    it("scopes to the session when the caller passes no filter", async () => {
        findMany.mockResolvedValue([]);
        const mine = { connectionType: "session-scoped", sessionId: "s1", socket: socket(), userId: "u" } as ClientConnection;
        const other = { connectionType: "session-scoped", sessionId: "s2", socket: socket(), userId: "u" } as ClientConnection;
        eventRouter.addConnection("u", mine);
        eventRouter.addConnection("u", other);

        await eventRouter.emitToSessionSubscribers({
            ownerId: "u",
            sessionId: "s1",
            buildPayload: (_uid, seq) => buildUpdateSessionUpdate("s1", seq, "u2", { value: "x", version: 2 }),
        });

        expect(mine.socket.emit).toHaveBeenCalledTimes(1);
        expect(other.socket.emit).not.toHaveBeenCalled();
    });
});
