// Native fallback. The xterm.js-based interactive terminal is web/PC only —
// mobile (iOS / Android) doesn't have a meaningful surface for a full ANSI PTY
// and the xterm.js bundle is DOM-only. Mirrors the FileViewerModal pattern
// (Terminal.web.tsx + this null fallback selected by Metro/Expo platform
// resolver).

export interface TerminalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    /** Optional working directory hint forwarded to the CLI as pty-start.cwd. */
    cwd?: string;
    /** Incremented by the header terminal button to open/create the current session terminal. */
    openRequestKey?: number;
}

export function Terminal(_props: TerminalProps): null {
    return null;
}

export function TerminalPanel(_props: TerminalProps): null {
    return null;
}
