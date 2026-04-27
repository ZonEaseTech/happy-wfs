# mem-C-visible — surface injected memories + session-mute UI

## Goal

让用户在 session info 看到当前会话注入了哪些 memory，并支持"本会话静音"。

## Changes

### 1. happy-cli — re-introduce memory injection + persist injected IDs

- `packages/happy-cli/src/claude/runClaude.ts`
  - 在 session 创建后调用 `api.listMemories()`，将所有 memory 拼成 `<user_memory>` 块。
  - 用该块作为 `currentAppendSystemPrompt` 的初始值，让首条消息就能携带；后续 user message 通过 `meta.appendSystemPrompt` 仍可覆盖。
  - 通过 `session.updateMetadata(m => ({ ...m, injectedMemoryIds: [...] }))` 写入 metadata（参考同文件 `sessionTitle` 的写法）。
- `packages/happy-cli/src/api/types.ts`
  - 在 `Metadata` 类型尾部新增可选字段 `injectedMemoryIds?: string[]`（CLI 本地类型，未触碰 happy-wire）。
- `packages/happy-cli/src/claude/utils/systemPrompt.ts`
  - 更新过期注释（之前说"不再注入"，现在改回"在 runClaude 启动时注入"）。

### 2. happy-app — chip + modal + 静音

- `packages/happy-app/sources/components/InjectedMemoriesChip.tsx`（新增）
  - Chip 显示 "N memories injected"（以及 muted 数）。
  - 点开后用 `Modal` 列出 memory rows（`listMemories` + 按 ID 过滤）。
  - 每条 row 旁带 `Switch`，切换"本会话静音"。
  - 静音状态通过 mmkv 存储（key `mutedMemoryIds:{sessionId}`）。
- `packages/happy-app/sources/sync/persistence.ts`
  - 新增 `loadMutedMemoryIds(sessionId)` / `saveMutedMemoryIds(sessionId, ids)`。
- `packages/happy-app/sources/sync/storageTypes.ts`
  - 在 `MetadataSchema` 增加 `injectedMemoryIds: z.array(z.string()).optional()`。
- `packages/happy-app/sources/app/(app)/session/[id]/info.tsx`
  - Header 区域底部插入 `<InjectedMemoriesChip />`（在状态行下方）。

### 3. i18n

- `packages/happy-app/sources/text/_default.ts`
  - 新增 `injectedMemories` 命名空间（chip / mutedCount / title / muteHint / empty / mutedBadge / activeBadge）。
- 其他 9 个语言包暂未同步（任务明确说仅 `_default.ts`），未命中时 `t()` 会回落到 key 名。

## 边界遵守

- 未改 Prisma / happy-wire（metadata 仍为 freeform JSON）。
- 未跑 yarn install / typecheck / build。
- 未 git push、未切分支、未改 .git/。
- 未动 .env* / secrets。
- 仅用现有 unistyles theme tokens（surface / surfacePressed / divider / textSecondary / button.secondary.tint）。

## 后续

- 下期 CLI 读取 `mutedMemoryIds:{sessionId}`（或迁移到服务端 per-session 存储），在拼 `<user_memory>` 前过滤。
- 其余 9 个语言包翻译。
