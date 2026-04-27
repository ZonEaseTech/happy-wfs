# mem-D-search — search + group-by-source on memory page

## 改动概述

为 `packages/happy-app/sources/app/(app)/memory.tsx` 增加：

1. **搜索框**：列表上方加入 `TextInput`（含搜索图标 + 清除按钮），对 `content` 做客户端子串过滤（大小写不敏感）。
2. **按 source 分组**：手动输入 (`manual`) 在前，对话存入 (`message-pin`) 在后。
3. **Section header**：使用 `surfaceHigh` 背景色的小 header，显示分组名 + 该组数量；空组不渲染。
4. **组内排序**：按 `createdAt desc`（最新在上）。
5. **空状态分情况**：
   - 完全空：保留原 `emptyTitle` / `emptyDescription` + 新增按钮
   - 搜索无匹配：新增 `searchEmpty` + `searchEmptyHint` 文案，搜索框仍可用。
6. **footer 文案**：搜索时显示 `searchResultFooter`（命中数），否则显示原 `listFooter`（总数）。

每条 item 之前显示在右下角的 `sourceLabel · 时间` 简化为只显示时间（source 已上移到 section header）。

## 文件改动

- `packages/happy-app/sources/app/(app)/memory.tsx`：UI 重构。
- `packages/happy-app/sources/text/_default.ts`：新增 `memory.searchPlaceholder` / `searchEmpty` / `searchEmptyHint` / `searchResultFooter` / `groupManual` / `groupMessagePin`。

## 设计取舍

- **未引入 SectionList**：仓库内 `happy-app` 没有现成 SectionList 用例（grep 0 命中），统一沿用 `ScrollView + map` 的现有列表风格（参考 `session/[id]/files.tsx`），避免引入新的列表抽象。
- **只动 `_default.ts`**：按任务要求；其它语言通过 `t()` fallback 行为返回 key 文案。如需补全 10 语言文案，可在后续单独任务处理。
- **theme tokens**：`input.background`、`input.placeholder`、`surfaceHigh`、`divider` 均为现有 unistyles tokens（已在 `theme.ts` 中定义），未自造颜色。
- **不跑 typecheck**：按 BOUNDARY 要求未执行 yarn install / typecheck / build。

## 后续可拓展

- 若需要在 web 上加 ⌘+F 快捷键聚焦搜索框，可挂 `useGlobalKeyboard`。
- 补全 10 个语言翻译（en/ru/pl/es/it/pt/ca/zh-Hans/zh-Hant/ja）。
