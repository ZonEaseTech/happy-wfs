import * as React from 'react';

/**
 * App-level terminal state. The terminal panel is mounted once next to the
 * navigator (see SidebarNavigator) instead of inside a screen, so switching
 * routes — chat → devices → settings — never tears down an open terminal.
 */
export type TerminalPanelState = {
    visible: boolean;
    /** Session id, or a machine id when isMachineScope is true. */
    targetId: string | null;
    cwd?: string;
    isMachineScope: boolean;
    /** Bumped on every open request so the panel can focus/re-attach. */
    openRequestKey: number;
};

const CLOSED: TerminalPanelState = { visible: false, targetId: null, isMachineScope: false, openRequestKey: 0 };

let state: TerminalPanelState = CLOSED;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

export function openTerminalPanel(params: { targetId: string; cwd?: string; isMachineScope?: boolean }) {
    state = {
        visible: true,
        targetId: params.targetId,
        cwd: params.cwd,
        isMachineScope: params.isMachineScope ?? false,
        openRequestKey: state.openRequestKey + 1,
    };
    emit();
}

export function closeTerminalPanel() {
    if (!state.visible) return;
    state = { ...state, visible: false };
    emit();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getSnapshot() {
    return state;
}

export function useTerminalPanelState(): TerminalPanelState {
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
