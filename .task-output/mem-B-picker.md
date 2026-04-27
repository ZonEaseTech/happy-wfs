# mem-B-picker — Memory Picker 重构为快速管理面板

## 范围

将 `MemoryPickerSheet` 从「只读列表 + 跳转管理页」重构为「sheet 内一站式增删改」面板，
统一覆盖 iOS（`BottomSheetModal`）与 Web/Desktop（右侧抽屉）两条路径。

## 改动文件

- `packages/happy-app/sources/components/MemoryPickerSheet.tsx` — 重写
- `packages/happy-app/sources/text/_default.ts` — 新增 3 个 i18n key

## 行为变更

### Header 行
- 标题 `library-outline + Memory`（沿用）
- 右侧 `+` 按钮 → 调用内置 `handleAdd`（`Modal.prompt` → `createMemory`）
- 删除原跳转管理页的「Manage」链接

### 搜索
- Header 行下方加入搜索框（`BottomSheetTextInput` 在 native，`TextInput` 在 web）
- 完全 client-side filter：`content.toLowerCase().includes(query)`
- 有内容时显示 `close-circle` 一键清空
- 无搜索结果时进入「`memory.noResults`」子状态（区分于「完全没有 memory」的空态）

### 列表行
- 主点击 → `handleEdit`：`Modal.prompt` 默认值 = 当前 content → `updateMemory`
- 右侧 `trash-outline` 按钮 → `Modal.confirm`（destructive）→ `deleteMemory`
- 当 `onSelect` 传入时，行右侧多一个**隐藏的次要操作**：`copy-outline` 小图标（向后兼容
  `AgentInput.handleMemoryPick`，把 memory 内容塞回输入框）
- 只读模式（不传 `onSelect`）下不显示 copy 图标

### 空态
- 完全无 memory：保留原来的 `library-outline` + 描述 + `New memory` 按钮（按钮 → `handleAdd`，不再跳页）
- 有 memory 但搜索过滤为空：新增「`search` icon + `noResults` 文案」子状态

### 数据流
- 增/改/删都做**乐观更新**（`setMemories` 直接 patch 本地数组，避免再次拉远端）
- 错误统一通过 `Modal.alert(common.error, ...)` 提示
- 成功 `hapticsLight()` + `showToast()`

## 共享 PickerContent
- iOS 用 `BottomSheetScrollView`、web 用 `ScrollView`，通过 `Scroller` prop 注入
- 文本输入在 native 用 `BottomSheetTextInput`（`@gorhom/bottom-sheet` 内部 keyboard 管理），
  web 直接 `TextInput`，避免 BottomSheet API 在 web 上不可用
- BottomSheetModal 加 `keyboardBehavior="interactive"` + `keyboardBlurBehavior="restore"`，
  让搜索 / Modal.prompt 的键盘交互不顶飞 sheet
- snapPoints 从 `60%` 提到 `70%`，给搜索框留位置

## 向后兼容

- `MemoryPickerHandle = { present, dismiss }` 不变
- `onSelect` 改为可选 prop。`AgentInput.tsx` 仍传入 `handleMemoryPick`，会以小复制图标的形式
  显示在每行右侧，行为一致（点击复制内容到输入框 + dismiss 由 `handleMemoryPick` 自身控制）
- 注意：旧版 `handlePick` 在选择后会主动 dismiss sheet；新版次要操作沿用 `onSelect` 调用，
  不再自动 dismiss——这是有意为之，因为快速管理面板用户通常希望连续操作，
  AgentInput 的 `handleMemoryPick` 自身 setTimeout focus 输入框、用户可再手动关闭

## i18n 新增 key（仅 `_default.ts`）

```ts
memory.searchPlaceholder = 'Search memories...'
memory.noResults         = 'No matching memories'
memory.insertIntoInput   = 'Insert into input'  // a11y label for copy icon
```

其余翻译走 fallback 到默认（按惯例其他语言后续按需补）。

## 没做的事（边界）

- 没跑 `yarn typecheck` / `yarn install`（按任务边界）
- 没改 `app/(app)/memory.tsx`（独立的 `/memory` 页面仍保留，因为 onSelect=undefined 的全屏入口仍有用途）
- 没改 happy-wire / API 层
