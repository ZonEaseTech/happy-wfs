import * as React from 'react';
import type { RightPanelType } from '@/components/RightPanel';

/**
 * App-level right panel (Files / Info / Code / Commits). Mounted next to the
 * navigator like the terminal so the column order stays chat → terminal →
 * panel, and so an open panel survives route changes.
 */
type RightPanelState = {
    type: RightPanelType | null;
    sessionId: string | null;
};

let state: RightPanelState = { type: null, sessionId: null };
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

export function setRightPanelSession(sessionId: string | null) {
    if (state.sessionId === sessionId) return;
    state = { type: sessionId ? state.type : null, sessionId };
    emit();
}

export function setRightPanelType(action: React.SetStateAction<RightPanelType | null>) {
    const next = typeof action === 'function'
        ? (action as (prev: RightPanelType | null) => RightPanelType | null)(state.type)
        : action;
    if (next === state.type) return;
    state = { ...state, type: next };
    emit();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot() {
    return state;
}

export function useRightPanelState(): RightPanelState {
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
