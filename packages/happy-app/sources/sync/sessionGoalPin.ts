import * as React from 'react';
import { loadSessionGoalPins, saveSessionGoalPins } from './persistence';

/**
 * Per-session "pinned goals" — message snippets the user pins so they stay
 * visible at the top of the chat after many turns. Local-only (mmkv);
 * multiple pins per session, re-pinning the same message replaces it.
 */
export type SessionGoalPin = {
    text: string;
    messageId: string;
    pinnedAt: number;
};

const MAX_PIN_TEXT = 2000;
const MAX_PINS_PER_SESSION = 10;
const EMPTY: SessionGoalPin[] = [];

let pins: Record<string, SessionGoalPin[]> = loadSessionGoalPins();
const listeners = new Set<() => void>();

function persist() {
    saveSessionGoalPins(pins);
    listeners.forEach((listener) => listener());
}

export function pinSessionGoal(sessionId: string, text: string, messageId: string) {
    const trimmed = text.trim().slice(0, MAX_PIN_TEXT);
    if (!trimmed) return;
    const existing = pins[sessionId] ?? EMPTY;
    const next = [
        ...existing.filter((p) => p.messageId !== messageId),
        { text: trimmed, messageId, pinnedAt: Date.now() },
    ].slice(-MAX_PINS_PER_SESSION);
    pins = { ...pins, [sessionId]: next };
    persist();
}

export function unpinSessionGoal(sessionId: string, messageId: string) {
    const existing = pins[sessionId];
    if (!existing?.some((p) => p.messageId === messageId)) return;
    const next = existing.filter((p) => p.messageId !== messageId);
    const nextPins = { ...pins };
    if (next.length === 0) {
        delete nextPins[sessionId];
    } else {
        nextPins[sessionId] = next;
    }
    pins = nextPins;
    persist();
}

export function useSessionGoalPins(sessionId: string): SessionGoalPin[] {
    const subscribe = React.useCallback((listener: () => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    const getSnapshot = React.useCallback(() => pins[sessionId] ?? EMPTY, [sessionId]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
