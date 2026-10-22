import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, emitEphemeral } = vi.hoisted(() => ({
    dbMock: {
        session: {
            updateMany: vi.fn(),
            findFirst: vi.fn(),
        },
    },
    emitEphemeral: vi.fn(),
}));

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildSessionActivityEphemeral: (sid: string, active: boolean, activeAt: number, thinking: boolean) =>
        ({ type: 'activity', id: sid, active, activeAt, thinking }),
}));

import { sessionArchive } from "./sessionArchive";

describe("sessionArchive", () => {
    beforeEach(() => {
        dbMock.session.updateMany.mockReset();
        dbMock.session.findFirst.mockReset();
        emitEphemeral.mockReset();
    });

    it("turns an active session off, moves lastActiveAt forward and tells the user's clients", async () => {
        dbMock.session.updateMany.mockResolvedValue({ count: 1 });
        const before = Date.now();

        const result = await sessionArchive({ uid: "user-1" } as any, "session-1");

        expect(result).toBe("archived");
        const call = dbMock.session.updateMany.mock.calls[0][0];
        expect(call.where).toEqual({ id: "session-1", accountId: "user-1", active: true });
        expect(call.data.active).toBe(false);
        expect(call.data.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(emitEphemeral).toHaveBeenCalledWith(expect.objectContaining({
            userId: "user-1",
            payload: expect.objectContaining({ id: "session-1", active: false }),
        }));
    });

    it("reports an already inactive session without touching it", async () => {
        dbMock.session.updateMany.mockResolvedValue({ count: 0 });
        dbMock.session.findFirst.mockResolvedValue({ id: "session-1" });

        expect(await sessionArchive({ uid: "user-1" } as any, "session-1")).toBe("already_inactive");
        expect(emitEphemeral).not.toHaveBeenCalled();
    });

    it("does not reveal or touch another user's session", async () => {
        dbMock.session.updateMany.mockResolvedValue({ count: 0 });
        dbMock.session.findFirst.mockResolvedValue(null);

        expect(await sessionArchive({ uid: "user-2" } as any, "session-1")).toBe("not_found");
        expect(dbMock.session.findFirst.mock.calls[0][0].where).toEqual({ id: "session-1", accountId: "user-2" });
    });
});
