# impl-app-ide — IDE-style FileViewerModal

worktree: `/workspace/workspace/wt-impl-app-ide`
branch: `dev-task/impl-app-ide-20260505-1500`

## 1. New ops in `sync/ops.ts`

All five wrap `apiSocket.sessionRPC` and follow the existing `sessionReadFile` /
`sessionWriteFile` error-shape convention (`{ success, error? }`):

```ts
sessionRename(sessionId, from, to)            // RPC method "rename"   { from, to } → { success, error? }
sessionDeleteFile(sessionId, path)            // RPC method "deleteFile"      { path } → { success, error? }
sessionDeleteDirectory(sessionId, path)       // RPC method "deleteDirectory" { path } → { success, error? }
sessionCreateFile(sessionId, path, content?)  // RPC method "createFile"      { path, content? } → { success, error? }
sessionCreateDirectory(sessionId, path)       // RPC method "createDirectory" { path } → { success, error? }
```

`content` is omitted from the RPC payload entirely when caller passes
`undefined`, so older daemons that treat "missing content" as "create empty"
keep working; passing `''` (empty string) explicitly creates an empty file.

## 2. MonacoEditor `onMount` — API note

Monaco's React wrapper exposes `onMount: (editor, monaco) => void`. We surface
only the first argument and type it as `unknown` so RN's TS graph doesn't pull
in `monaco-editor` types (the package is dynamically `React.lazy()` imported
on web, never on native).

The IDE toolbar captures the editor in a ref and runs built-in actions by
their command id:

| Toolbar button | Action id |
|---|---|
| Find           | `actions.find` |
| Replace        | `editor.action.startFindReplaceAction` |
| Go to Line     | `editor.action.gotoLine` |

Both `MonacoEditor.web.tsx` and `MonacoEditor.tsx` (native shim) get the new
`onMount?` prop so consumers don't have to platform-guard. Native ignores it.

## 3. Right-click menu — implementation choice

Picked a **custom inline floating menu** rendered with `position: fixed` at
`(clientX, clientY)`, *not* `ActionMenuModal`.

Why:
- `ActionMenuModal` is an iOS-style bottom sheet — wrong affordance for a
  desktop IDE right-click.
- The menu lives inside the FileViewerModal root, with `zIndex: 100000` so it
  sits above the modal's own `zIndex: 99999`.
- A document-level `click`/`contextmenu` listener (deferred one tick to avoid
  immediate self-dismiss) closes it.
- Item order is: Rename, Download (files only), Delete (destructive).

`onContextMenu` is attached as a DOM prop on the entry `Pressable` — RN-web
forwards arbitrary HTML props through, so `e.preventDefault()` works to
suppress the browser's native menu.

## 4. UI structure (final layout, top → bottom)

```
┌──────────────────────────────────────────────────────────┐
│ B: Save • SaveAll • Refresh │ Find • Replace • GotoLine  ✕│  ← global toolbar
├──────────────────────────────────────────────────────────┤
│ Tab1 ● │ Tab2 │ ... (scrolls horizontally)                │  ← tabbar (close moved up)
├──────────────────────┬───────────────────────────────────┤
│ A: ↑ ⟳ + 🔍          │                                   │
│ ─────────            │                                   │
│ [search input]       │   Monaco editor                   │
│ ▾ src                │                                   │
│   • index.ts         │                                   │
│   ...                │                                   │
├──────────────────────┴───────────────────────────────────┤
│ Ln —, Col —    UTF-8    Language: typescript          ⏳ │  ← statusbar
└──────────────────────────────────────────────────────────┘
```

Tree-toolbar buttons:
- `↑ arrow-up` → `setRootPath(dirname(rootPath))`
- `⟳ refresh` → `tree.refresh(rootPath)`
- `+ add` → `Modal.alert` 3-button (Cancel / New folder / New file) → `Modal.prompt` for name → `sessionCreate{File,Directory}` → refresh
- `🔍 search` → toggles inline `TextInput`; client-side filters top-level entries by `name.toLowerCase().includes(q)`. **Not recursive — matches spec.**

Global-toolbar buttons:
- 💾 Save (active tab; disabled when not dirty)
- 📥 Save All (any dirty)
- 🔄 Refresh (re-reads active tab from disk; prompts on dirty)
- 🔍 Find / 🔁 Replace / 📍 Go to Line (route to monaco actions)
- ✕ Close (was on the tabbar before)

## 5. i18n key set added (under existing `fileViewer.*` block)

22 new keys, added to `_default.ts` + all 10 translation files (en, zh-Hans,
zh-Hant, ja, ru, pl, es, ca, it, pt):

| Key | Type |
|---|---|
| `saveAll` | string |
| `refresh` | string |
| `find` | string |
| `replace` | string |
| `gotoLine` | string |
| `upOneLevel` | string |
| `refreshTree` | string |
| `newItem` | string |
| `newFile` | string |
| `newFolder` | string |
| `search` | string |
| `rename` | string |
| `download` | string |
| `deleteFile` | string |
| `deleteFileConfirm` | `({ name }) => string` |
| `deleteDir` | string |
| `deleteDirConfirm` | `({ name }) => string` |
| `renamePrompt` | string |
| `newFilePrompt` | string |
| `newFolderPrompt` | string |
| `fileExists` | string |
| `dirExists` | string |

Both `*Confirm` strings include "irreversible" wording per spec.

## 6. Verification

`yarn typecheck` was executed (after `yarn install`). Zero errors in changed
files (`FileViewerModal.web.tsx`, `MonacoEditor.tsx`, `MonacoEditor.web.tsx`,
`sync/ops.ts`, `text/_default.ts`, all 10 translation files). Remaining
errors in the repo are pre-existing happy-wire module resolution and unrelated
implicit-any / i18n-key drift in `browser.tsx` / `NewSessionWizard.tsx` etc.

Open follow-ups (not in scope for this task):
- The 5 RPC handlers must land in happy-cli (impl-cli-ops). Until then the new
  buttons return `success: false` from the RPC layer and surface as a Modal
  alert — graceful degradation.
- `MonacoEditor` still doesn't expose cursor/selection events, so the
  statusbar's `Ln —, Col —` placeholder is unchanged. Add `onCursorChange` in
  a follow-up if the embed's cursor reporting becomes a priority.
