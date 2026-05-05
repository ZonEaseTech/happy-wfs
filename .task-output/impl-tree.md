# impl-tree — happy-app ops + useDirectoryTree hook

## 改动文件

- `packages/happy-app/sources/sync/ops.ts` — 替换 writeFile / listDirectory 的 session+machine 版本以匹配上游新契约（移除旧的 `expectedHash` / `hash` / `DirectoryEntry`，引入 `bytesWritten` / `DirEntry`）。
- `packages/happy-app/sources/sync/useDirectoryTree.ts` — 新增懒加载目录树 hook。
- `packages/happy-app/sources/app/(app)/settings/machine-edit.tsx`
- `packages/happy-app/sources/app/(app)/settings/machine-browser.tsx`
- `packages/happy-app/sources/app/(app)/session/[id]/edit.tsx`
- `packages/happy-app/sources/app/(app)/session/[id]/browser.tsx` — 上述 4 个调用方做最小补丁（去掉 `expectedHash` 参数 / `response.hash` 分支、把 `'directory'` 字面量改为 `'dir'`、本地 `DirectoryEntry` 字段对齐 `path`/`mtime`）。

## ops 签名（最终）

```ts
// 通用类型
interface SessionWriteFileRequest { path: string; content: string; }     // content = base64
interface SessionWriteFileResponse { success: boolean; error?: string; bytesWritten?: number; }

interface SessionListDirectoryRequest { path: string; hideSystem?: boolean; } // hideSystem 默认 true
interface DirEntry {
    name: string;
    path: string;             // 绝对路径
    type: 'file' | 'dir';
    size?: number;
    mtime?: number;
}
interface SessionListDirectoryResponse { success: boolean; entries?: DirEntry[]; error?: string; }

// session-scoped（按 session.metadata.path 做 root）
function sessionWriteFile(sessionId: string, path: string, content: string): Promise<SessionWriteFileResponse>;
function sessionListDirectory(sessionId: string, path: string, hideSystem?: boolean): Promise<SessionListDirectoryResponse>;

// machine-scoped（按 HAPPY_DAEMON_ROOT 做 root；同一 RPC handler）
function machineWriteFile(machineId: string, path: string, content: string): Promise<SessionWriteFileResponse>;
function machineListDirectory(machineId: string, path: string, hideSystem?: boolean): Promise<SessionListDirectoryResponse>;
```

> 失败模式：catch 包装为 `{ success: false, error: '...' }`，调用方按 `response.success` 分支即可，不需要 try/catch。

`DirEntry` 已从 `ops.ts` 中 `export type` 出来，可直接 `import type { DirEntry } from '@/sync/ops'`。

## useDirectoryTree hook

文件：`packages/happy-app/sources/sync/useDirectoryTree.ts`

### API

```ts
import { useDirectoryTree } from '@/sync/useDirectoryTree';

const {
    tree,        // DirectoryTreeNode[]
    expand,      // (path: string) => Promise<void>
    collapse,    // (path: string) => void
    refresh,     // (path: string) => Promise<void>  — 强制重新拉取该路径
    isLoading,   // Map<string, boolean>             — 仅包含正在加载的路径
    errors,      // Map<string, string>              — 仅包含最近失败的路径
} = useDirectoryTree(sessionId, initialPath);
```

```ts
interface DirectoryTreeNode {
    entry: DirEntry;                  // 来自 sessionListDirectory
    children?: DirectoryTreeNode[];   // 仅当 expanded 且子目录已加载时存在
    expanded: boolean;                // 该节点当前是否展开
}
```

### 行为约定

- mount + `sessionId/initialPath` 变化时自动调用 `sessionListDirectory(sessionId, initialPath)`（默认 `hideSystem=true`）。
- `expand(path)`：先把 path 加入展开集合；若 `entries` map 里没有该 path 的 children，则 await `sessionListDirectory(sessionId, path)`；已缓存则直接展开（无网络）。
- `collapse(path)`：仅从展开集合移除——保留缓存，下次 expand 不会重新拉。
- `refresh(path)`：强制重新拉取并覆盖该路径的缓存（不改动展开状态）。
- 失败：`errors.set(path, message)`；`tree` 不会包含未加载的子节点，UI 应基于 `errors` + `isLoading` 渲染错误/loading 占位。
- `tree` 是基于 `entries` + `expanded` 的派生 memo，不是独立状态。

