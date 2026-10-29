import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientConnection } from "@/app/events/eventRouter";

const {
    state,
    dbMock,
    emitEphemeralToSessionSubscribersMock,
    dispatchNextPendingIfPossibleMock,
    resetState,
    createSocket
} = vi.hoisted(() => {
    const state = {
        sessions: [] as Array<{ id: string; accountId: string; agentState?: string | null; agentStateVersion?: number; metadata?: string }>,
        messages: [] as Array<{ id: string; sessionId: string; localId: string | null }>,
        deliveryIssues: [] as Array<{ sessionMessageId: string; status: "waiting" | "error"; reason: string | null }>
    };

    const resetState = () => {
        state.sessions = [];
        state.messages = [];
        state.deliveryIssues = [];
    };

    const sessionFindUnique = vi.fn(async (args: any) => {
        return state.sessions.find((session) => (
            session.id === args?.where?.id &&
            (args?.where?.accountId === undefined || session.accountId === args.where.accountId)
        )) ?? null;
    });

    const sessionUpdateMany = vi.fn(async (args: any) => {
        const session = state.sessions.find((item) => (
            item.id === args?.where?.id &&
            item.agentStateVersion === args?.where?.agentStateVersion
        ));
        if (!session) {
            return { count: 0 };
        }
        Object.assign(session, args.data);
        return { count: 1 };
    });

    const sessionMessageFindFirst = vi.fn(async (args: any) => {
        return state.messages.find((message) => (
            (!args?.where?.id || message.id === args.where.id) &&
            (!args?.where?.sessionId || message.sessionId === args.where.sessionId) &&
            (!args?.where?.localId || message.localId === args.where.localId)
        )) ?? null;
    });

    const deliveryIssueDeleteMany = vi.fn(async (args: any) => {
        const before = state.deliveryIssues.length;
        state.deliveryIssues = state.deliveryIssues.filter((item) => item.sessionMessageId !== args?.where?.sessionMessageId);
        return { count: before - state.deliveryIssues.length };
    });

    const deliveryIssueUpsert = vi.fn(async (args: any) => {
        const existing = state.deliveryIssues.find((item) => item.sessionMessageId === args?.where?.sessionMessageId);
        if (existing) {
            existing.status = args?.update?.status;
            existing.reason = args?.update?.reason ?? null;
            return existing;
        }

        const created = {
            sessionMessageId: args?.create?.sessionMessageId,
            status: args?.create?.status,
            reason: args?.create?.reason ?? null
        } as const;
        state.deliveryIssues.push({ ...created });
        return created;
    });

    const dbMock = {
        session: {
            findUnique: sessionFindUnique,
            updateMany: sessionUpdateMany,
            update: vi.fn(async () => ({}))
        },
        sessionMessage: {
            findFirst: sessionMessageFindFirst
        },
        sessionMessageDeliveryIssue: {
            deleteMany: deliveryIssueDeleteMany,
            upsert: deliveryIssueUpsert
        }
    };

    const emitEphemeralToSessionSubscribersMock = vi.fn(async () => undefined);
    const dispatchNextPendingIfPossibleMock = vi.fn(async () => ({ dispatched: false }));

    const createSocket = () => {
        const handlers = new Map<string, (...args: any[]) => unknown>();
        return {
            socket: {
                id: "socket-1",
                on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
                    handlers.set(event, handler);
                })
            } as any,
            async trigger(event: string, data: any, callback?: (response: any) => void) {
                const handler = handlers.get(event);
                if (!handler) {
                    throw new Error(`Missing handler for ${event}`);
                }
                await handler(data, callback);
            }
        };
    };

    return {
        state,
        dbMock,
        emitEphemeralToSessionSubscribersMock,
        dispatchNextPendingIfPossibleMock,
        resetState,
        createSocket
    };
});

vi.mock("@/storage/db", () => ({
    db: dbMock
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        getConnections: vi.fn(() => new Set()),
        emitEphemeralToSessionSubscribers: emitEphemeralToSessionSubscribersMock,
        emitToSessionSubscribers: vi.fn(async () => undefined)
    },
    buildSessionActivityEphemeral: vi.fn((sid: string, active: boolean, activeAt: number, thinking?: boolean) => ({
        type: "activity",
        id: sid,
        active,
        activeAt,
        thinking: thinking || false
    })),
    buildUpdateSessionUpdate: vi.fn(),
    buildNewMessageUpdate: vi.fn(),
    buildMessageSyncingEphemeral: vi.fn(),
    buildMessageSyncedEphemeral: vi.fn(),
    buildMessageErrorEphemeral: vi.fn(),
    buildMessageDeliveryErrorEphemeral: vi.fn((sid: string, messageId: string, localId: string | null, error: string) => ({
        type: "message-delivery-error",
        sid,
        messageId,
        localId,
        error
    })),
    buildMessageDeliveryClearedEphemeral: vi.fn((sid: string, messageId: string, localId: string | null) => ({
        type: "message-delivery-cleared",
        sid,
        messageId,
        localId
    }))
}));

