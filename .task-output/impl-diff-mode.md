# Diff Mode for FileViewerModal — Implementation Notes

Branch: `dev-task/impl-diff-mode-20260506-2300b`
Worktree: `/workspace/workspace/wt-impl-diff-mode`

## Goal

Show "HEAD vs current" side-by-side when the user clicks a file from the
git-status page. Browser-mode entries stay in plain editor mode.

## New API: MonacoDiffEditor

```ts
// sources/components/MonacoDiffEditor.tsx        (native — returns null)
// sources/components/MonacoDiffEditor.web.tsx    (web — wraps @monaco-editor/react DiffEditor)

export interface MonacoDiffEditorProps {
    original: string;
    modified: string;
    path: string;                  // drives language inference (reuses inferLanguage from MonacoEditor)
    theme?: 'vs-dark' | 'vs';      // default 'vs-dark'
    height?: number | string;      // default '100%'
    fontSize?: number;             // default 14
}
```

Implementation parity with `MonacoEditor.web.tsx`: lazy-loads
`@monaco-editor/react` in a `React.Suspense`, options pinned to
`{ readOnly: true, minimap: false, automaticLayout: true,
   scrollBeyondLastLine: false, renderSideBySide: true, wordWrap: 'on' }`.

## FileViewerModal props change

```diff
 export interface FileViewerModalProps {
     visible: boolean;
     onClose: () => void;
     sessionId?: string;
     machineId?: string;
     initialFilePath?: string;
     initialCwd?: string;
+    /** 'unstaged' | 'staged' — modal opens diff mode by default and shows the toggle. */
+    initialFromGit?: 'unstaged' | 'staged';
 }
```

Applied identically to `FileViewerModal.tsx` (native fallback) and
`FileViewerModal.web.tsx`.

## Internal state added (web only)

| State                | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `diffMode: boolean`  | Default `initialFromGit !== undefined`. Toggle button flips it.    |
| `originalContent: Map<tabId, string \| null>` | `null` = fetching, `''` = file new at HEAD / git failure, otherwise HEAD blob |
| `diffFetchFailed: Set<tabId>` | Tabs whose `git show` RPC failed entirely — drives "diff unavailable" hint |

Reset whenever the modal is hidden (`visible === false`).

## HEAD fetch flow

When `initialFromGit !== undefined`, after `openFile` creates a tab the modal
fires `fetchHeadVersion(absolutePath, tabId)`:

1. Compute `rel = absolutePath - baseRoot - '/'`.
2. `bashFn({ command: 'git show HEAD:' + shellEscape(rel), cwd: baseRoot, timeout: 10s })`.
3. `exitCode === 0` → store `stdout` as the original.
4. `exitCode !== 0` (file new at HEAD) → store `''` (diff renders all-added).
5. RPC outright failed / threw → record `diffFetchFailed` and store `''`.

Fetch runs unconditionally (not gated on `diffMode`) so the user can toggle
diff on later without a re-fetch.

## Body render switch

```
activeTab && diffMode && originalContent.get(id) != null
  → <MonacoDiffEditor original=... modified=activeTab.content ... />
otherwise
  → existing markdown-preview / MonacoEditor branch (unchanged)
```

## Toolbar toggle

Inserted before the markdown-preview button in the global toolbar. Visible
only when `activeTab && initialFromGit !== undefined`. Icon
`git-compare-outline`, `active` highlight bound to `diffMode`.

## Status-bar hints

| Condition                                          | Shown text                |
| -------------------------------------------------- | ------------------------- |
| `diffMode && originalContent has null/undefined`   | `fileViewer.diffLoading`  |
| `diffMode && diffFetchFailed.has(tab.id)`          | `fileViewer.diffUnavailable` |
| Otherwise                                          | (nothing extra)           |

A new file at HEAD (empty stdout, exit 0 from git) shows the diff with no
extra hint — the all-added view is self-explanatory.

## Caller integration

### `files.tsx` (git-status page)

```diff
+ const [viewerFromGit, setViewerFromGit] = React.useState<'unstaged' | 'staged' | undefined>();

  const handleFilePress = (file, staged?) => {
      ...
      if (isWeb && width >= 768) {
          setViewerPath(absolutePath);
+         setViewerFromGit(staged === true ? 'staged' : staged === false ? 'unstaged' : undefined);
          setShowViewer(true);
          return;
      }
      ...
  };

  <FileViewerModal
      ...
+     initialFromGit={viewerFromGit}
  />
```

`staged` is `true` for staged-section taps, `false` for unstaged-section taps,
`undefined` for search-results / clean-repo file-list taps (no diff anchor).

### `browser.tsx` (cwd browser)

Untouched — does not pass `initialFromGit`, so the modal stays in plain
editor mode and the diff toggle button is hidden.

## i18n keys (added to `_default.ts` + 10 locales)

| Key                          | en source                                        |
| ---------------------------- | ------------------------------------------------ |
| `fileViewer.diff`            | `Diff`                                           |
| `fileViewer.diffLoading`     | `Loading diff…`                                  |
| `fileViewer.diffUnavailable` | `Diff unavailable (HEAD not reachable)`          |

Translations added to: `ca`, `en`, `es`, `it`, `ja`, `pl`, `pt`, `ru`,
`zh-Hans`, `zh-Hant`.

## Verification

- `cd packages/happy-app && yarn typecheck` — diff against pre-change snapshot
  shows zero new errors. All remaining errors are pre-existing
  (`happy-wire` module, `Modal.confirm`, `MonacoEditor fontSize`,
  `tx()` arity, etc.).
- Native fallback (`MonacoDiffEditor.tsx` + `FileViewerModal.tsx`) only
  extends the `FileViewerModalProps` shape; runtime behavior unchanged on iOS/Android.
