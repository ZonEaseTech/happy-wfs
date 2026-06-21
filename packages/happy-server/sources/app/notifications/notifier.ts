import { db } from '@/storage/db';
import { warn, error } from '@/utils/log';
import { NotificationConfigSchema } from 'happy-wire';
import {
    sendFeishuMessage,
    buildSessionCompletedCard,
    buildMessageCompletedCard,
    buildInputNeededCard,
    type SessionCompletedMeta,
    type MessageCompletedMeta,
    type InputNeededMeta,
} from './feishuAdapter';

export type NotificationKind = 'session-completed' | 'message-completed' | 'input-needed';

const DEFAULT_APP_URL = 'https://happy.zonease.org';

function getAppUrl(): string {
    return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}

export interface SessionCompletedEvent {
    userId: string;
    sessionId: string;
    completedAt: Date;
}

export interface MessageCompletedEvent {
    userId: string;
    sessionId: string;
    completedAt: Date;
    /** Optional one-line preview of the assistant text content for the card. */
    preview?: string | null;
}

export interface InputNeededEvent {
    userId: string;
    sessionId: string;
    occurredAt: Date;
    /** Optional context: "permission_request", "idle_prompt", etc. */
    reason?: string | null;
}

/**
 * Public entry point for the presence layer. Fire-and-forget — never throws,
 * never blocks the caller. All errors are logged.
 */
export async function onSessionCompleted(event: SessionCompletedEvent): Promise<void> {
    await deliver(event.userId, event.sessionId, 'session-completed', async (feishu, session) => {
        const meta: SessionCompletedMeta = {
            sessionTag: session.tag,
            machineName: null,
            durationMs: Math.max(0, session.lastActiveAt.getTime() - session.createdAt.getTime()),
            completedAt: event.completedAt.getTime(),
            sessionUrl: `${getAppUrl()}/session/${session.id}`,
        };
        await sendFeishuMessage(feishu, buildSessionCompletedCard(meta));
    });
}

export async function onMessageCompleted(event: MessageCompletedEvent): Promise<void> {
    await deliver(event.userId, event.sessionId, 'message-completed', async (feishu, session) => {
        const meta: MessageCompletedMeta = {
            sessionTag: session.tag,
            preview: event.preview ?? null,
            completedAt: event.completedAt.getTime(),
            sessionUrl: `${getAppUrl()}/session/${session.id}`,
        };
        await sendFeishuMessage(feishu, buildMessageCompletedCard(meta));
    });
}

export async function onInputNeeded(event: InputNeededEvent): Promise<void> {
    await deliver(event.userId, event.sessionId, 'input-needed', async (feishu, session) => {
        const meta: InputNeededMeta = {
            sessionTag: session.tag,
            reason: event.reason ?? null,
            occurredAt: event.occurredAt.getTime(),
            sessionUrl: `${getAppUrl()}/session/${session.id}`,
        };
        await sendFeishuMessage(feishu, buildInputNeededCard(meta));
    });
}

/**
 * Shared delivery wrapper: validates kind via shouldNotify, loads the
 * notificationConfig, makes sure feishu.enabled, looks up the session row,
 * then hands off to the kind-specific card builder via the callback.
 */
async function deliver(
    userId: string,
    sessionId: string,
    kind: NotificationKind,
    send: (
        feishu: { url: string; secret?: string; enabled: boolean },
        session: { id: string; tag: string; createdAt: Date; lastActiveAt: Date },
    ) => Promise<void>,
): Promise<void> {
    try {
        if (!shouldNotify(userId, sessionId, kind)) return;

        const account = await db.account.findUnique({
            where: { id: userId },
            select: { notificationConfig: true },
        });
        if (!account?.notificationConfig) return;

        const parsed = NotificationConfigSchema.safeParse(account.notificationConfig);
        if (!parsed.success) {
            warn({ userId }, 'invalid notificationConfig blob');
            return;
        }
        const feishu = parsed.data.feishu;
        if (!feishu || !feishu.enabled) return;

        const session = await db.session.findUnique({
            where: { id: sessionId },
            select: { id: true, tag: true, createdAt: true, lastActiveAt: true },
        });
        if (!session) return;

        await send(feishu, session);
    } catch (err) {
        error({ err, userId, sessionId, kind }, 'feishu notify failed');
    }
}

/**
 * 30-second cooldown per (userId, sessionId, kind). In-memory; restart resets.
 *
 * Goal: silence chatty events (e.g. message-completed fires multiple times per
 * Claude turn as stream chunks land in the DB) without hiding distinct events
 * that are spaced > 30s apart.
 *
 * Postgres-backed durability would be needed for a multi-instance deployment;
 * single-instance prod is fine with the in-memory map.
 */
const COOLDOWN_MS = 30 * 1000;
const lastSentAt = new Map<string, number>();
// Light-weight cleanup: 4096 entries × ~80 bytes = a few hundred KB worst case;
// trim oldest once it gets there to bound memory.
const MAX_ENTRIES = 4096;

export function shouldNotify(
    userId: string,
    sessionId: string,
    kind: NotificationKind,
): boolean {
    const key = `${userId}:${sessionId}:${kind}`;
    const now = Date.now();
    const prev = lastSentAt.get(key);
    if (prev !== undefined && now - prev < COOLDOWN_MS) {
        return false;
    }
    lastSentAt.set(key, now);
    if (lastSentAt.size > MAX_ENTRIES) {
        // Drop the oldest ~1024 entries to amortize cleanup
        const sorted = [...lastSentAt.entries()].sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < 1024 && i < sorted.length; i++) {
            lastSentAt.delete(sorted[i][0]);
        }
    }
    return true;
}
