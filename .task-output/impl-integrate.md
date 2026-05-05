# impl-integrate

## files.tsx 关键变更

| 行号 | 变更 |
|------|------|
| L2 | `useWindowDimensions` 加入 `react-native` import |
| L4 | 新增 `import { FileViewerModal } from '@/components/FileViewerModal'` |
| L97 | `const { width } = useWindowDimensions()` |
| L99–103 | 新增 PC 文件查看器状态：`showViewer` / `viewerPath` |
| L394–426 | `handleFilePress` 加 PC 分支：`isWeb && width >= 768 && !embedded` 时 `setViewerPath(absolutePath); setShowViewer(true); return;` —— 跳过 `router.push`；其余分支保持原 `/session/${id}/file?staged=1` 与 `/edit` 路由不变 |
| L1089–1098 | JSX 末尾条件渲染 `<FileViewerModal visible onClose sessionId initialFilePath={viewerPath} initialCwd={repoBaseCwd} />` |

> **注**：上游 `impl-modal` 尚未合并到本 worktree，故 tsc 仍会报 `Cannot find module '@/components/FileViewerModal'`。集成阶段 cherry-pick `impl-modal` 之后该错误自动消失。

## 新增 i18n key 列表（采用 impl-modal 输出契约）

所有 key 都加在每个 i18n 文件的顶层 `fileViewer:` 区块下，紧跟在已有 `files:` 区块之后、`claudeConfig:` 之前。

| Key | 类型 / 签名 |
|-----|-------------|
| `fileViewer.save` | `string` |
| `fileViewer.discard` | `string` |
| `fileViewer.cancel` | `string` |
| `fileViewer.close` | `string` |
| `fileViewer.openFailed` | `string` |
| `fileViewer.saveFailed` | `string` |
| `fileViewer.binaryNotSupported` | `string` |
| `fileViewer.unsavedChangesTitle` | `string` |
| `fileViewer.unsavedChangesSingle` | `({ name: string }) => string` |
| `fileViewer.unsavedChangesMulti` | `({ count: number }) => string` |
| `fileViewer.noFileOpen` | `string` |
| `fileViewer.cursorPosition` | `({ line: number; column: number }) => string` |
| `fileViewer.cursorPositionUnknown` | `string` |
| `fileViewer.encodingUtf8` | `string` |
| `fileViewer.languageLabel` | `({ language: string }) => string` |

> 与 task default 集合（title/saveAll/closeAll/loading/saveError/readError 等）的差异：以 impl-modal 实际使用的 key 为准，task `default` 集合作为兜底未启用。`encoding` 改为 `encodingUtf8` 静态串、`language` 改为 `languageLabel({language})`、`cursorPosition` 参数名 `column` 取代 `col`、`unsavedChanges*` 拆分为 single / multi 两套 message。

## 11 种语言完成情况

| 语言 | 文件 | 状态 | 风格备注 |
|------|------|------|---------|
| `default` | `sources/text/_default.ts` | ✅ | 英文兜底 |
| en | `translations/en.ts` | ✅ | 同 default |
| zh-Hans | `translations/zh-Hans.ts` | ✅ | 「保存 / 放弃 / 取消 / 关闭」；行/列用「第 N 行，第 N 列」 |
| zh-Hant | `translations/zh-Hant.ts` | ✅ | 「儲存 / 捨棄 / 取消 / 關閉」；列用「欄」 |
| ja | `translations/ja.ts` | ✅ | 「保存 / 破棄 / キャンセル / 閉じる」；行/列用「N 行、N 列」 |
| ru | `translations/ru.ts` | ✅ | 「Сохранить / Отменить / Отмена / Закрыть」 |
| pl | `translations/pl.ts` | ✅ | 「Zapisz / Odrzuć / Anuluj / Zamknij」 |
| es | `translations/es.ts` | ✅ | 「Guardar / Descartar / Cancelar / Cerrar」 |
| ca | `translations/ca.ts` | ✅ | 「Desa / Descarta / Cancel·la / Tanca」 |
| it | `translations/it.ts` | ✅ | 「Salva / Elimina / Annulla / Chiudi」 |
| pt | `translations/pt.ts` | ✅ | 「Salvar / Descartar / Cancelar / Fechar」 |

> **可能漏掉的点**：无。每个文件 `grep -c "fileViewer:"` 返回 2（旧 `common.fileViewer = 'File Viewer'` + 新增的顶层 `fileViewer` 区块），均通过校验。各语言键完全对齐 default 结构，符合 `TranslationStructure` 类型推导。

## 类型完整性

- `_default.ts` 末尾 `} as const` 已存在；新增 fileViewer 区块自然纳入 `Translations = typeof en` 推导
- 10 个语言文件的 fileViewer 区块字符串/函数签名与 default 完全一致 → 满足 `TranslationStructure` 中 `string | (...args) => string` 的递归约束
- 没有引入额外 `as const` 或类型补全（不需要）

## 校验结果（`yarn typecheck`）

- 与本任务相关：仅一条 `Cannot find module '@/components/FileViewerModal'`（上游 impl-modal cherry-pick 后消失）
- 其余 ~50 条错误均为 pre-existing（happy-wire 未 build / 既有 t() key 类型缺失 / 既有 implicit-any），非本任务引入
- 所有新加的 `fileViewer.*` key 不产生类型错误
