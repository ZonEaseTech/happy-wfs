// Web-only interactive terminal modal backed by xterm.js.
//
// Wire protocol (kept in lockstep with packages/happy-cli + happy-server —
// see .task-orchestrator/20260509-204343/protocol.md):
//
//   • App → CLI lifecycle goes through RPC:
//       sessionId:pty-start  → { ptyId }
//       sessionId:pty-resize → {}
//       sessionId:pty-close  → {}
//
//   • App ↔ CLI streaming bypasses RPC (no per-frame ack) and rides
//     directly on the socket as new server events. Frame body shape:
//
//       pty-input  (app → cli):  { sessionId, ptyId, data }   data: utf-8 string of keystrokes
//       pty-output (cli → app):  { sessionId, ptyId, data }   data: base64 of raw bytes
//       pty-exit   (cli → app):  { sessionId, ptyId, exitCode }
//
//     Output is base64 because shells emit 8-bit ANSI escape sequences that
//     don't survive utf-8 round-tripping. Input is plain string — keystrokes
//     fit in the BMP and xterm hands them to us as JS strings.
//
//   • Encryption: lifecycle RPC payloads are auto-encrypted by sessionRPC
//     (matching every other session call). Streaming frames go through the
//     same session encryption manually since the server-relay treats them as
//     opaque ciphertext. The server only forwards by sessionId; it doesn't
//     decrypt or persist PTY frames.
//
// xterm + addon-fit are loaded via React.lazy so the (~150KB gzipped) bundle
// only enters the chunk graph when a user actually opens the terminal.

import * as React from 'react';
import { View, Pressable, Text, ActivityIndicator } from 'react-native';
import { createPortal } from 'react-dom';
import { Ionicons } from '@expo/vector-icons';
import { apiSocket } from '@/sync/apiSocket';
import { showToast } from '@/components/Toast';
import { Modal } from '@/modal';
import { editQuickCommand } from '@/components/TerminalQuickCommandEditor';
import { t } from '@/text';
import { useSettingMutable } from '@/sync/storage';
import type { TerminalQuickCommand, TerminalTheme } from '@/sync/settings';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TerminalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    /** Optional working directory hint forwarded to the CLI as pty-start.cwd. */
    cwd?: string;
}

// ---------------------------------------------------------------------------
// xterm lazy loader
// ---------------------------------------------------------------------------
//
// React.lazy() expects a module with a `default` export that's a component.
// We don't actually want to render xterm as a component — we want the Terminal
// + FitAddon classes. So we wrap them in a tiny "Booter" component that reads
// the loaded modules from a ref, hands them to the parent, and renders
// nothing visible. Suspense triggers the lazy import; once it resolves, the
// effect inside Booter runs and the parent's onReady() callback is invoked.

type XtermModule = typeof import('@xterm/xterm');
type FitAddonModule = typeof import('@xterm/addon-fit');

interface XtermBundle {
    XTerm: XtermModule['Terminal'];
    FitAddon: FitAddonModule['FitAddon'];
}

// Module-scoped cache so re-opening the modal after the first load skips the
// React.Suspense + dynamic-import dance. Declared before the lazy factory so
// the factory body's TDZ doesn't trip when the import resolves.
let loadedBundle: XtermBundle | null = null;

// xterm.js's stylesheet, inlined verbatim from @xterm/xterm@5.5.0/css/xterm.css
// (~5KB). Has to be inlined because Expo/Metro doesn't process .css imports
// through the JS bundle. Without it the helper textarea sits at (0,0) instead
// of off-screen at left:-9999em (you literally see a blue-bordered box at the
// top of the terminal), the viewport never gets `position: absolute` so it
// can't size against its parent, and ANSI underlines/strikethrough are
// rendered as plain text.
const XTERM_CSS = `
.xterm{cursor:text;position:relative;user-select:none;-ms-user-select:none;-webkit-user-select:none}
.xterm.focus,.xterm:focus{outline:none}
.xterm .xterm-helpers{position:absolute;top:0;z-index:5}
.xterm .xterm-helper-textarea{padding:0;border:0;margin:0;position:absolute;opacity:0;left:-9999em;top:0;width:0;height:0;z-index:-5;white-space:nowrap;overflow:hidden;resize:none}
.xterm .composition-view{background:#000;color:#FFF;display:none;position:absolute;white-space:nowrap;z-index:1}
.xterm .composition-view.active{display:block}
.xterm .xterm-viewport{background-color:#000;overflow-y:scroll;cursor:default;position:absolute;right:0;left:0;top:0;bottom:0}
.xterm .xterm-screen{position:relative}
.xterm .xterm-screen canvas{position:absolute;left:0;top:0}
.xterm .xterm-scroll-area{visibility:hidden}
.xterm-char-measure-element{display:inline-block;visibility:hidden;position:absolute;top:0;left:-9999em;line-height:normal}
.xterm.enable-mouse-events{cursor:default}
.xterm.xterm-cursor-pointer,.xterm .xterm-cursor-pointer{cursor:pointer}
.xterm.column-select.focus{cursor:crosshair}
.xterm .xterm-accessibility:not(.debug),.xterm .xterm-message{position:absolute;left:0;top:0;bottom:0;right:0;z-index:10;color:transparent;pointer-events:none}
.xterm .xterm-accessibility-tree:not(.debug) *::selection{color:transparent}
.xterm .xterm-accessibility-tree{user-select:text;white-space:pre}
.xterm .live-region{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.xterm-dim{opacity:1 !important}
.xterm-underline-1{text-decoration:underline}
.xterm-underline-2{text-decoration:double underline}
.xterm-underline-3{text-decoration:wavy underline}
.xterm-underline-4{text-decoration:dotted underline}
.xterm-underline-5{text-decoration:dashed underline}
.xterm-overline{text-decoration:overline}
.xterm-overline.xterm-underline-1{text-decoration:overline underline}
.xterm-overline.xterm-underline-2{text-decoration:overline double underline}
.xterm-overline.xterm-underline-3{text-decoration:overline wavy underline}
.xterm-overline.xterm-underline-4{text-decoration:overline dotted underline}
.xterm-overline.xterm-underline-5{text-decoration:overline dashed underline}
.xterm-strikethrough{text-decoration:line-through}
.xterm-screen .xterm-decoration-container .xterm-decoration{z-index:6;position:absolute}
.xterm-screen .xterm-decoration-container .xterm-decoration.xterm-decoration-top-layer{z-index:7}
.xterm-decoration-overview-ruler{z-index:8;position:absolute;top:0;right:0;pointer-events:none}
.xterm-decoration-top{z-index:2;position:relative}
`;
let xtermCssInjected = false;

type TerminalResolvedTheme = Extract<TerminalTheme, 'light' | 'dark'>;

