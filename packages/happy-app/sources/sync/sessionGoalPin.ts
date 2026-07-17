import * as React from 'react';
import { loadSessionGoalPins, saveSessionGoalPins } from './persistence';

/**
 * Per-session "pinned goal" — a message snippet the user pins so it floats at
 * the top of the chat and the original objective stays visible after many
 * turns. Local-only (mmkv), one pin per session; pinning again replaces it.
 */
export type SessionGoalPin = {
    text: string;
    messageId: string;
    pinnedAt: number;
};

const MAX_PIN_TEXT = 2000;

let pins: Record<string, SessionGoalPin> = loadSessionGoalPins();
const listeners = new Set<() => void>();

function persist() {
    saveSessionGoalPins(pins);
    listeners.forEach((listener) => listener());
}

export function pinSessionGoal(sessionId: string, text: string, messageId: string) {
    const trimmed = text.trim().slice(0, MAX_PIN_TEXT);
    if (!trimmed) return;
    pins = { ...pins, [sessionId]: { text: trimmed, messageId, pinnedAt: Date.now() } };
    persist();
}

export function unpinSessionGoal(sessionId: string) {
    if (!(sessionId in pins)) return;
    const next = { ...pins };
    delete next[sessionId];
    pins = next;
    persist();
}

export function useSessionGoalPin(sessionId: string): SessionGoalPin | null {
    const subscribe = React.useCallback((listener: () => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    const getSnapshot = React.useCallback(() => pins[sessionId] ?? null, [sessionId]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