## 给 impl-modal 的使用示例

```tsx
import * as React from 'react';
import { Pressable, View, ActivityIndicator, Text } from 'react-native';
import { useDirectoryTree, type DirectoryTreeNode } from '@/sync/useDirectoryTree';
import { Ionicons } from '@expo/vector-icons';
import { FileIcon } from '@/components/FileIcon';

export function FileTreePanel({ sessionId, rootPath }: { sessionId: string; rootPath: string }) {
    const { tree, expand, collapse, isLoading, errors } = useDirectoryTree(sessionId, rootPath);

    const renderNode = (node: DirectoryTreeNode, depth: number): React.ReactNode => {
        const { entry, expanded, children } = node;
        const isDir = entry.type === 'dir';
        const loading = isLoading.get(entry.path) ?? false;
        const error = errors.get(entry.path);

        return (
            <React.Fragment key={entry.path}>
                <Pressable
                    onPress={() => {
                        if (!isDir) return;
                        if (expanded) collapse(entry.path);
                        else void expand(entry.path);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: depth * 16 }}
                >
                    {isDir ? (
                        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} />
                    ) : <View style={{ width: 14 }} />}
                    {isDir
                        ? <Ionicons name="folder" size={20} color="#007AFF" />
                        : <FileIcon fileName={entry.name} size={20} />}
                    <Text style={{ marginLeft: 6 }}>{entry.name}</Text>
                    {loading && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
                </Pressable>
                {error && (
                    <Text style={{ color: 'red', paddingLeft: (depth + 1) * 16 }}>{error}</Text>
                )}
                {expanded && children?.map(child => renderNode(child, depth + 1))}
            </React.Fragment>
        );
    };

    return <View>{tree.map(node => renderNode(node, 0))}</View>;
}
```

要点：
- `tree` 顶层即 `initialPath` 的直接 children；`initialPath` 节点本身由调用方负责画 header / 不画。
- `expand` 是异步——首次展开会出现短暂的 loading（`isLoading.get(entry.path) === true`），UI 可在该 entry 行末尾画 `ActivityIndicator`。
- `errors` 用于在该节点行下方显示错误占位；下次 `expand` / `refresh` 会清空。
- `hideSystem=true` 是 hook 内部约定（直接调 `sessionListDirectory(sessionId, path)`），上游已自动过滤 `.git` / `node_modules` / `dist` 等噪音；当前 hook 未暴露切换开关——若 modal 需要展示完整树，再扩 hook 加 option。

## 校验

- `cd packages/happy-app && node ../../node_modules/typescript/bin/tsc --noEmit` — 仅有 pre-existing i18n key 缺失 / `_theme` 隐式 any 等不相关错误；与本次改动相关的 `ops.ts` / `useDirectoryTree.ts` / 4 个被补丁的调用方均无新增 error。
- 无新增 `DirEntry` / `bytesWritten` / `'directory'` / `expectedHash` / `hash` 相关 type error。

## 调用方补丁概要

| 文件 | 改动 |
|------|------|
| `machine-edit.tsx` | 删除 `expectedHash` 计算与传递、删除 `if (response.hash) setOriginalHash(response.hash)` 分支；保存后统一用本地 SHA-256 重算 hash 跟踪。 |
| `edit.tsx` | 同上（去掉 `originalHash.toLowerCase()` 第 4 个参数 + `response.hash` 分支）。 |
| `browser.tsx` | 本地 `DirectoryEntry` 接口对齐 `DirEntry`（`type: 'file'\|'dir'`、加 `path`、`modified` 改 `mtime`）；所有 `entry.type === 'directory'` → `'dir'`。 |
| `machine-browser.tsx` | 本地 `DirectoryEntry` 同步对齐；`'directory'` → `'dir'`；`machineWriteFile(..., '', null)` → `machineWriteFile(..., '')`（去掉旧的 `expectedHash` 实参）。 |

> 这些调用方本就紧贴旧 RPC 契约，新契约下去掉 hash/expectedHash 写入路径不再做乐观并发——新文件创建走的是 `bytesWritten`，调用方通过本地 SHA-256 重算保留 hash 用于后续 dirty 检测。