const TERMINAL_THEME_COLORS = {
    light: {
        panelBackground: '#ffffff',
        headerBackground: '#f8fafc',
        border: '#e5e7eb',
        tabBackground: '#ffffff',
        tabInactiveBackground: 'transparent',
        text: '#111827',
        mutedText: '#6b7280',
        activeBorder: '#d1d5db',
        activeControlBackground: '#eff6ff',
        activeControlBorder: '#bfdbfe',
        activeControlText: '#2563eb',
        xterm: {
            background: '#ffffff',
            foreground: '#111827',
            cursor: '#111827',
            selectionBackground: 'rgba(37,99,235,0.18)',
            black: '#111827',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#949800',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#d1d5db',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#12805c',
            brightYellow: '#9a6700',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#087990',
            brightWhite: '#111827',
        },
    },
    dark: {
        panelBackground: '#0b0f14',
        headerBackground: '#111827',
        border: '#1f2937',
        tabBackground: '#0b0f14',
        tabInactiveBackground: 'transparent',
        text: '#f9fafb',
        mutedText: '#9ca3af',
        activeBorder: '#374151',
        activeControlBackground: '#1e3a8a',
        activeControlBorder: '#2563eb',
        activeControlText: '#93c5fd',
        xterm: {
            background: '#0b0f14',
            foreground: '#f9fafb',
            cursor: '#f9fafb',
            selectionBackground: 'rgba(96,165,250,0.32)',
            black: '#111827',
            red: '#f87171',
            green: '#34d399',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#22d3ee',
            white: '#d1d5db',
            brightBlack: '#6b7280',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde68a',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#67e8f9',
            brightWhite: '#ffffff',
        },
    },
} as const;

function resolveTerminalTheme(value: TerminalTheme | undefined): TerminalResolvedTheme {
    return value === 'light' ? 'light' : 'dark';
}

function injectXtermCssOnce(): void {
    if (xtermCssInjected || typeof document === 'undefined') return;
    if (document.querySelector('style[data-xterm-css]')) {
        xtermCssInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-xterm-css', '1');
    style.textContent = XTERM_CSS;
    document.head.appendChild(style);
    xtermCssInjected = true;
}

const LazyXtermBoot = React.lazy(async () => {
    const [xtermMod, fitMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
    ]);
    // Inject xterm.js's required stylesheet (inlined above as XTERM_CSS).
    // Without it the helper textarea sits visible at the top of the terminal
    // and the viewport doesn't get sized — exactly the broken state users
    // were seeing.
    injectXtermCssOnce();
    const bundle: XtermBundle = {
        XTerm: xtermMod.Terminal,
        FitAddon: fitMod.FitAddon,
    };
    // Capture in module-scope so the Booter component can pull it without
    // having to thread the dynamic import through React state.
    loadedBundle = bundle;
    return {
        default: function XtermBooterDefault(props: { onReady: (b: XtermBundle) => void }) {
            React.useEffect(() => {
                if (loadedBundle) props.onReady(loadedBundle);
            }, [props.onReady]);
            return null;
        },
    };
});

// ---------------------------------------------------------------------------
// PTY error → friendly toast text
// ---------------------------------------------------------------------------

function ptyErrorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    // CLI is expected to reply with these exact strings per protocol.md.
    if (raw.includes('pty_unavailable')) {
        return 'Terminal unavailable: node-pty failed to load on the host. Reinstall happy-cli.';
    }
    if (raw.includes('cli_offline') || raw.toLowerCase().includes('offline')) {
        return 'Terminal unavailable: CLI is not connected.';
    }
    if (raw.toLowerCase().includes('timeout')) {
        return 'Terminal failed to start: CLI did not respond.';
    }
    return raw || 'Failed to start terminal.';
}

// ---------------------------------------------------------------------------
// Encrypt/decrypt the `data` field of a streaming frame.
//
// Wire envelope is `{ sessionId, ptyId, data }` with sessionId + ptyId in the
// clear so the server-relay can route by sessionId without owning the session
// key. `data` itself is encrypted with the session encryption key (same key
// the RPC dispatcher uses), mirroring how `rpc-call` puts `method` plaintext
// + `params` ciphertext in its envelope.
// ---------------------------------------------------------------------------

async function encryptData(sessionId: string, data: unknown): Promise<string | null> {
    const enc = apiSocket.getSessionEncryption(sessionId);
    if (!enc) return null;
    return enc.encryptRaw(data);
}

async function decryptData(sessionId: string, encrypted: string): Promise<any | null> {
    const enc = apiSocket.getSessionEncryption(sessionId);
    if (!enc) return null;
    return enc.decryptRaw(encrypted);
}

// ---------------------------------------------------------------------------
// Inner component, mounted only after the user opens the modal AND xterm has
// finished lazy-loading. Splitting the boot from the runtime keeps the React
// effect graph predictable: ptyId allocation runs once per (sessionId, open).
// ---------------------------------------------------------------------------

interface TerminalRuntimeProps {
    sessionId: string;
    cwd?: string;
    bundle: XtermBundle;
    onError: (msg: string) => void;
    /** Whether this runtime is currently visible inside the tabbed panel. */
    active?: boolean;
    onInputSenderChange?: (sender: ((data: string) => void) | null) => void;
    onClearHandlerChange?: (handler: (() => void) | null) => void;
    terminalTheme: TerminalResolvedTheme;
}

