import { Platform } from 'react-native';
import type { SessionBashRequest, SessionBashResponse } from '@/sync/ops';

/**
 * POSIX shell single-quote a string. Matches the helper in browser.tsx:
 * wraps the value in single quotes and escapes any embedded single quote
 * via the standard `'\''` trick.
 */
export function shellQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface CompressAndDownloadOptions {
    /** Bound bash RPC — `(req) => sessionBash(sessionId, req)` or machine equivalent. */
    bash: (req: SessionBashRequest) => Promise<SessionBashResponse>;
    /** Bound readFile RPC — returns base64 content on success. */
    readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    /** Working directory the names are relative to (the parent dir). */
    cwd: string;
    /** Names (basenames) under cwd to include in the archive. */
    names: string[];
    /** Optional progress hook for status updates ("Estimating size", "Compressing", etc.). */
    onProgress?: (s: string) => void;
    /**
     * Called when the estimated size exceeds 100 MB. Should return true to
     * proceed, false to abort. If omitted, the warning gate is skipped.
     */
    confirmLargeMb?: (sizeMb: number) => Promise<boolean>;
}

export interface CompressAndDownloadResult {
    success: boolean;
    error?: string;
}

/**
 * Compress one or more files/dirs on the remote and stream the resulting
 * archive back to the browser as a download. Mirrors the flow in
 * browser.tsx (du estimate → zip-or-tar fallback → readFile → blob download
 * → tmp cleanup) but accepts an injected `bash` so callers can run it
 * against either a session or a machine.
 *
 * Web only — the download trigger is `<a download>`-based; on native this
 * resolves with `success: false`.
 */
export async function compressAndDownload(opts: CompressAndDownloadOptions): Promise<CompressAndDownloadResult> {
    const { bash, readFile, cwd, names, onProgress, confirmLargeMb } = opts;

    if (Platform.OS !== 'web') {
        return { success: false, error: 'Download is only supported on web.' };
    }
    if (names.length === 0) {
        return { success: false, error: 'No items selected.' };
    }

    const ts = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;

    let tmpArchive: string | null = null;
    try {
        // 1. Estimate total size with du -sk (KiB) for warning gate.
        onProgress?.('estimating');
        const duArgs = names.map(shellQuote).join(' ');
        const duRes = await bash({
            command: `du -sk -- ${duArgs} | awk '{s+=$1} END {print s}'`,
            cwd,
            timeout: 15000,
        });
        const sizeKb = parseInt((duRes.stdout || '0').trim(), 10) || 0;
        const sizeMb = sizeKb / 1024;
        if (sizeMb > 100 && confirmLargeMb) {
            const ok = await confirmLargeMb(sizeMb);
            if (!ok) return { success: false };
        }

        // 2. Detect zip vs tar. zip is Windows-friendlier; tar is universal on Unix.
        const probe = await bash({
            command: `command -v zip >/dev/null 2>&1 && echo zip || echo tar`,
            cwd,
            timeout: 5000,
        });
        const useZip = (probe.stdout || '').trim() === 'zip';
        const ext = useZip ? 'zip' : 'tar.gz';
        const mime = useZip ? 'application/zip' : 'application/gzip';
        tmpArchive = `/tmp/happy-download-${stamp}.${ext}`;
        const downloadName = `download-${stamp}.${ext}`;

        // 3. Pack into /tmp.
        onProgress?.('compressing');
        const fileArgs = names.map(shellQuote).join(' ');
        const packCmd = useZip
            ? `zip -rqX -- ${shellQuote(tmpArchive)} ${fileArgs}`
            : `tar -czf ${shellQuote(tmpArchive)} -- ${fileArgs}`;
        const packRes = await bash({ command: packCmd, cwd, timeout: 600000 });
        if (!packRes.success) {
            return { success: false, error: packRes.stderr || 'Compression failed' };
        }

        // 4. Read archive back, decode base64, trigger download.
        onProgress?.('reading');
        const readRes = await readFile(tmpArchive);
        if (!readRes.success || !readRes.content) {
            return { success: false, error: readRes.error || 'Failed to read archive' };
        }
        const binary = atob(readRes.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes as BlobPart], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Defer revocation so the browser has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Compression failed' };
    } finally {
        // 5. Cleanup tmp archive (best effort).
        if (tmpArchive) {
            await bash({
                command: `rm -f -- ${shellQuote(tmpArchive)}`,
                cwd: '/tmp',
                timeout: 5000,
            }).catch(() => undefined);
        }
    }
}
