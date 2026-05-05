# impl-modal

## 改动文件
- `packages/happy-app/sources/components/FileViewerModal.web.tsx` — 新增 PC bt-style 双面板浮窗。
- `packages/happy-app/sources/components/FileViewerModal.tsx` — 原生 fallback，返回 `null`（移动端不接入）。

## 组件 props
```ts
export interface FileViewerModalProps {
    visible: boolean;
    onClose: () => void;
    sessionId: string;
    initialFilePath?: string;   // 一进来就打开这个文件
    initialCwd?: string;        // 文件树根，缺省 = session.metadata.path
}

import { FileViewerModal } from '@/components/FileViewerModal';
```

## 内部状态机摘要

### 核心 state
- `tabs: Tab[]` — 已打开的文件 tab 集合（每个 tab：`{ id, path, content, original, dirty, language }`）
- `activeTabId: string | null` — 当前激活 tab id
- `loadingPath: string | null` — 正在 read 的文件路径（用于 tabbar 末尾显示 spinner）
- `saving: boolean` — 正在 write 的标志（用于禁用保存按钮 + 显示 spinner）
- `cursor: { line, column }` — 占位字段；当前 hard-code `{0,0}` 走"未知"分支（见下方 gap）

### 派生
- `activeTab = tabs.find(id === activeTabId)`
- `tree = useDirectoryTree(sessionId, rootPath)` — 来自 impl-tree

### 核心动作
| 动作 | 触发 | 逻辑 |
|------|------|------|
| `openFile(path)` | 树点击文件 / `initialFilePath` 自动 | 已开 → setActiveTabId 切换；未开 → `sessionReadFile` → atob + TextDecoder('utf-8') 解码 → 推新 tab + setActive |
| `handleEditorChange(v)` | Monaco onChange | `setTabs` 更新当前 tab 的 `content`，`dirty = (v !== original)` |
| `saveTab(tabId)` | 状态栏 💾 / closeTab→save / requestClose→save 全部 | `sessionWriteFile(sessionId, path, btoa(...))` → 成功置 `original = content; dirty = false`，失败弹 `Modal.alert` |
| `closeTab(tabId)` | tabbar 内单 tab × | 若 `dirty` → `askSaveDiscardCancel` 三选一（save/discard/cancel）；保存失败则不关；切换激活 tab 到相邻 |
| `requestClose()` | 外层 ✕ / Esc / 遮罩点击 | 收集 `tabs.filter(dirty)`，无脏 → 直接 `onClose`；有脏 → `askSaveDiscardCancel`，save 时按顺序保存全部 dirty tab，任一失败则中止关闭 |

### 关闭 / 切换交互细节
- **切 tab**（点 tabbar 标签）：直接切，不弹确认 — VSCode 风格；dirty 状态留在原 tab 不丢
- **关 tab**：dirty 才弹三选一；非 dirty 直接关
- **关 modal**：脏 tab 全部 save / 全部 discard / cancel；任一保存失败立即中止整个关闭（不会继续保存后续脏 tab）
- **遮罩点击 / Esc** 都走 `requestClose`；Esc 监听仅在 `visible=true` 时挂载

### 三选一对话框
`askSaveDiscardCancel(title, message)` — 包了 `Modal.alert` 三个 button（cancel/destructive=discard/default=save），首个被点击的 onPress resolve Promise。再点其它按钮被 `decided` 短路忽略。

## 暴露的 i18n key 列表

> **使用方式**：源码中 `tx('fileViewer.xxx')`（`tx = t as unknown as ...`），未在 `_default.ts` 添加 key。impl-integrate 需要把以下 key 加到所有 10 种语言（en/ru/pl/es/ca/it/pt/ja/zh-Hans/zh-Hant），然后把 `tx` 全部替换为 `t`，删掉 cast。

