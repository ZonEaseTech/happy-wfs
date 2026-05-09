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
}

const TerminalRuntime: React.FC<TerminalRuntimeProps> = ({ sessionId, cwd, bundle, onError }) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const termRef = React.useRef<InstanceType<XtermModule['Terminal']> | null>(null);
    const fitRef = React.useRef<InstanceType<FitAddonModule['FitAddon']> | null>(null);
    const ptyIdRef = React.useRef<string | null>(null);
    const closedRef = React.useRef(false);

    React.useEffect(() => {
        let cancelled = false;
        const dataDisposers: Array<() => void> = [];

        const term = new bundle.XTerm({
            cursorBlink: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            theme: {
                background: '#000000',
                foreground: '#e5e5e5',
                cursor: '#e5e5e5',
                selectionBackground: 'rgba(255,255,255,0.25)',
            },
            convertEol: true,
            allowProposedApi: true,
        });
        const fit = new bundle.FitAddon();
        term.loadAddon(fit);
        termRef.current = term;
        fitRef.current = fit;

        if (containerRef.current) {
            term.open(containerRef.current);
            // First fit happens after the DOM has painted at least once.
            requestAnimationFrame(() => {
                try { fit.fit(); } catch { /* container 0x0, retry on resize */ }
            });
        }

        // ---- spawn the PTY ----------------------------------------------
        (async () => {
            try {
                const dims = (() => {
                    try { return { cols: term.cols, rows: term.rows }; } catch { return { cols: 80, rows: 24 }; }
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

                // ---- forward keystrokes ----
                const onDataDisposable = term.onData(async (data: string) => {
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
            if (!fitRef.current || !termRef.current) return;
            try {
                fitRef.current.fit();
                const cols = termRef.current.cols;
                const rows = termRef.current.rows;
                const ptyId = ptyIdRef.current;
                if (!ptyId) return;
                // Fire-and-forget; resize is idempotent and rate-limited by
                // ResizeObserver itself.
                apiSocket.sessionRPC(sessionId, 'pty-resize', { ptyId, cols, rows }).catch(() => {});
            } catch { /* container detached */ }
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
    }, [sessionId, cwd, bundle]);

    return (
        <div
            ref={containerRef}
            style={{
                flex: 1,
                width: '100%',
                height: '100%',
                background: '#000',
                padding: 8,
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}
        />
    );
};

// ---------------------------------------------------------------------------
// Outer modal: portal + chrome + lazy boot.
// ---------------------------------------------------------------------------

export const Terminal: React.FC<TerminalProps> = ({ visible, onClose, sessionId, cwd }) => {
    const [bundle, setBundle] = React.useState<XtermBundle | null>(loadedBundle);
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
                if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number') {
                    return { w: Math.max(360, parsed.w), h: Math.max(240, parsed.h) };
                }
            }
        } catch {}
        return { w: 900, h: 560 };
    });
    const winRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
        if (isFullscreen) return;
        const el = winRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const w = Math.round(entry.contentRect.width);
                const h = Math.round(entry.contentRect.height);
                if (w > 0 && h > 0) {
                    setWinSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
                    try { window.localStorage?.setItem('terminal.winSize', JSON.stringify({ w, h })); } catch {}
                }
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [isFullscreen, visible]);

    if (!visible) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <View
            // @ts-ignore — RN web accepts CSS `position: fixed`. With the
            // portal anchored on document.body, fixed = viewport-anchored.
            style={{
                position: 'fixed' as any,
                top: 0, left: 0, right: 0, bottom: 0,
                zIndex: 99999,
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <Pressable
                onPress={onClose}
                style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                }}
            />
            <div
                ref={winRef}
                style={isFullscreen
                    ? {
                        width: '100%',
                        height: '100%',
                        background: '#000',
                        display: 'flex',
                        flexDirection: 'column',
                    }
                    : {
                        // Non-fullscreen: centered floating window with native
                        // CSS resize handle (bottom-right corner). Min sizes
                        // keep xterm's columns/rows above 1.
                        width: winSize.w,
                        height: winSize.h,
                        minWidth: 360,
                        minHeight: 240,
                        maxWidth: '95vw',
                        maxHeight: '95vh',
                        background: '#000',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 8,
                        overflow: 'hidden',
                        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
                        resize: 'both',
                    }}
            >
                {/* Top chrome */}
                <View
                    style={{
                        height: 40,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 12,
                        backgroundColor: '#1a1a1a',
                        borderBottomWidth: 1,
                        borderBottomColor: '#2a2a2a',
                    }}
                >
                    <Ionicons name="terminal-outline" size={16} color="#e5e5e5" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#e5e5e5', fontSize: 13, fontWeight: '600' }}>
                        终端
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Pressable
                        onPress={toggleFullscreen}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
                    >
                        <Ionicons name={isFullscreen ? 'contract-outline' : 'expand-outline'} size={18} color="#e5e5e5" />
                    </Pressable>
                    <Pressable
                        onPress={onClose}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Close terminal"
                        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Ionicons name="close" size={20} color="#e5e5e5" />
                    </Pressable>
                </View>

                {/* xterm body */}
                <View style={{ flex: 1, backgroundColor: '#000' }}>
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
                        />
                    )}
                </View>
            </div>
        </View>,
        document.body,
    );
};
