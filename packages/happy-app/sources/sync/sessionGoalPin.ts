import * as React from 'react';
import { getSession, useSession } from '@/sync/storage';
import { sessionUpdateMetadataFields } from '@/sync/ops';
import { loadSessionGoalPins, saveSessionGoalPins } from './persistence';

/**
 * Per-session "pinned goals" — message snippets the user pins so they stay
 * visible at the top of the chat after many turns.
 *
 * Persisted server-side on session.metadata.goalPins (encrypted), so pins
 * follow the user across devices — same pipeline as awaitingClosure /
 * reviewPending. Pins created before this moved server-side live in mmkv and
 * are migrated up on first use of the session.
 */
export type SessionGoalPin = {
    text: string;
    messageId: string;
    pinnedAt: number;
};

const MAX_PIN_TEXT = 2000;
const MAX_PINS_PER_SESSION = 10;
const EMPTY: SessionGoalPin[] = [];

async function writePins(sessionId: string, next: SessionGoalPin[]): Promise<void> {
    const session = getSession(sessionId);
    if (!session?.metadata) return;
    try {
        await sessionUpdateMetadataFields(
            sessionId,
            session.metadata,
            { goalPins: next.length > 0 ? next : undefined },
            session.metadataVersion,
        );
    } catch (error) {
        console.warn('[sessionGoalPin] write failed:', error);
    }
}

export function pinSessionGoal(sessionId: string, text: string, messageId: string) {
    const trimmed = text.trim().slice(0, MAX_PIN_TEXT);
    if (!trimmed) return;
    const existing = getSession(sessionId)?.metadata?.goalPins ?? EMPTY;
    const next = [
        ...existing.filter((pin) => pin.messageId !== messageId),
        { text: trimmed, messageId, pinnedAt: Date.now() },
    ].slice(-MAX_PINS_PER_SESSION);
    void writePins(sessionId, next);
}

export function unpinSessionGoal(sessionId: string, messageId: string) {
    const existing = getSession(sessionId)?.metadata?.goalPins ?? EMPTY;
    if (!existing.some((pin) => pin.messageId === messageId)) return;
    void writePins(sessionId, existing.filter((pin) => pin.messageId !== messageId));
}

/**
 * One-shot migration of pre-sync local pins: push them to metadata the first
 * time the session is opened, then drop the local copy so it can't resurrect
 * pins the user removed on another device.
 */
function migrateLocalPins(sessionId: string, serverPins: SessionGoalPin[]): void {
    const local = loadSessionGoalPins();
    const localPins = local[sessionId];
    if (!localPins?.length) return;
    const merged = [...serverPins];
    for (const pin of localPins) {
        if (!merged.some((existing) => existing.messageId === pin.messageId)) {
            merged.push(pin);
        }
    }
    const rest = { ...local };
    delete rest[sessionId];
    saveSessionGoalPins(rest);
    if (merged.length !== serverPins.length) {
        void writePins(sessionId, merged.slice(-MAX_PINS_PER_SESSION));
    }
}

export function useSessionGoalPins(sessionId: string): SessionGoalPin[] {
    const session = useSession(sessionId);
    const pins = session?.metadata?.goalPins ?? EMPTY;
    const migratedRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!session?.metadata || migratedRef.current === sessionId) return;
        migratedRef.current = sessionId;
        migrateLocalPins(sessionId, pins);
    }, [sessionId, session?.metadata, pins]);
    return pins;
}
