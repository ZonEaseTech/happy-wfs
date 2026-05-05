# impl-cli — writeFile / listDirectory RPC handlers (A3 path policy)

## 改动摘要

- 文件：`packages/happy-cli/src/modules/common/registerCommonHandlers.ts`
- 注册位置：紧跟 `'readFile'` handler 之后，仍在 `registerCommonHandlers()` 内。
- 旧版的 hash 校验型 `writeFile`、宽松型 `listDirectory` 已被替换为新签名（详见下方契约）。
- 新增导出函数：`isWritableForSession(absPath: string): boolean`（A3 deny-list 守门）。
- 移除了已不再使用的 `import { createHash } from 'crypto'`，新增 `resolve` 来自 `path`。

## 新增 / 替换的 RPC method 名

| RPC method     | 类型                                | 行为                                           |
| -------------- | ----------------------------------- | ---------------------------------------------- |
| `writeFile`    | `WriteFileRequest -> WriteFileResponse` | base64 写入 + A3 deny + `validatePath` 边界    |
| `listDirectory` | `ListDirRequest -> ListDirResponse` | 单层 readdir + 默认隐藏系统噪音目录            |

## 接口契约（给下游 impl-tree 使用）

```ts
// 请求
interface WriteFileRequest {
    path: string;       // 相对/绝对路径；handler 会 resolve(workingDirectory, path)
    content: string;    // base64 编码
}

// 响应
interface WriteFileResponse {
    success: boolean;
    error?: string;     // 失败原因（deny / validatePath / IO 错）
    bytesWritten?: number;
}

// 请求
interface ListDirRequest {
    path: string;
    hideSystem?: boolean; // 默认 true（即默认过滤系统噪音）
}

// 单条 entry
interface DirEntry {
    name: string;       // 仅文件名，不含目录前缀
    path: string;       // 绝对路径（已经过 resolve）
    type: 'file' | 'dir';
    size?: number;      // 字节
    mtime?: number;     // ms timestamp
}

// 响应
interface ListDirResponse {
    success: boolean;
    entries?: DirEntry[]; // 排序：dir 优先，再按 name 字母序
    error?: string;
}
```

## A3 写白名单（deny-list 摘要）

凡命中下列任一正则的绝对路径都不允许写：

- `/etc/...`
- `/usr/...`
- `/sbin/...`
- `/bin/...`
- `/sys/...`
- `/proc/...`
- `/dev/...`
- `/boot/...`
- `/var/log/...`
- 任意路径下的 `/.docker/config.json`

读不受 deny-list 限制（A3 = 读全盘 / 写半盘）。注：macOS 的 `/System`、`/Library` **未**纳入 deny，
因为 mac dev 机上的真实业务文件经常落在这些根下的符号链接里；本 deny 只针对 Linux/POSIX 系统目录。

## listDirectory 默认过滤的"系统噪音"

`hideSystem !== false` 时（默认开启），过滤名称命中下列任一规则的 entry：

- 精确名：`.git` / `node_modules` / `dist` / `build` / `.cache` / `.DS_Store` / `.next` / `.expo`
- 后缀匹配：`*.lock`（`name.endsWith('.lock')`）

`hideSystem: false` 时不过滤、原样返回。

## 校验

- `cd packages/happy-cli && yarn typecheck` → 0 错误（happy-wire 需先 `yarn build`，本次已执行）。