const TerminalRuntime: React.FC<TerminalRuntimeProps> = ({ sessionId, cwd, bundle, onError, active = true, onInputSenderChange, onClearHandlerChange, terminalTheme }) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const termRef = React.useRef<InstanceType<XtermModule['Terminal']> | null>(null);
    const fitRef = React.useRef<InstanceType<FitAddonModule['FitAddon']> | null>(null);
    const ptyIdRef = React.useRef<string | null>(null);
    const closedRef = React.useRef(false);
    const activeRef = React.useRef(active);
    const [isActivating, setIsActivating] = React.useState(false);
    const onInputSenderChangeRef = React.useRef(onInputSenderChange);
    const onClearHandlerChangeRef = React.useRef(onClearHandlerChange);
    const themeColors = TERMINAL_THEME_COLORS[terminalTheme];

    React.useLayoutEffect(() => { activeRef.current = active; }, [active]);
    React.useLayoutEffect(() => { onInputSenderChangeRef.current = onInputSenderChange; }, [onInputSenderChange]);
    React.useLayoutEffect(() => { onClearHandlerChangeRef.current = onClearHandlerChange; }, [onClearHandlerChange]);

    React.useEffect(() => {
        if (!termRef.current) return;
        termRef.current.options.theme = themeColors.xterm;
    }, [themeColors.xterm]);

    const fitAndResize = React.useCallback(() => {
        if (!fitRef.current || !termRef.current) return;
        try {
            fitRef.current.fit();
            const ptyId = ptyIdRef.current;
            if (!ptyId) return;
            const cols = termRef.current.cols;
            const rows = termRef.current.rows;
            apiSocket.sessionRPC(sessionId, 'pty-resize', { ptyId, cols, rows }).catch(() => {});
        } catch { /* container detached */ }
    }, [sessionId]);

    const sendPtyInput = React.useCallback(async (data: string) => {
        if (!ptyIdRef.current || closedRef.current) return;
        try {
            const encryptedData = await encryptData(sessionId, data);
            if (encryptedData == null) return;
            apiSocket.send('pty-input', {
                sessionId,
                ptyId: ptyIdRef.current,
                data: encryptedData,
            });
        } catch { /* drop frame on encrypt error; user will retry */ }
    }, [sessionId]);

    React.useLayoutEffect(() => {
        if (!active) return;
        setIsActivating(true);
        let frame1 = 0;
        let frame2 = 0;
        frame1 = requestAnimationFrame(() => {
            fitAndResize();
            frame2 = requestAnimationFrame(() => {
                fitAndResize();
                setIsActivating(false);
            });
        });
        return () => {
            cancelAnimationFrame(frame1);
            cancelAnimationFrame(frame2);
        };
    }, [active, fitAndResize]);

    React.useEffect(() => {
        let cancelled = false;
        const dataDisposers: Array<() => void> = [];

        const term = new bundle.XTerm({
            cursorBlink: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            theme: themeColors.xterm,
            convertEol: true,
            allowProposedApi: true,
        });
        const fit = new bundle.FitAddon();
        term.loadAddon(fit);
        termRef.current = term;
        fitRef.current = fit;

        if (containerRef.current) {
            term.open(containerRef.current);
        }

        // ---- spawn the PTY ----------------------------------------------
        (async () => {
            try {
                // Wait for the container to paint + fit() to compute real
                // cols/rows BEFORE spawning. If we spawn first, term.cols/rows
                // are still the xterm default 80x24, but xterm itself sizes
                // up to fill its container (could be 120x40+) — TUIs like
                // claude/vim then render against the wrong geometry and you
                // get the screen-tearing seen in user reports.
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                if (containerRef.current) {
                    try { fit.fit(); } catch { /* container 0x0, retry on resize */ }
                }
                const dims = (() => {
                    try {
                        const c = term.cols, r = term.rows;
                        // Guard against degenerate sizes from a hidden / 0x0
                        // container — fall back to a safe default.
                        if (c < 20 || r < 5) return { cols: 80, rows: 24 };
                        return { cols: c, rows: r };
                    } catch { return { cols: 80, rows: 24 }; }
                })();
                // CLI handler returns { ok: true, ptyId } on success and
                // { ok: false, error: 'pty_unavailable' | <message> } when
                // node-pty failed to native-build at install time. We have to
                // check the discriminator BEFORE assuming ptyId exists.
                type PtyStartResult = { ok: true; ptyId: string } | { ok: false; error: string };
                const result = await apiSocket.sessionRPC<PtyStartResult, { cols: number; rows: number; cwd?: string }>(
                    sessionId,
                    'pty-start',
                    { cols: dims.cols, rows: dims.rows, cwd },
                );
                if (cancelled) {
                    // User closed before spawn returned — clean up immediately.
                    try {
                        if (result?.ok && result.ptyId) {
                            await apiSocket.sessionRPC(sessionId, 'pty-close', { ptyId: result.ptyId });
                        }
                    } catch { /* best-effort */ }
                    return;
                }
                if (!result?.ok) {
                    const err = result?.error;
                    if (err === 'pty_unavailable') {
                        // node-pty failed to native-compile on the user's CLI
                        // install. Reinstall with build tools available
                        // (python3 + a C++ toolchain) and the message goes away.
                        onError('终端不可用：CLI 端 node-pty 未成功编译。请在装好 python3 + 编译器的环境下重装：npm install -g happy-ai-cli@latest');
                    } else {
                        onError(`Terminal failed to start: ${err || 'unknown error'}`);
                    }
                    return;
                }
                if (!result.ptyId) {
                    onError('Terminal failed to start: invalid response from CLI.');
                    return;
                }
                ptyIdRef.current = result.ptyId;

                // Focus xterm so its hidden textarea actually receives
                // keystrokes — without this the modal opens but typing does
                // nothing (the textarea exists off-screen but has no focus).
                try { term.focus(); } catch { /* ignore */ }

                // ---- forward keystrokes / controls ----
                onInputSenderChangeRef.current?.(sendPtyInput);
                onClearHandlerChangeRef.current?.(() => {
                    try {
                        term.clear();
                        term.scrollToBottom();
                        term.focus();
                    } catch { /* terminal detached */ }
                });
                const onDataDisposable = term.onData((data: string) => {
                    void sendPtyInput(data);
                });
                dataDisposers.push(() => onDataDisposable.dispose());
            } catch (err) {
                if (!cancelled) onError(ptyErrorMessage(err));
            }
        })();

        // ---- subscribe to streaming output ------------------------------
        const offOutput = apiSocket.onSocketEvent('pty-output', async (frame: any) => {
            // frame = { sessionId, ptyId, data: <ciphertext> }
            try {
                if (!frame || typeof frame !== 'object') return;
                if (frame.sessionId !== sessionId) return;
                if (!ptyIdRef.current || frame.ptyId !== ptyIdRef.current) return;
                const decryptedB64 = typeof frame.data === 'string'
                    ? await decryptData(sessionId, frame.data)
                    : null;
                if (typeof decryptedB64 !== 'string') return;
                // base64 → Uint8Array. Use atob (web-only file).
                const bin = atob(decryptedB64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                term.write(bytes);
            } catch { /* drop malformed frame */ }
        });

        const offExit = apiSocket.onSocketEvent('pty-exit', (frame: any) => {
            try {
                if (!frame || typeof frame !== 'object') return;
                if (frame.sessionId !== sessionId) return;
                if (!ptyIdRef.current || frame.ptyId !== ptyIdRef.current) return;
                const code = frame.exitCode;
                term.write(`\r\n[process exited${typeof code === 'number' ? ` with code ${code}` : ''}]\r\n`);
                // Don't auto-close the modal: the user may want to read scrollback.
            } catch { /* ignore */ }
        });

        // ---- forward layout changes to the PTY --------------------------
        const ro = new ResizeObserver(() => {
            if (!activeRef.current) return;
            // Fire-and-forget; resize is idempotent and rate-limited by
            // ResizeObserver itself.
            fitAndResize();
        });
        if (containerRef.current) ro.observe(containerRef.current);

        return () => {
            cancelled = true;
            closedRef.current = true;
            try { ro.disconnect(); } catch { /* ignore */ }
            offOutput();
            offExit();
            for (const d of dataDisposers) {
                try { d(); } catch { /* ignore */ }
            }
            onInputSenderChangeRef.current?.(null);
            onClearHandlerChangeRef.current?.(null);
            const ptyId = ptyIdRef.current;
            ptyIdRef.current = null;
            if (ptyId) {
                // Fire-and-forget; if the CLI is gone the server eventually
                // gc's the spawn anyway.
                apiSocket.sessionRPC(sessionId, 'pty-close', { ptyId }).catch(() => {});
            }
            try { term.dispose(); } catch { /* ignore */ }
            termRef.current = null;
            fitRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, cwd, bundle, sendPtyInput]);

    return (
        <div
            style={{
                flex: 1,
                width: '100%',
                height: '100%',
                background: themeColors.xterm.background,
                padding: 8,
                boxSizing: 'border-box',
                overflow: 'hidden',
                display: 'flex',
                minWidth: 0,
                minHeight: 0,
                opacity: isActivating ? 0 : 1,
            }}
        >
            {/* Keep padding off the xterm fit host. FitAddon measures the
                host's computed width/height; padding on that same element
                overestimates cols/rows and clips the right/bottom text. */}
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    minWidth: 0,
                    minHeight: 0,
                    background: themeColors.xterm.background,
                    overflow: 'hidden',
                }}
            />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Outer modal: portal + chrome + lazy boot.
// ---------------------------------------------------------------------------

export const Terminal: React.FC<TerminalProps> = ({ visible, onClose, sessionId, cwd }) => {
    const [bundle, setBundle] = React.useState<XtermBundle | null>(loadedBundle);
    const [terminalThemeSetting] = useSettingMutable('terminalTheme');
    const resolvedTerminalTheme = resolveTerminalTheme(terminalThemeSetting);
    const [errorClosed, setErrorClosed] = React.useState(false);

    // Reset error-close flag when the modal is re-opened.
    React.useEffect(() => {
        if (visible) setErrorClosed(false);
    }, [visible]);

    const handleError = React.useCallback((msg: string) => {
        if (errorClosed) return;
        setErrorClosed(true);
        showToast(msg);
        onClose();
    }, [errorClosed, onClose]);

    // Fullscreen toggle (persisted). Default on first open: not full —
    // fullscreen feels too domineering for a side-tool.
    const [isFullscreen, setIsFullscreen] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage?.getItem('terminal.fullscreen') === '1';
    });
    const toggleFullscreen = React.useCallback(() => {
        setIsFullscreen(prev => {
            const next = !prev;
            try { window.localStorage?.setItem('terminal.fullscreen', next ? '1' : '0'); } catch {}
            return next;
        });
    }, []);

    // Minimize toggle (persisted). When minimized, the modal collapses to a
    // small bar in the bottom-right corner. Critical detail: the body is
    // hidden via display:none rather than unmounting TerminalRuntime, so the
    // PTY connection + scrollback survive the minimize/restore cycle and the
    // user can pick up where they left off.
    const [isMinimized, setIsMinimized] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage?.getItem('terminal.minimized') === '1';
    });
    const toggleMinimize = React.useCallback(() => {
        setIsMinimized(prev => {
            const next = !prev;
            try { window.localStorage?.setItem('terminal.minimized', next ? '1' : '0'); } catch {}
            return next;
        });
    }, []);

    // Persisted window size for the non-fullscreen mode. Default 900x560
    // (~80x24 chars at 14px). Stored as { w, h } in localStorage and
    // re-read on each open. We let CSS `resize: both` drive interactive
    // resizing — a ResizeObserver writes the user's chosen size back so
    // it sticks across reopens.
    const [winSize, setWinSize] = React.useState<{ w: number; h: number }>(() => {
        if (typeof window === 'undefined') return { w: 900, h: 560 };
        try {
            const raw = window.localStorage?.getItem('terminal.winSize');
            if (raw) {
                const parsed = JSON.parse(raw);
                // Only honor values that look like a real chosen window size.
                // Anything below the modal's min was either set by the prior
                // minimize bug (which observed the 220x40 pill) or otherwise
                // unusable — fall back to default rather than opening tiny.
                if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number'
                    && parsed.w >= 360 && parsed.h >= 240) {
                    return { w: parsed.w, h: parsed.h };
                }
            }
        } catch {}
        return { w: 900, h: 560 };
    });
    const winRef = React.useRef<HTMLDivElement | null>(null);
    const winSizeRef = React.useRef(winSize);
    React.useEffect(() => { winSizeRef.current = winSize; }, [winSize]);

    // Persisted top-left position. Null until first compute (so the modal
    // initially centers via translate(-50%,-50%) before we lock to fixed
    // pixels). Switching from center-anchor (transform translate) to fixed
    // top/left is what makes resize feel right: when the user drags an edge,
    // ONLY that edge moves — the opposite edge stays put. Center anchor
    // doubled the delta (move width by 2*dx because both edges moved away
    // from center), which felt like "the window is over-expanding".
    const [winPos, setWinPos] = React.useState<{ top: number; left: number } | null>(() => {
        if (typeof window === 'undefined') return null;
        try {
            const raw = window.localStorage?.getItem('terminal.winPos');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (typeof parsed?.top === 'number' && typeof parsed?.left === 'number') {
                    return { top: parsed.top, left: parsed.left };
                }
            }
        } catch {}
        return null;
    });
    const winPosRef = React.useRef(winPos);
    React.useEffect(() => { winPosRef.current = winPos; }, [winPos]);

    // First-open: compute centered position once we know viewport size.
    React.useEffect(() => {
        if (winPos != null || typeof window === 'undefined') return;
        if (isFullscreen || isMinimized) return;
        const top = Math.max(0, Math.round((window.innerHeight - winSize.h - 12) / 2));
        const left = Math.max(0, Math.round((window.innerWidth - winSize.w - 12) / 2));
        setWinPos({ top, left });
    }, [winPos, winSize, isFullscreen, isMinimized]);

    // Drag-to-resize from any edge or corner. OS-standard semantics:
    // dragging the right edge moves only the right edge; left edge moves
    // only the left edge (so width = startW - dx and left = startLeft + dx
    // to keep the right edge stable). Same for top/bottom.
    //
    // signX: -1 = left edge, +1 = right edge, 0 = no horizontal change
    // signY: -1 = top edge,  +1 = bottom edge, 0 = no vertical change
    const handleResizeStart = (signX: -1 | 0 | 1, signY: -1 | 0 | 1) => (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = winSizeRef.current.w;
        const startH = winSizeRef.current.h;
        const startTop = winPosRef.current?.top ?? 0;
        const startLeft = winPosRef.current?.left ?? 0;
        let lastSize = { w: startW, h: startH };
        let lastPos = { top: startTop, left: startLeft };
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            let newW = startW;
            let newLeft = startLeft;
            if (signX === 1) newW = startW + dx;
            else if (signX === -1) { newW = startW - dx; newLeft = startLeft + dx; }
            let newH = startH;
            let newTop = startTop;
            if (signY === 1) newH = startH + dy;
            else if (signY === -1) { newH = startH - dy; newTop = startTop + dy; }
            // Clamp width — when shrinking from the left edge, we have to
            // un-shift left so the right edge stays stable instead of
            // creeping off-screen.
            if (newW < 360) {
                if (signX === -1) newLeft -= (360 - newW);
                newW = 360;
            }
            if (newH < 240) {
                if (signY === -1) newTop -= (240 - newH);
                newH = 240;
            }
            const maxW = window.innerWidth - 12;
            const maxH = window.innerHeight - 12;
            if (newW > maxW) {
                if (signX === -1) newLeft += (newW - maxW);
                newW = maxW;
            }
            if (newH > maxH) {
                if (signY === -1) newTop += (newH - maxH);
                newH = maxH;
            }
            // Keep the modal box (size + 12 padding ring) inside the viewport.
            newLeft = Math.max(0, Math.min(window.innerWidth - newW - 12, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - newH - 12, newTop));
            lastSize = { w: newW, h: newH };
            lastPos = { top: newTop, left: newLeft };
            setWinSize(lastSize);
            setWinPos(lastPos);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            try { window.localStorage?.setItem('terminal.winSize', JSON.stringify(lastSize)); } catch {}
            try { window.localStorage?.setItem('terminal.winPos', JSON.stringify(lastPos)); } catch {}
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    if (!visible) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        // Two siblings, NOT a full-viewport wrapper: the wrapper would block
        // pointer events even when minimized (RN-web's pointerEvents prop is
        // unreliable when set via style), preventing clicks on the sidebar /
        // input field while the pill sits in the corner.
        //   1. Backdrop (only when fully open) — full-viewport dim + click-to-close
        //   2. Modal frame — fixed-positioned div that switches between
        //      bottom-right pill, fullscreen, or centered floating window
        <>
            {!isMinimized && (
                // Click-outside MINIMIZES rather than closes — terminal is a
                // dock-style long-running tool, not a transient modal. The
                // X button is still the explicit "really close" path. Native
                // div + onClick because RN-web's Pressable in a portal with
                // fixed positioning sometimes silently swallows clicks.
                <div
                    onClick={toggleMinimize}
                    style={{
                        position: 'fixed' as any,
                        top: 0, left: 0, right: 0, bottom: 0,
                        zIndex: 99998,
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        cursor: 'pointer',
                    }}
                />
            )}
            <div
                ref={winRef}
                onClick={isMinimized ? toggleMinimize : undefined}
                style={{
                    position: 'fixed' as any,
                    zIndex: 99999,
                    display: 'flex',
                    flexDirection: 'column',
                    ...(isMinimized
                        ? {
                            // Bottom-right pill. Body is display:none so the
                            // whole frame collapses to chrome-height; the
                            // whole bar is clickable to restore.
                            bottom: 16,
                            right: 16,
                            width: 220,
                            height: 40,
                            background: '#1a1a1a',
                            border: '1px solid #2a2a2a',
                            borderRadius: 8,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                            overflow: 'hidden',
                            cursor: 'pointer',
                        }
                        : isFullscreen
                        ? {
                            top: 0, left: 0,
                            width: '100vw',
                            height: '100vh',
                            background: '#000',
                        }
                        : {
                            // Floating window with fixed top/left so each
                            // resize handle moves only its own edge (OS-
                            // standard). winPos is null on first open;
                            // fallback to center anchor for that one frame
                            // until the position-init effect runs.
                            ...(winPos
                                ? { top: winPos.top, left: winPos.left }
                                : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
                            width: winSize.w + 12,
                            height: winSize.h + 12,
                            background: '#000',
                            borderRadius: 8,
                            overflow: 'hidden',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
                            padding: 6,
                        }),
                }}
            >
                {/* 8-handle resize ring — only in the floating-window state.
                    Sits in the modal's 6px padding so it never overlaps the
                    chrome buttons (which live in the content area inset by
                    padding). signX/signY pick which axis grows. */}
                {!isFullscreen && !isMinimized && (
                    <>
                        {/* Edges */}
                        <div onMouseDown={handleResizeStart(0, -1)} style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
                        <div onMouseDown={handleResizeStart(0, 1)}  style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 'ns-resize', zIndex: 10 }} />
                        <div onMouseDown={handleResizeStart(-1, 0)} style={{ position: 'absolute', top: 12, bottom: 12, left: 0, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
                        <div onMouseDown={handleResizeStart(1, 0)}  style={{ position: 'absolute', top: 12, bottom: 12, right: 0, width: 6, cursor: 'ew-resize', zIndex: 10 }} />
                        {/* Corners (zIndex above edges so the cursor reads as diagonal in the overlap) */}
                        <div onMouseDown={handleResizeStart(-1, -1)} style={{ position: 'absolute', top: 0, left: 0, width: 12, height: 12, cursor: 'nwse-resize', zIndex: 11 }} />
                        <div onMouseDown={handleResizeStart(1, -1)}  style={{ position: 'absolute', top: 0, right: 0, width: 12, height: 12, cursor: 'nesw-resize', zIndex: 11 }} />
                        <div onMouseDown={handleResizeStart(-1, 1)}  style={{ position: 'absolute', bottom: 0, left: 0, width: 12, height: 12, cursor: 'nesw-resize', zIndex: 11 }} />
                        <div onMouseDown={handleResizeStart(1, 1)}   style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, cursor: 'nwse-resize', zIndex: 11 }} />
                    </>
                )}
                {/* Top chrome */}
                <View
                    style={{
                        height: 40,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 12,
                        backgroundColor: '#1a1a1a',
                        borderBottomWidth: isMinimized ? 0 : 1,
                        borderBottomColor: '#2a2a2a',
                    }}
                >
                    <Ionicons name="terminal-outline" size={16} color="#e5e5e5" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#e5e5e5', fontSize: 13, fontWeight: '600' }}>
                        {isMinimized ? '终端 (后台)' : '终端'}
                    </Text>
                    <View style={{ flex: 1 }} />
                    {!isMinimized && (
                        <>
                            <Pressable
                                onPress={toggleMinimize}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel="Minimize terminal"
                                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                            >
                                <Ionicons name="remove-outline" size={20} color="#e5e5e5" />
                            </Pressable>
                            <Pressable
                                onPress={toggleFullscreen}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                            >
                                <Ionicons name={isFullscreen ? 'contract-outline' : 'expand-outline'} size={18} color="#e5e5e5" />
                            </Pressable>
                        </>
                    )}
                    {isMinimized && (
                        <Ionicons name="open-outline" size={16} color="#9ca3af" style={{ marginRight: 6 }} />
                    )}
                    <Pressable
                        // Stop propagation so clicking close while minimized
                        // doesn't also fire the bar-restore handler.
                        // @ts-ignore — RN-web Pressable accepts onClick
                        onClick={(e: any) => e.stopPropagation?.()}
                        onPress={onClose}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Close terminal"
                        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Ionicons name="close" size={20} color="#e5e5e5" />
                    </Pressable>
                </View>

                {/* xterm body — display:none keeps TerminalRuntime mounted so the
                    PTY connection + scrollback survive a minimize/restore. */}
                <View style={{ flex: 1, backgroundColor: '#000', display: isMinimized ? 'none' : 'flex' }}>
                    <React.Suspense
                        fallback={
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                                <ActivityIndicator size="small" color="#e5e5e5" />
                            </View>
                        }
                    >
                        {/* Boot is rendered once; it resolves the lazy bundle and
                            calls onReady to flip our local state. After that the
                            runtime component takes over and Boot stays mounted as
                            a no-op. */}
                        {!bundle && <LazyXtermBoot onReady={setBundle} />}
                    </React.Suspense>
                    {bundle && (
                        <TerminalRuntime
                            sessionId={sessionId}
                            cwd={cwd}
                            bundle={bundle}
                            onError={handleError}
                            terminalTheme={resolvedTerminalTheme}
                        />
                    )}
                </View>
            </div>
        </>,
        document.body,
    );
};


