# File-Viewer Archive Upload + Compress Download (Web)

## Summary
Add **压缩下载（仅目录）** and **上传文件（仅目录）** entries to the FileViewerModal right-click menu, mirroring the session-mode bundle download already shipped in `browser.tsx`. Reuses the same flow but pulls it into a reusable helper so the modal can drive it under either session or machine RPC.

## machineBash signature

`packages/happy-app/sources/sync/ops.ts`

```ts
export async function machineBash(
    machineId: string,
    request: SessionBashRequest,
): Promise<SessionBashResponse>;
```

Now mirrors `sessionBash` exactly (request object instead of positional `command, cwd`). RPC timeout = `(request.timeout ?? 30000) + 5000` so long-running archive packs (10 min default) don't get killed mid-stream. All ~30 prior callers (`useEnvironmentVariables`, `useCLIDetection`, `machine/[id].tsx`, `new/index.tsx`, `RepoPickerBar`, `FolderPickerSheet`, `worktreeOps`, `createWorktree`, `createWorkspace`) migrated to `{ command, cwd }` form — mechanical refactor, no behaviour change.

## archiveOps helper

`packages/happy-app/sources/components/fileViewer/archiveOps.ts`

```ts
export async function compressAndDownload(opts: {
    bash: (req: SessionBashRequest) => Promise<SessionBashResponse>;
    readFile: (path: string) => Promise<{ success: boolean; content?: string; error?: string }>;
    cwd: string;
    names: string[];
    onProgress?: (s: string) => void;
    confirmLargeMb?: (sizeMb: number) => Promise<boolean>;
}): Promise<{ success: boolean; error?: string }>;

export function shellQuote(s: string): string;
```

Steps (lifted from `browser.tsx` L231-L320):
1. `du -sk` to estimate size; if >100 MB call `confirmLargeMb`, abort if false.
2. Probe for `zip`, fall back to `tar -czf`.
3. Pack into `/tmp/happy-download-<stamp>.<ext>`.
4. `readFile` archive → base64 → `Blob` → `<a download>` click.
5. `rm -f` tmp file in `finally` (best-effort).

`Platform.OS !== 'web'` short-circuits with `success: false`.

### Usage example (modal)

```ts
const bashFn = (req) => isMachineMode ? machineBash(machineId!, req) : sessionBash(sessionId!, req);

const result = await compressAndDownload({
    bash: bashFn,
    readFile,                // bound RPC closure (already exists in modal)
    cwd: dirname(entry.path),
    names: [entry.name],
    confirmLargeMb: async (sizeMb) =>
        window.confirm(tx('browser.compressLargeWarning', { sizeMb: sizeMb.toFixed(1) })),
});
if (!result.success && result.error) Modal.alert(t('common.error'), result.error);
```

## Context-menu changes

`packages/happy-app/sources/components/FileViewerModal.web.tsx`

`ContextMenu` props extended:

```ts
onCompress: (entry) => void;   // new — directory only
onUpload:   (entry) => void;   // new — directory only
```

Render order is now: **Rename → Download (file only) → 压缩下载 (dir only) → 上传 (dir only) → Delete**.

- `handleCompress` calls `compressAndDownload` with the bound `bashFn`/`readFile` closures, `cwd = dirname(entry.path)`, `names = [entry.name]`, and a `window.confirm`-based `confirmLargeMb` gate.
- `handleUpload` builds an off-DOM `<input type="file" multiple>`, prompts `window.confirm` for files >50 MB and for overwrites (probed via `readFile`), encodes each `File` via a chunked `bytesToBase64` (so big binaries don't blow `String.fromCharCode`'s call stack), then awaits `writeFile` per file. Errors are accumulated and surfaced once via `Modal.alert(uploadFailed, errors.join('\n'))`. Tree refresh always runs.

`bashFn = useCallback((req) => isMachineMode ? machineBash(machineId!, req) : sessionBash(sessionId!, req))` lives next to the existing bound `readFile` / `writeFile` etc. so all RPC dispatch is mode-agnostic in one place.

## i18n keys (11 locales)

Added to `_default.ts` and all 10 translations under `fileViewer.*`:

| key | en | zh-Hans | ja |
|-----|----|---------|----|
| `upload` | Upload | 上传 | アップロード |
| `uploading` | Uploading... | 上传中... | アップロード中... |
| `uploadFailed` | Upload failed | 上传失败 | アップロードに失敗しました |
| `uploadOverwriteConfirm({name})` | "${name}" already exists. Overwrite? | "${name}" 已存在，覆盖？ | 「${name}」は既に存在します。上書きしますか？ |

The compress flow re-uses pre-existing `browser.compressDownload` / `browser.compressLargeWarning` keys (no new compress strings).

## Known limitations

1. **Big files**: upload reads the entire `File` into memory then base64-encodes it (~33 % expansion). Practical ceiling sits around browser/JS heap and the daemon's `writeFile` payload limit; the >50 MB warning is purely advisory and there is no streaming/chunked upload path. Multiple uploads run sequentially, not in parallel — predictable for the user, slow on big batches.
2. **Compress >100 MB warning** is a soft gate only; if the user accepts, packing still happens server-side under the configured RPC timeout (set to 600 s here). Anything that genuinely takes longer than 10 minutes will surface as a packing failure.
3. **Machine-mode bash deny list**: `machineBash` calls daemon-scope `bash` RPC. If the daemon's `HAPPY_DAEMON_ROOT` blocks the chosen `cwd` (or `du`/`zip`/`tar`/`rm` are denied), compress fails with the daemon's stderr — no graceful fallback. Session mode is unaffected.
4. **No upload progress** — the modal shows nothing between `<input>.click()` and `tree.refresh`. Errors surface only after all files are processed. A progress UI is left to follow-up.
5. **Toast helper not wired** — successful compress finishes silently (no toast, since `FileViewerModal.web.tsx` does not currently import any toast helper). Browser's own download chrome is the user signal.
