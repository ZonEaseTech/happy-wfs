import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessions, findMany, findFirst, sessionDelete } = vi.hoisted(() => {
    const sessions: Array<{ id: string; accountId: string; active: boolean; lastActiveAt: Date }> = [];
    const matches = (where: any) => (s: (typeof sessions)[number]) =>
        s.active === where.active
        && s.lastActiveAt < where.lastActiveAt.lt
        && (!where.id?.notIn || !where.id.notIn.includes(s.id))
        && (!where.id || typeof where.id !== 'string' || s.id === where.id);
    const findMany = vi.fn(async ({ where, take }: any) => sessions
        .filter(matches(where))
        .sort((a, b) => a.lastActiveAt.getTime() - b.lastActiveAt.getTime())
        .slice(0, take)
        .map(s => ({ id: s.id, accountId: s.accountId })));
    const findFirst = vi.fn(async ({ where }: any) => {
        const s = sessions.find(matches(where));
        return s ? { id: s.id } : null;
    });
    const sessionDelete = vi.fn(async (_ctx: any, id: string) => {
        const index = sessions.findIndex(s => s.id === id);
        if (index < 0) return false;
        sessions.splice(index, 1);
        return true;
    });
    return { sessions, findMany, findFirst, sessionDelete };
});

vi.mock("@/storage/db", () => ({ db: { session: { findMany, findFirst } } }));
vi.mock("@/app/session/sessionDelete", () => ({ sessionDelete }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));

import { deleteExpiredArchivedSessions } from "./sessionArchiveCleanup";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-28T00:00:00Z").getTime();

function seed(id: string, accountId: string, active: boolean, daysAgo: number) {
    sessions.push({ id, accountId, active, lastActiveAt: new Date(NOW - daysAgo * DAY) });
}

describe("deleteExpiredArchivedSessions", () => {
    beforeEach(() => {
        sessions.length = 0;
        vi.clearAllMocks();
    });

    it("deletes archived sessions idle for more than 30 days, for every account, as their owner", async () => {
        seed("old-mine", "weifashi", false, 31);
        seed("old-theirs", "youthqx", false, 90);
        seed("recent-archived", "weifashi", false, 29);
        seed("old-but-active", "weifashi", true, 60);

        const result = await deleteExpiredArchivedSessions(NOW);

        expect(result).toEqual({ deleted: 2, failed: 0 });
        expect(sessionDelete).toHaveBeenCalledWith({ uid: "youthqx" }, "old-theirs");
        expect(sessionDelete).toHaveBeenCalledWith({ uid: "weifashi" }, "old-mine");
        expect(sessions.map(s => s.id).sort()).toEqual(["old-but-active", "recent-archived"]);
    });

    it("works through more than one batch", async () => {
        for (let i = 0; i < 120; i++) seed(`s${i}`, "a", false, 40);

        const result = await deleteExpiredArchivedSessions(NOW);

        expect(result.deleted).toBe(120);
        expect(sessions).toHaveLength(0);
    });

    it("keeps going past a session that fails, without retrying it in the same sweep", async () => {
        seed("bad", "a", false, 50);
        seed("good", "a", false, 40);
        sessionDelete.mockImplementationOnce(async () => { throw new Error("fk violation"); });

        const result = await deleteExpiredArchivedSessions(NOW);

        expect(result).toEqual({ deleted: 1, failed: 1 });
        expect(sessions.map(s => s.id)).toEqual(["bad"]);
    });

    it("skips a session that became active between the query and the delete", async () => {
        seed("revived", "a", false, 40);
        findFirst.mockResolvedValueOnce(null);

        const result = await deleteExpiredArchivedSessions(NOW);

        expect(result).toEqual({ deleted: 0, failed: 0 });
        expect(sessionDelete).not.toHaveBeenCalled();
    });
});