function terminalLabelFromCwd(cwd?: string): string {
    const trimmed = cwd?.replace(/\/+$/, '');
    if (!trimmed) return '终端';
    return trimmed.split('/').filter(Boolean).pop() || '终端';
}

type TerminalPanelTab = {
    id: string;
    title: string;
    sessionId: string;
    cwd?: string;
};

type TerminalWorkspace = {
    key: string;
    sessionId: string;
    cwd?: string;
    tabs: TerminalPanelTab[];
    activeTabId: string;
    tabCounter: number;
};

interface TerminalPanelProps extends TerminalProps {
    /** Incremented by the header terminal button to open/create the current session terminal. */
    openRequestKey?: number;
}

function createTerminalWorkspace(sessionId: string, cwd?: string): TerminalWorkspace {
    const title = terminalLabelFromCwd(cwd);
    return {
        key: sessionId,
        sessionId,
        cwd,
        tabCounter: 1,
        activeTabId: `${sessionId}:terminal-1`,
        tabs: [{ id: `${sessionId}:terminal-1`, title, sessionId, cwd }],
    };
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ visible, onClose, sessionId, cwd, openRequestKey = 0 }) => {
    const [bundle, setBundle] = React.useState<XtermBundle | null>(loadedBundle);
    const [errorClosed, setErrorClosed] = React.useState(false);
    const inputSendersRef = React.useRef<Record<string, ((data: string) => void) | undefined>>({});
    const clearHandlersRef = React.useRef<Record<string, (() => void) | undefined>>({});
    const [terminalQuickCommands, setTerminalQuickCommands] = useSettingMutable('terminalQuickCommands');
    const [terminalThemeSetting] = useSettingMutable('terminalTheme');
    const [quickCommandsOpen, setQuickCommandsOpen] = React.useState(false);
    const [managerOpen, setManagerOpen] = React.useState(false);
    const [hasOpened, setHasOpened] = React.useState(visible);
    const safeArea = useSafeAreaInsets();
    // Show quick commands sorted by display name so the list stays scannable.
    const sortedQuickCommands = React.useMemo(
        () => [...terminalQuickCommands].sort((a, b) => a.title.localeCompare(b.title)),
        [terminalQuickCommands],
    );
    const [workspaces, setWorkspaces] = React.useState<Record<string, TerminalWorkspace>>({});
    const [activeWorkspaceKey, setActiveWorkspaceKey] = React.useState('');
    const handledOpenRequestKeyRef = React.useRef(0);
    const processedOpenRequestKeyRef = React.useRef(0);
    const panelWidthRef = React.useRef(420);
    const [panelWidth, setPanelWidth] = React.useState<number>(() => {
        if (typeof window === 'undefined') return 420;
        try {
            const raw = window.localStorage?.getItem('terminal.panelWidth');
            const parsed = raw ? Number(raw) : NaN;
            if (Number.isFinite(parsed) && parsed >= 320) {
                return Math.min(parsed, Math.round(window.innerWidth * 0.55));
            }
        } catch {}
        return 420;
    });

    React.useEffect(() => { panelWidthRef.current = panelWidth; }, [panelWidth]);
    React.useEffect(() => {
        if (!visible) return;
        setHasOpened(true);
        setErrorClosed(false);
    }, [visible]);

    React.useEffect(() => {
        if (!visible || openRequestKey <= 0 || openRequestKey <= processedOpenRequestKeyRef.current) return;
        processedOpenRequestKeyRef.current = openRequestKey;
        setHasOpened(true);
        setErrorClosed(false);
        setWorkspaces((current) => {
            if (current[sessionId]) return current;
            return { ...current, [sessionId]: createTerminalWorkspace(sessionId, cwd) };
        });
        setActiveWorkspaceKey(sessionId);
    }, [cwd, openRequestKey, sessionId, visible]);

    const resolvedTerminalTheme = resolveTerminalTheme(terminalThemeSetting);
    const panelTheme = TERMINAL_THEME_COLORS[resolvedTerminalTheme];

    const activeWorkspace = workspaces[activeWorkspaceKey];
    const activeTerminalTabId = activeWorkspace?.activeTabId ?? '';
    const terminalTabs = activeWorkspace?.tabs ?? [];

    const allWorkspaces = React.useMemo(() => Object.values(workspaces), [workspaces]);

    React.useEffect(() => {
        if (!visible || !hasOpened) return;
        if (allWorkspaces.length === 0) {
            if (openRequestKey > handledOpenRequestKeyRef.current) return;
            onClose();
            return;
        } else if (!workspaces[activeWorkspaceKey]) setActiveWorkspaceKey(allWorkspaces[0].key);
    }, [activeWorkspaceKey, allWorkspaces, hasOpened, onClose, openRequestKey, visible, workspaces]);

    React.useEffect(() => {
        if (openRequestKey > handledOpenRequestKeyRef.current && workspaces[sessionId]) {
            handledOpenRequestKeyRef.current = openRequestKey;
        }
    }, [openRequestKey, sessionId, workspaces]);

    const handleError = React.useCallback((msg: string) => {
        if (errorClosed) return;
        setErrorClosed(true);
        showToast(msg);
        onClose();
    }, [errorClosed, onClose]);

    const handleInputSenderChange = React.useCallback((tabId: string, sender: ((data: string) => void) | null) => {
        if (sender) inputSendersRef.current[tabId] = sender;
        else delete inputSendersRef.current[tabId];
    }, []);

    const handleClearHandlerChange = React.useCallback((tabId: string, handler: (() => void) | null) => {
        if (handler) clearHandlersRef.current[tabId] = handler;
        else delete clearHandlersRef.current[tabId];
    }, []);

    const activeInputSender = React.useCallback(() => inputSendersRef.current[activeTerminalTabId], [activeTerminalTabId]);

    const handleClearActiveTerminal = React.useCallback(() => {
        const clear = clearHandlersRef.current[activeTerminalTabId];
        if (!clear) {
            showToast(t('terminal.quickCommandsTerminalNotReady'));
            return;
        }
        clear();
    }, [activeTerminalTabId]);

    const handleRunQuickCommand = React.useCallback((command: string) => {
        const sender = activeInputSender();
        if (!sender) {
            showToast(t('terminal.quickCommandsTerminalNotReady'));
            return;
        }
        sender(`${command}\r`);
        setQuickCommandsOpen(false);
    }, [activeInputSender]);

    const saveQuickCommand = React.useCallback(async (existing?: TerminalQuickCommand) => {
        const result = await editQuickCommand({
            title: existing ? t('terminal.quickCommandsEditTitle') : t('terminal.quickCommandsAddTitle'),
            initialName: existing?.title ?? '',
            initialCommand: existing?.command ?? '',
        });
        if (!result) return;
        const now = Date.now();
        if (existing) {
            setTerminalQuickCommands(terminalQuickCommands.map((item) => item.id === existing.id
                ? { ...item, title: result.title, command: result.command, updatedAt: now }
                : item));
        } else {
            setTerminalQuickCommands([
                ...terminalQuickCommands,
                { id: randomUUID(), title: result.title, command: result.command, createdAt: now, updatedAt: now },
            ]);
        }
    }, [setTerminalQuickCommands, terminalQuickCommands]);

    const deleteQuickCommand = React.useCallback(async (command: TerminalQuickCommand) => {
        const ok = await Modal.confirm(
            t('terminal.quickCommandsDeleteTitle'),
            t('terminal.quickCommandsDeleteMessage', { title: command.title }),
            { confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true },
        );
        if (!ok) return;
        setTerminalQuickCommands(terminalQuickCommands.filter((item) => item.id !== command.id));
    }, [setTerminalQuickCommands, terminalQuickCommands]);

    const handleAddTerminalTab = React.useCallback(() => {
        setWorkspaces((current) => {
            const workspace = current[activeWorkspaceKey] ?? createTerminalWorkspace(sessionId, cwd);
            const nextIndex = workspace.tabCounter + 1;
            const baseTitle = terminalLabelFromCwd(workspace.cwd ?? cwd);
            const nextTab = {
                id: `${workspace.sessionId}:terminal-${nextIndex}`,
                title: `${baseTitle} ${nextIndex}`,
                sessionId: workspace.sessionId,
                cwd: workspace.cwd ?? cwd,
            };
            return {
                ...current,
                [workspace.key]: {
                    ...workspace,
                    tabCounter: nextIndex,
                    activeTabId: nextTab.id,
                    tabs: [...workspace.tabs, nextTab],
                },
            };
        });
    }, [activeWorkspaceKey, cwd, sessionId]);

    const handleSelectTerminalTab = React.useCallback((tabId: string) => {
        setWorkspaces((current) => {
            const workspace = current[activeWorkspaceKey];
            if (!workspace) return current;
            return { ...current, [activeWorkspaceKey]: { ...workspace, activeTabId: tabId } };
        });
    }, [activeWorkspaceKey]);

    const handleSelectWorkspace = React.useCallback((workspaceKey: string) => {
        setActiveWorkspaceKey(workspaceKey);
        setManagerOpen(false);
    }, []);

    const handleSelectManagedTerminalTab = React.useCallback((workspaceKey: string, tabId: string) => {
        setActiveWorkspaceKey(workspaceKey);
        setManagerOpen(false);
        setWorkspaces((current) => {
            const workspace = current[workspaceKey];
            if (!workspace) return current;
            return { ...current, [workspaceKey]: { ...workspace, activeTabId: tabId } };
        });
    }, []);

    const handleCloseTerminalTab = React.useCallback((workspaceKey: string, tabId: string) => {
        setWorkspaces((current) => {
            const workspace = current[workspaceKey];
            if (!workspace) return current;
            const closingIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
            const nextTabs = workspace.tabs.filter((tab) => tab.id !== tabId);
            const next = { ...current };
            delete inputSendersRef.current[tabId];
            delete clearHandlersRef.current[tabId];
            if (nextTabs.length === 0) {
                delete next[workspaceKey];
                return next;
            }
            const fallbackTab = workspace.activeTabId === tabId
                ? (nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? nextTabs[0])
                : nextTabs.find((tab) => tab.id === workspace.activeTabId);
            next[workspaceKey] = {
                ...workspace,
                tabs: nextTabs,
                activeTabId: fallbackTab?.id ?? nextTabs[0].id,
            };
            return next;
        });
    }, []);

    const handleCloseWorkspace = React.useCallback((workspaceKey: string) => {
        setWorkspaces((current) => {
            const workspace = current[workspaceKey];
            if (!workspace) return current;
            for (const tab of workspace.tabs) {
                delete inputSendersRef.current[tab.id];
                delete clearHandlersRef.current[tab.id];
            }
            const next = { ...current };
            delete next[workspaceKey];
            return next;
        });
    }, []);

    const handlePanelResizeStart = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = panelWidthRef.current;
        let lastWidth = startWidth;
        const clampWidth = (value: number) => {
            const maxWidth = typeof window === 'undefined' ? 720 : Math.round(window.innerWidth * 0.65);
            return Math.max(320, Math.min(maxWidth, value));
        };
        const onMove = (ev: MouseEvent) => {
            // The handle is on the panel's left edge: dragging left increases width.
            lastWidth = clampWidth(startWidth + (startX - ev.clientX));
            setPanelWidth(lastWidth);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            try { window.localStorage?.setItem('terminal.panelWidth', String(lastWidth)); } catch {}
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, []);

    if (!visible && !hasOpened) return null;

    return (
        <View
            style={{
                width: panelWidth,
                minWidth: 320,
                alignSelf: 'stretch',
                height: '100%',
                backgroundColor: panelTheme.panelBackground,
                borderLeftWidth: 1,
                borderLeftColor: panelTheme.border,
                boxShadow: '-6px 0 18px rgba(15, 23, 42, 0.08)' as any,
                position: 'relative',
                display: visible ? 'flex' : 'none',
            }}
        >
            <div
                onMouseDown={handlePanelResizeStart}
                title={t('terminal.dragToResizeWidth')}
                style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 6,
                    cursor: 'ew-resize',
                    zIndex: 12,
                }}
            />
            <div
                style={{
                    height: 44,
                    background: panelTheme.headerBackground,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                    borderBottom: `1px solid ${panelTheme.border}`,
                    padding: '0 8px 0 10px',
                    boxSizing: 'border-box',
                    position: 'relative',
                }}
            >
                <div
                    style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, overflow: 'hidden' }}
                >
                    {terminalTabs.map((tab) => {
                        const isActive = tab.id === activeTerminalTabId;
                        return (
                            <div
                                key={tab.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSelectTerminalTab(tab.id)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        handleSelectTerminalTab(tab.id);
                                    }
                                }}
                                style={{
                                    height: 30,
                                    maxWidth: 180,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    border: isActive ? `1px solid ${panelTheme.activeBorder}` : '1px solid transparent',
                                    borderRadius: 6,
                                    background: isActive ? panelTheme.tabBackground : panelTheme.tabInactiveBackground,
                                    color: isActive ? panelTheme.text : panelTheme.mutedText,
                                    cursor: 'pointer',
                                    padding: '0 4px 0 8px',
                                    fontSize: 12,
                                    fontWeight: isActive ? 600 : 500,
                                    minWidth: 0,
                                }}
                            >
                                <Ionicons name="terminal-outline" size={13} color={isActive ? panelTheme.text : panelTheme.mutedText} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
                                <button
                                    type="button"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleCloseTerminalTab(activeWorkspaceKey, tab.id);
                                    }}
                                    aria-label="Close terminal tab"
                                    title={t('terminal.closeTerminalTab')}
                                    style={{
                                        width: 20,
                                        height: 20,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        border: 0,
                                        borderRadius: 999,
                                        background: 'transparent',
                                        color: panelTheme.mutedText,
                                        cursor: 'pointer',
                                        padding: 0,
                                        flexShrink: 0,
                                    }}
                                >
                                    <Ionicons name="close-circle" size={16} color={panelTheme.mutedText} />
                                </button>
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        onClick={handleAddTerminalTab}
                        aria-label="New terminal tab"
                        title={t('terminal.newTerminalTab')}
                        style={{
                            width: 30,
                            height: 30,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '1px solid transparent',
                            borderRadius: 6,
                            background: 'transparent',
                            color: panelTheme.mutedText,
                            cursor: 'pointer',
                            padding: 0,
                            flexShrink: 0,
                        }}
                    >
                        <Ionicons name="add" size={18} color={panelTheme.mutedText} />
                    </button>
                </div>
                <button
                    type="button"
                    onClick={handleClearActiveTerminal}
                    aria-label={t('terminal.clearTerminal')}
                    title={t('terminal.clearTerminal')}
                    style={{
                        width: 34,
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 0,
                        borderRadius: 6,
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                        marginLeft: 4,
                    }}
                >
                    <Ionicons name="trash-outline" size={18} color={panelTheme.mutedText} />
                </button>
                <button
                    type="button"
                    onClick={() => setManagerOpen((value) => !value)}
                    aria-label={t('terminal.manageTerminals')}
                    title={t('terminal.manageTerminals')}
                    style={{
                        width: 34,
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: managerOpen ? `1px solid ${panelTheme.activeControlBorder}` : 0,
                        borderRadius: 6,
                        background: managerOpen ? panelTheme.activeControlBackground : 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                        marginLeft: 4,
                    }}
                >
                    <Ionicons name="albums-outline" size={18} color={managerOpen ? panelTheme.activeControlText : panelTheme.mutedText} />
                </button>
                <button
                    type="button"
                    onClick={() => setQuickCommandsOpen((value) => !value)}
                    aria-label="Terminal quick commands"
                    title={t('terminal.quickCommands')}
                    style={{
                        width: 34,
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: quickCommandsOpen ? `1px solid ${panelTheme.activeControlBorder}` : 0,
                        borderRadius: 6,
                        background: quickCommandsOpen ? panelTheme.activeControlBackground : 'transparent',
                        cursor: 'pointer',
                        padding: 0,
                        marginLeft: 4,
                    }}
                >
                    <Ionicons name="flash-outline" size={18} color={quickCommandsOpen ? panelTheme.activeControlText : panelTheme.mutedText} />
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close terminal"
                    title={t('terminal.closeTerminal')}
                    style={{
                        width: 34,
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 0,
                        borderRadius: 6,
                        background: 'transparent',
                        color: panelTheme.mutedText,
                        cursor: 'pointer',
                        padding: 0,
                        marginLeft: 2,
                    }}
                >
                    <Ionicons name="close" size={18} color={panelTheme.mutedText} />
                </button>
            </div>
            {managerOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: 50,
                        right: 8,
                        width: Math.min(360, panelWidth - 24),
                        maxHeight: 380,
                        overflow: 'auto',
                        zIndex: 21,
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        boxShadow: '0 12px 30px rgba(15,23,42,0.18)',
                        padding: 8,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <strong style={{ fontSize: 13, color: '#111827' }}>{t('terminal.terminalManager')}</strong>
                        <button type="button" onClick={() => setManagerOpen(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4 }}>
                            <Ionicons name="close" size={16} color="#6b7280" />
                        </button>
                    </div>
                    {allWorkspaces.length === 0 ? (
                        <div style={{ color: '#6b7280', fontSize: 12, padding: '14px 4px' }}>{t('terminal.noBackgroundTerminals')}</div>
                    ) : allWorkspaces.map((workspace) => (
                        <div key={workspace.key} style={{ borderTop: '1px solid #f3f4f6', padding: '8px 4px' }}>
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => handleSelectWorkspace(workspace.key)}
                                onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return;
                                    event.preventDefault();
                                    handleSelectWorkspace(workspace.key);
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 6, cursor: 'pointer', padding: '4px 2px' }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: workspace.key === activeWorkspaceKey ? '#2563eb' : '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {terminalLabelFromCwd(workspace.cwd)}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {t('terminal.terminalCount', { count: workspace.tabs.length })} · {workspace.cwd ?? workspace.sessionId}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleCloseWorkspace(workspace.key);
                                    }}
                                    title={t('terminal.closeTerminalWorkspace')}
                                    style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4 }}
                                >
                                    <Ionicons name="trash-outline" size={15} color="#ef4444" />
                                </button>
                            </div>
                            {workspace.tabs.map((tab) => {
                                const isManagedTabActive = workspace.key === activeWorkspaceKey && tab.id === workspace.activeTabId;
                                return (
                                    <div
                                        key={tab.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => handleSelectManagedTerminalTab(workspace.key, tab.id)}
                                        onKeyDown={(event) => {
                                            if (event.key !== 'Enter' && event.key !== ' ') return;
                                            event.preventDefault();
                                            handleSelectManagedTerminalTab(workspace.key, tab.id);
                                        }}
                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 0 14px', borderRadius: 6, cursor: 'pointer' }}
                                    >
                                        <span style={{ flex: 1, minWidth: 0, color: isManagedTabActive ? '#2563eb' : '#374151', fontSize: 12, fontWeight: isManagedTabActive ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleCloseTerminalTab(workspace.key, tab.id);
                                            }}
                                            title={t('terminal.closeTerminalTab')}
                                            style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 3 }}
                                        >
                                            <Ionicons name="close-circle" size={14} color="#6b7280" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
            {quickCommandsOpen && (
                <>
                {/* Click-outside backdrop: same positioned ancestor as the panel,
                    one z-index below it. Clicking the panel targets the panel
                    (sibling), so it doesn't bubble here; clicking anywhere else
                    in the terminal window closes the panel. */}
                <div
                    onClick={() => setQuickCommandsOpen(false)}
                    style={{ position: 'absolute', inset: 0, zIndex: 19 }}
                />
                <div
                    style={{
                        position: 'absolute',
                        top: 50,
                        right: 8,
                        width: Math.min(340, panelWidth - 24),
                        maxHeight: 360,
                        overflow: 'auto',
                        zIndex: 20,
                        background: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        boxShadow: '0 12px 30px rgba(15,23,42,0.18)',
                        padding: 8,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 13, color: '#111827' }}>{t('terminal.quickCommands')}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                                type="button"
                                onClick={() => void saveQuickCommand()}
                                style={{ border: 0, background: '#2563eb', color: '#fff', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
                            >
                                {t('common.create')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setQuickCommandsOpen(false)}
                                aria-label={t('terminal.closeTerminal')}
                                title={t('terminal.closeTerminal')}
                                style={{
                                    width: 24,
                                    height: 24,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: 0,
                                    borderRadius: 6,
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                            >
                                <Ionicons name="close" size={16} color="#6b7280" />
                            </button>
                        </div>
                    </div>
                    {terminalQuickCommands.length === 0 ? (
                        <div style={{ color: '#6b7280', fontSize: 12, padding: '14px 4px' }}>{t('terminal.quickCommandsEmpty')}</div>
                    ) : sortedQuickCommands.map((command) => (
                        <div key={command.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 4px', borderTop: '1px solid #f3f4f6' }}>
                            <button
                                type="button"
                                onClick={() => handleRunQuickCommand(command.command)}
                                title={command.command}
                                style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', padding: 4 }}
                            >
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{command.title}</div>
                                <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{command.command}</div>
                            </button>
                            <button type="button" onClick={() => void saveQuickCommand(command)} title={t('terminal.quickCommandsEditAction')} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4 }}>
                                <Ionicons name="create-outline" size={16} color="#6b7280" />
                            </button>
                            <button type="button" onClick={() => void deleteQuickCommand(command)} title={t('common.delete')} style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 4 }}>
                                <Ionicons name="trash-outline" size={16} color="#ef4444" />
                            </button>
                        </div>
                    ))}
                </div>
                </>
            )}
            {/* Reserve bottom breathing room so the last terminal line clears
                the device safe area / screen edge instead of being flush. The
                gap color matches the terminal background, so it looks seamless. */}
            <View style={{ flex: 1, backgroundColor: panelTheme.panelBackground, paddingBottom: safeArea.bottom + 16 }}>
                <React.Suspense
                    fallback={
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator size="small" color={panelTheme.text} />
                        </View>
                    }
                >
                    {!bundle && <LazyXtermBoot onReady={setBundle} />}
                </React.Suspense>
                {bundle && allWorkspaces.flatMap((workspace) => workspace.tabs.map((tab) => {
                    const isActive = visible && workspace.key === activeWorkspaceKey && tab.id === workspace.activeTabId;
                    return (
                        <View
                            key={tab.id}
                            style={{
                                flex: 1,
                                backgroundColor: panelTheme.panelBackground,
                                display: isActive ? 'flex' : 'none',
                            }}
                        >
                            <TerminalRuntime
                                sessionId={tab.sessionId}
                                cwd={tab.cwd}
                                bundle={bundle}
                                onError={handleError}
                                active={isActive}
                                onInputSenderChange={(sender) => handleInputSenderChange(tab.id, sender)}
                                onClearHandlerChange={(handler) => handleClearHandlerChange(tab.id, handler)}
                                terminalTheme={resolvedTerminalTheme}
                            />
                        </View>
                    );
                }))}
            </View>
        </View>
    );
};
