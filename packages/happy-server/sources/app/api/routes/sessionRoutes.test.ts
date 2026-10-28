import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fastify } from "../types";

type SessionRow = {
    id: string;
    accountId: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
    shareCount: number;
    publicShareId: string | null;
};

const { state, dbMock, resetState, seedSession } = vi.hoisted(() => {
    const state = {
        sessions: [] as SessionRow[]
    };

    const resetState = () => {
        state.sessions = [];
    };

    const seedSession = (row: SessionRow) => {
        state.sessions.push(row);
    };

    const findMany = vi.fn(async (args: any) => {
        const accountId = args?.where?.accountId as string;
        const sinceGt = args?.where?.updatedAt?.gt as Date | undefined;
        let rows = state.sessions.filter((s) => s.accountId === accountId);
        if (sinceGt) {
            rows = rows.filter((s) => s.updatedAt.getTime() > sinceGt.getTime());
        }
        const orderByUpdatedAtAsc = args?.orderBy?.updatedAt === 'asc';
        if (orderByUpdatedAtAsc) {
            rows.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
        } else {
            rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        const take = args?.take ?? rows.length;
        rows = rows.slice(0, take);
        return rows.map((s) => ({
            id: s.id,
            seq: s.seq,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            metadata: s.metadata,
            metadataVersion: s.metadataVersion,
            agentState: s.agentState,
            agentStateVersion: s.agentStateVersion,
            dataEncryptionKey: s.dataEncryptionKey,
            active: s.active,
            lastActiveAt: s.lastActiveAt,
            _count: { shares: s.shareCount },
            publicShare: s.publicShareId ? { id: s.publicShareId } : null
        }));
    });

    const dbMock = {
        session: { findMany }
    };

    return { state, dbMock, resetState, seedSession };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitUpdate: vi.fn() },
    buildNewSessionUpdate: vi.fn()
}));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock("@/utils/randomKeyNaked", () => ({ randomKeyNaked: () => "rand" }));
vi.mock("@/utils/log", () => ({ log: () => {} }));
vi.mock("@/app/session/sessionDelete", () => ({ sessionDelete: vi.fn() }));
vi.mock("@/app/api/socket/rpcRegistry", () => ({ invokeUserRpc: vi.fn() }));

import { sessionRoutes } from "./sessionRoutes";

describe("GET /v1/sessions", () => {
    let app: ReturnType<typeof fastify>;

    beforeEach(async () => {
        resetState();
        app = fastify();
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        app.decorate("authenticate", async (request: any) => {
            request.userId = "user-1";
        });
        sessionRoutes(app as unknown as Fastify);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    const mkSession = (overrides: Partial<SessionRow>): SessionRow => ({
        id: "s1",
        accountId: "user-1",
        seq: 0,
        metadata: "m",
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
        active: true,
        lastActiveAt: new Date(0),
        createdAt: new Date(0),
        updatedAt: new Date(0),
        shareCount: 0,
        publicShareId: null,
        ...overrides
    });

    it("returns all sessions without since (desc by createdAt)", async () => {
        seedSession(mkSession({ id: "a", createdAt: new Date(1000), updatedAt: new Date(5000) }));
        seedSession(mkSession({ id: "b", createdAt: new Date(2000), updatedAt: new Date(3000) }));

        const res = await app.inject({ method: "GET", url: "/v1/sessions" });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.sessions.map((s: any) => s.id)).toEqual(["b", "a"]);
    });

    it("lists every owned session id with its last change, for pruning a kept list", async () => {
        seedSession(mkSession({ id: "a", updatedAt: new Date(5000) }));
        seedSession(mkSession({ id: "b", updatedAt: new Date(3000) }));
        seedSession(mkSession({ id: "other", accountId: "user-2" }));

        const res = await app.inject({ method: "GET", url: "/v1/sessions/ids" });

        expect(res.statusCode).toBe(200);
        const ids = res.json().sessions.map((s: any) => [s.id, s.updatedAt]).sort();
        expect(ids).toEqual([["a", 5000], ["b", 3000]]);
    });

    it("filters by since when provided and orders by updatedAt asc", async () => {
        seedSession(mkSession({ id: "a", updatedAt: new Date(1000) }));
        seedSession(mkSession({ id: "b", updatedAt: new Date(2000) }));
        seedSession(mkSession({ id: "c", updatedAt: new Date(3000) }));

        const res = await app.inject({ method: "GET", url: "/v1/sessions?since=1500" });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.sessions.map((s: any) => s.id)).toEqual(["b", "c"]);
        expect(body.sessions[0].updatedAt).toBe(2000);
        expect(body.sessions[1].updatedAt).toBe(3000);
    });

    it("returns empty array when since is newer than all updatedAt", async () => {
        seedSession(mkSession({ id: "a", updatedAt: new Date(1000) }));
        seedSession(mkSession({ id: "b", updatedAt: new Date(2000) }));

        const res = await app.inject({ method: "GET", url: "/v1/sessions?since=9000" });

        expect(res.statusCode).toBe(200);
        expect(res.json().sessions).toEqual([]);
    });

    it("rejects negative since", async () => {
        const res = await app.inject({ method: "GET", url: "/v1/sessions?since=-1" });
        expect(res.statusCode).toBe(400);
    });

    it("computes isShared from share count or publicShare", async () => {
        seedSession(mkSession({ id: "a", updatedAt: new Date(1000), shareCount: 2 }));
        seedSession(mkSession({ id: "b", updatedAt: new Date(2000), publicShareId: "ps1" }));
        seedSession(mkSession({ id: "c", updatedAt: new Date(3000) }));

        const res = await app.inject({ method: "GET", url: "/v1/sessions" });

        const body = res.json();
        const byId = Object.fromEntries(body.sessions.map((s: any) => [s.id, s.isShared]));
        expect(byId).toEqual({ a: true, b: true, c: false });
    });
});