vi.mock("@/storage/seq", () => ({
    allocateSessionSeq: vi.fn(async () => 1)
}));

vi.mock("@/app/monitoring/metrics2", () => ({
    websocketEventsCounter: { inc: vi.fn() },
    sessionAliveEventsCounter: { inc: vi.fn() }
}));

vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: {
        isSessionValid: vi.fn(async () => true),
        queueSessionUpdate: vi.fn(),
    }
}));

vi.mock("@/utils/randomKeyNaked", () => ({
    randomKeyNaked: vi.fn(() => "update-id")
}));

vi.mock("@/utils/log", () => ({
    log: vi.fn()
}));

vi.mock("@/utils/delay", () => ({
    delay: vi.fn(async () => undefined)
}));

vi.mock("@/app/notifications/notifier", () => ({
    onInputNeeded: vi.fn(async () => undefined),
    onMessageCompleted: vi.fn(async () => undefined)
}));

vi.mock("@/app/session/pendingMessageAutoDispatch", () => ({
    dispatchNextPendingIfPossible: dispatchNextPendingIfPossibleMock
}));

import { sessionUpdateHandler } from "./sessionUpdateHandler";
import { __resetSessionTurnRuntimeForTests } from "@/app/presence/sessionTurnRuntime";

describe("sessionUpdateHandler message-receipt", () => {
    beforeEach(() => {
        __resetSessionTurnRuntimeForTests();
        resetState();
        emitEphemeralToSessionSubscribersMock.mockClear();
        dispatchNextPendingIfPossibleMock.mockClear();
    });

    const createConnection = (socket: any): ClientConnection => ({
        connectionType: "session-scoped",
        socket,
        userId: "user-1",
        sessionId: "session-1",
        supportsMessageReceipt: true
    });

    it("removes waiting issue when receipt ok=true", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });
        state.messages.push({ id: "msg-1", sessionId: "session-1", localId: "l1" });
        state.deliveryIssues.push({ sessionMessageId: "msg-1", status: "waiting", reason: null });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        await trigger("message-receipt", {
            sid: "session-1",
            messageId: "msg-1",
            ok: true
        });

        expect(state.deliveryIssues).toEqual([]);
        expect(emitEphemeralToSessionSubscribersMock).toHaveBeenCalledTimes(1);
        expect(emitEphemeralToSessionSubscribersMock).toHaveBeenCalledWith(expect.objectContaining({
            payload: {
                type: "message-delivery-cleared",
                sid: "session-1",
                messageId: "msg-1",
                localId: "l1"
            }
        }));
    });

    it("stores error reason and emits ephemeral when receipt ok=false", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });
        state.messages.push({ id: "msg-1", sessionId: "session-1", localId: "l1" });
        state.deliveryIssues.push({ sessionMessageId: "msg-1", status: "waiting", reason: null });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        await trigger("message-receipt", {
            sid: "session-1",
            messageId: "msg-1",
            localId: "l1",
            ok: false,
            error: "decrypt failed: invalid payload"
        });

        expect(state.deliveryIssues).toEqual([
            {
                sessionMessageId: "msg-1",
                status: "error",
                reason: "decrypt failed: invalid payload"
            }
        ]);
        expect(emitEphemeralToSessionSubscribersMock).toHaveBeenCalledTimes(1);
    });

    it("ignores invalid sid/messageId without mutating data", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });
        state.messages.push({ id: "msg-1", sessionId: "session-1", localId: "l1" });
        state.deliveryIssues.push({ sessionMessageId: "msg-1", status: "waiting", reason: null });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        await trigger("message-receipt", {
            sid: "session-1",
            messageId: "msg-404",
            ok: false,
            error: "not found"
        });

        expect(state.deliveryIssues).toEqual([
            {
                sessionMessageId: "msg-1",
                status: "waiting",
                reason: null
            }
        ]);
        expect(emitEphemeralToSessionSubscribersMock).not.toHaveBeenCalled();
    });
});