| Key | 推荐英文 | 用途 |
|-----|---------|------|
| `fileViewer.save` | `Save` | 状态栏保存按钮 + 三选一对话框保存按钮 |
| `fileViewer.discard` | `Discard` | 三选一对话框丢弃按钮 |
| `fileViewer.cancel` | `Cancel` | 三选一对话框取消按钮 |
| `fileViewer.close` | `Close` | 右上 ✕ accessibilityLabel |
| `fileViewer.openFailed` | `Failed to open file.` | sessionReadFile 失败提示 |
| `fileViewer.saveFailed` | `Failed to save file.` | sessionWriteFile 失败提示 |
| `fileViewer.binaryNotSupported` | `Cannot open binary file.` | base64 解码 utf-8 失败提示 |
| `fileViewer.unsavedChangesTitle` | `Unsaved changes` | 三选一对话框标题（关 tab + 关 modal 共用） |
| `fileViewer.unsavedChangesSingle` | `({ name }) => "${name}" has unsaved changes. Save before closing?` | 关单 tab 时的 message |
| `fileViewer.unsavedChangesMulti` | `({ count }) => "${count} files have unsaved changes. Save them all before closing?"` | 关 modal 时的 message |
| `fileViewer.noFileOpen` | `No file open` | 右侧编辑区 placeholder |
| `fileViewer.cursorPosition` | `({ line, column }) => "Ln ${line}, Col ${column}"` | 状态栏行列 — 当前未启用（gap，见下） |
| `fileViewer.cursorPositionUnknown` | `Ln —, Col —` | 状态栏行列占位 |
| `fileViewer.encodingUtf8` | `UTF-8` | 状态栏编码 |
| `fileViewer.languageLabel` | `({ language }) => "Language: ${language}"` | 状态栏语言 |

> 已存在可直接复用：`common.error`（saveFailed/openFailed 的 `Modal.alert` 标题）。

## 已知 gap（impl-integrate 收尾）
1. **没用 `DesktopModalShell`**：spec 里写"用 DesktopModalShell 包装"，但 `DesktopModalShell` 是 expo-router Stack-based 的（设计给 route screen 用，不是 portal modal），强行嵌入会拉一个 `<Stack.Screen options={...}>` 进上下文，且默认 max 1100×880 偏小。我直接用 `View+Pressable` 自绘了一个 ~95% 屏的 overlay，配色 / shadow / radius 跟 DesktopModalShell 对齐。如果要严格统一，impl-integrate 可：
   - 抽一个 `OverlayCard` 组件（共享 backdrop+card 样式），让 DesktopModalShell + FileViewerModal 都用，或
   - 把 max 改大、注入 `<Stack.Screen>` 包装。
2. **Monaco 没有 `onCursorChange` 契约**：impl-monaco 的 `MonacoEditorProps` 只暴露 `value/onChange/path/readOnly/theme/height`，未导出 cursor 回调。状态栏行列我硬编码 `{0,0}` → 走 `fileViewer.cursorPositionUnknown` 分支，显示 `Ln —, Col —`。要做完全：
   - 给 `MonacoEditor.web.tsx` 加 `onCursorChange?: (pos: { line: number; column: number }) => void`，内部绑定 `editor.onDidChangeCursorPosition(e => onCursorChange?.({ line: e.position.lineNumber, column: e.position.column }))`。
   - 然后把 `cursor` 改回 `useState` + `onCursorChange={setCursor}`。
3. **Tabbar tab 切换时不强制 setActive 到 loading 路径**：openFile 期间用户切别的 tab 不会被打断（loading 完后我也只是 push，不会强行抢激活——但实际 setActiveTabId 在 push 之后立即调用，所以会抢；如果不希望抢，需保留 "openIntent path" 标志。当前行为是 push + 立即激活，跟 spec "成功后 setActiveTabId" 一致）。
4. **i18n cast**：`const tx = t as unknown as (key: string, ...args: any[]) => string`。impl-integrate 加完 10 种翻译后，把这两行替换：
   - 删 `const tx = ...`
   - `tx(` → `t(` 全局 replace（仅本文件）。

## 校验
- `cd packages/happy-app && npx tsc --noEmit`
  - 与本任务直接相关的 4 个 error 全部因为上游 cherry-pick 还没合并：
    1. `Cannot find module '@/components/MonacoEditor'`（impl-monaco 待 cherry-pick）
    2. `Cannot find module '@/sync/useDirectoryTree'`（impl-tree 待 cherry-pick）
    3-4. `Parameter 'c'/'n' implicitly has an 'any' type`（DirectoryTreeNode 类型未解析的副作用，cherry-pick 后自动消失）
  - 其余 42 条 error 全部为 pre-existing（happy-wire 模块未 build、_default.ts 缺 i18n key 导致 t() 类型不匹配、本任务无关的 implicit-any）。
- 没有引入新的 type error 触及上游契约之外的部分。
