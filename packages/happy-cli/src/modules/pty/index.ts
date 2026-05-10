/**
 * PTY (pseudo-terminal) module — wraps node-pty so the CLI can spawn an
 * interactive shell that the mobile/web app drives over the wire.
 *
 * The protocol (.task-orchestrator/.../protocol.md) splits PTY control across
 * RPC (start / resize / close) and fire-and-forget socket events
 * (pty-input / pty-output / pty-exit). This module owns the RPC-side state:
 * a Map<ptyId, IPty> that the registerCommonHandlers RPC callbacks read and
 * mutate.
 *
 * node-pty has native bindings — if the host failed to build them (no python /
 * no compiler), require() throws synchronously at first call. We swallow that
 * error once and remember the module is unavailable so spawnShell can throw a
 * stable `pty_unavailable` sentinel that the app turns into a friendly toast.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@/ui/logger';

// Minimal subset of node-pty's IPty interface — enough for what we use here.
// We declare it ourselves to avoid pulling in @types/node-pty just for typing
// (node-pty ships its own types but the require() above intentionally bypasses
// the static import path).
export interface IPty {
    pid: number;
    cols: number;
    rows: number;
    process: string;
    // With encoding: null at spawn, node-pty hands raw Buffers to onData so the
    // byte stream stays intact across UTF-8 / ANSI / partial-multibyte boundaries.
    onData(callback: (data: Buffer) => void): { dispose(): void };
    onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
    resize(columns: number, rows: number): void;
    write(data: string): void;
    kill(signal?: string): void;
}

interface NodePtyModule {
    spawn(
        file: string,
        args: string[] | string,
        options: {
            name?: string;
            cols?: number;
            rows?: number;
            cwd?: string;
            env?: NodeJS.ProcessEnv;
            encoding?: string | null;
            useConpty?: boolean;
        }
    ): IPty;
}

/**
 * Sentinel error thrown by spawnShell when node-pty failed to load.
 * The RPC handler in registerCommonHandlers checks `err.message === 'pty_unavailable'`
 * (or err.code) and returns a clean { ok: false, error: 'pty_unavailable' } to the app.
 */
export const PTY_UNAVAILABLE = 'pty_unavailable';

let cachedModule: NodePtyModule | null = null;
let loadAttempted = false;
let loadError: Error | null = null;

function loadNodePty(): NodePtyModule | null {
    if (loadAttempted) {
        return cachedModule;
    }
    loadAttempted = true;
    try {
        // Dynamic require so `pkgroll` / TS bundling doesn't try to resolve the
        // native module at build time, and so the error stays catchable here.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('node-pty') as NodePtyModule;
        cachedModule = mod;
        return mod;
    } catch (err) {
        loadError = err instanceof Error ? err : new Error(String(err));
        logger.debug('[pty] node-pty unavailable:', loadError.message);
        return null;
    }
}

/** In-memory PTY session table. Keys are caller-opaque UUIDs (`ptyId`). */
const ptys = new Map<string, IPty>();

export interface SpawnShellOptions {
    cols: number;
    rows: number;
    cwd?: string;
}

export interface SpawnShellResult {
    ptyId: string;
    term: IPty;
}

/**
 * Spawn an interactive shell PTY. Throws an Error with message `pty_unavailable`
 * if node-pty failed to load (build error, missing native binary, etc).
 */
export function spawnShell(opts: SpawnShellOptions): SpawnShellResult {
    const mod = loadNodePty();
    if (!mod) {
        const err = new Error(PTY_UNAVAILABLE);
        // Surface the underlying load error in debug logs so the operator can
        // diagnose, but the wire-level error stays the stable sentinel.
        if (loadError) {
            logger.debug('[pty] underlying load error:', loadError.stack ?? loadError.message);
        }
        throw err;
    }

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const cwd = opts.cwd ?? process.cwd();

    const term = mod.spawn(shell, [], {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd,
        env: process.env,
        // encoding: null tells node-pty to skip its built-in utf8 decode and
        // hand us raw Buffers from the master fd. The PTY byte stream isn't
        // necessarily valid UTF-8 at any given chunk boundary (claude/vim/etc
        // emit ANSI escape sequences interleaved with user-visible text), and
        // utf8-decoding chunk-by-chunk corrupts multibyte chars: a 3-byte UTF-8
        // sequence for "你" (E4 BD A0) gets decoded to JS char 0x4F60, then
        // Buffer.from(chunk, 'binary') in the consumer truncates that to a
        // single byte 0x60 (backtick). User-visible: every Chinese char from
        // claude rendered as a single ASCII garbage byte. Raw Buffers preserve
        // the byte stream verbatim so the consumer can base64-encode for the
        // wire and xterm.js streaming-decodes correctly on the other end.
        encoding: null as unknown as undefined,
    });

    const ptyId = randomUUID();
    ptys.set(ptyId, term);
    logger.debug(`[pty] spawned ${ptyId} pid=${term.pid} shell=${shell} cols=${opts.cols} rows=${opts.rows} cwd=${cwd}`);
    return { ptyId, term };
}

export function getPty(ptyId: string): IPty | undefined {
    return ptys.get(ptyId);
}

/**
 * Resize an active PTY. No-op if the PTY does not exist (already closed).
 */
export function resizePty(ptyId: string, cols: number, rows: number): boolean {
    const term = ptys.get(ptyId);
    if (!term) return false;
    try {
        term.resize(cols, rows);
        return true;
    } catch (err) {
        logger.debug(`[pty] resize ${ptyId} failed:`, err);
        return false;
    }
}

/**
 * Forward stdin keystrokes to an active PTY.
 *
 * `data` arrives as a JS string from xterm.onData (UTF-16 code units). With
 * spawn(encoding: null), node-pty utf8-encodes the string we pass to write()
 * before forwarding to the master fd, so we hand it the raw utf8 JS string
 * directly — no manual encoding round-trip.
 *
 * (The previous version did Buffer.from(data,'utf8') → toString('binary')
 * to compensate for node-pty's *default* utf8-mode behavior, where write()
 * treats its argument as latin1. With encoding: null that behavior flipped
 * to utf8, and the round-trip then double-encoded the bytes — "你" went out
 * as 12 bytes (`c3a4 c2bd c2a0 ...`) and bash echoed back `ä½ ` mojibake.)
 *
 * Returns false if the PTY does not exist (already closed).
 */
export function writeToPty(ptyId: string, data: string): boolean {
    const term = ptys.get(ptyId);
    if (!term) return false;
    try {
        term.write(data);
        return true;
    } catch (err) {
        logger.debug(`[pty] write ${ptyId} failed:`, err);
        return false;
    }
}

/**
 * Kill a PTY and remove it from the table. Idempotent.
 * `closePty` is also called from the onExit handler in registerCommonHandlers
 * to GC entries when the child exits on its own (e.g. user typed `exit`).
 */
export function closePty(ptyId: string): boolean {
    const term = ptys.get(ptyId);
    if (!term) return false;
    ptys.delete(ptyId);
    try {
        term.kill();
    } catch (err) {
        // Already-dead processes throw; the table cleanup above is the
        // user-visible effect, so swallow.
        logger.debug(`[pty] kill ${ptyId} failed (likely already exited):`, err);
    }
    return true;
}

/** Test/diagnostic helper: clear all PTYs without killing them (used in unit tests). */
export function _resetPtyMapForTests(): void {
    ptys.clear();
}