describe("sessionUpdateHandler session-alive auto-dispatch", () => {
    beforeEach(() => {
        __resetSessionTurnRuntimeForTests();
        resetState();
        emitEphemeralToSessionSubscribersMock.mockClear();
        dispatchNextPendingIfPossibleMock.mockClear();
    });

    const createConnection = (socket: any): ClientConnection => ({
        connectionType: "session-scoped",
        socket,
        userId: "user-1",
        sessionId: "session-1",
        supportsMessageReceipt: true
    });

    // Archiving kills the CLI, which sends session-end and then exits. A
    // heartbeat it still gets out in between used to mark the archived session
    // active again, so it popped back into the list.
    it("ignores a heartbeat that arrives on the same connection after session-end", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });

        const dying = createSocket();
        sessionUpdateHandler("user-1", dying.socket, createConnection(dying.socket));

        const baseTime = Date.now();
        await dying.trigger("session-alive", { sid: "session-1", time: baseTime, thinking: false });
        await dying.trigger("session-end", { sid: "session-1", time: baseTime + 1 });
        emitEphemeralToSessionSubscribersMock.mockClear();

        await dying.trigger("session-alive", { sid: "session-1", time: baseTime + 2, thinking: false });
        expect(emitEphemeralToSessionSubscribersMock).not.toHaveBeenCalled();

        // Resuming the session is a new process on a new connection.
        const resumed = createSocket();
        sessionUpdateHandler("user-1", resumed.socket, createConnection(resumed.socket));
        await resumed.trigger("session-alive", { sid: "session-1", time: baseTime + 3, thinking: false });
        expect(emitEphemeralToSessionSubscribersMock).toHaveBeenCalledTimes(1);
    });

    it("dispatches once on thinking true->false and ignores repeated idle heartbeats", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        const baseTime = Date.now();
        await trigger("session-alive", { sid: "session-1", time: baseTime, thinking: true });
        await trigger("session-alive", { sid: "session-1", time: baseTime + 1, thinking: false });
        await trigger("session-alive", { sid: "session-1", time: baseTime + 2, thinking: false });

        expect(dispatchNextPendingIfPossibleMock).toHaveBeenCalledTimes(1);
        expect(dispatchNextPendingIfPossibleMock).toHaveBeenCalledWith({
            ownerId: "user-1",
            sessionId: "session-1",
        });
    });

    it("allows next dispatch after a new thinking turn starts then ends", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        const baseTime = Date.now();
        await trigger("session-alive", { sid: "session-1", time: baseTime, thinking: true });
        await trigger("session-alive", { sid: "session-1", time: baseTime + 1, thinking: false });
        await trigger("session-alive", { sid: "session-1", time: baseTime + 2, thinking: true });
        await trigger("session-alive", { sid: "session-1", time: baseTime + 3, thinking: false });

        expect(dispatchNextPendingIfPossibleMock).toHaveBeenCalledTimes(2);
    });

    it("broadcasts activity BEFORE awaiting dispatch so a stale thinking=false does not arrive after a concurrent thinking=true", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1" });

        const operationLog: string[] = [];

        let resolveDispatch: (() => void) | null = null;
        dispatchNextPendingIfPossibleMock.mockImplementation(() => {
            operationLog.push("dispatch-start");
            return new Promise<{ dispatched: boolean }>((resolve) => {
                resolveDispatch = () => {
                    operationLog.push("dispatch-end");
                    resolve({ dispatched: false });
                };
            });
        });

        (emitEphemeralToSessionSubscribersMock as any).mockImplementation(async (params: any) => {
            if (params.payload?.type === "activity") {
                operationLog.push(`broadcast:thinking=${params.payload.thinking}`);
            }
        });

        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));

        const baseTime = Date.now();

        await trigger("session-alive", { sid: "session-1", time: baseTime, thinking: true });

        // Don't await — simulates the handler being in-flight while a new event arrives
        const falsePromise = trigger("session-alive", { sid: "session-1", time: baseTime + 1, thinking: false });

        await trigger("session-alive", { sid: "session-1", time: baseTime + 2, thinking: true });

        expect(resolveDispatch).not.toBeNull();
        resolveDispatch!();
        await falsePromise;

        const falseIdx = operationLog.indexOf("broadcast:thinking=false");
        const dispatchEndIdx = operationLog.indexOf("dispatch-end");
        expect(falseIdx).toBeLessThan(dispatchEndIdx);
    });
});

describe("sessionUpdateHandler update-state", () => {
    beforeEach(() => {
        resetState();
        dbMock.session.findUnique.mockClear();
    });

    const createConnection = (socket: any): ClientConnection => ({
        connectionType: "session-scoped",
        socket,
        userId: "user-1",
        sessionId: "session-1",
        supportsMessageReceipt: true
    });

    // Runs on every agent state change; the session row also carries the
    // encrypted metadata, tens of KB that the version check does not need.
    it("checks the version without reading the rest of the session", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1", agentState: "old", agentStateVersion: 3, metadata: "big" });
        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));
        const callback = vi.fn();

        await trigger("update-state", { sid: "session-1", agentState: "new", expectedVersion: 3 }, callback);

        expect(dbMock.session.findUnique).toHaveBeenCalledTimes(1);
        expect(dbMock.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: { agentStateVersion: true } }));
        expect(callback).toHaveBeenCalledWith({ result: "success", version: 4, agentState: "new" });
    });

    it("answers a version mismatch with the current agent state", async () => {
        state.sessions.push({ id: "session-1", accountId: "user-1", agentState: "current", agentStateVersion: 5, metadata: "big" });
        const { socket, trigger } = createSocket();
        sessionUpdateHandler("user-1", socket, createConnection(socket));
        const callback = vi.fn();

        await trigger("update-state", { sid: "session-1", agentState: "stale", expectedVersion: 3 }, callback);

        expect(callback).toHaveBeenCalledWith({ result: "version-mismatch", version: 5, agentState: "current" });
        expect(state.sessions[0].agentState).toBe("current");
    });
});
