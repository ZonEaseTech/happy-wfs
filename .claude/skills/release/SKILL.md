---
name: release
description: Use when the user wants to cut a new release of happy-ai — CLI to npm, mobile App + Docker via git tag, or the full combo.
---

# Happy AI 发布流程

## Overview

发版前先询问用户本次发哪条线，只展开对应 checklist。三条线版本号**互相独立**：CLI 可单独发；App 与 Docker 绑定同一 tag；全套时必须**先 A 后 B**，否则 App tag 会漏掉 CLI 的 version bump commit。

**不要默认全发**。

## 三条发布线

| 发布对象 | 版本源 | 触发方式 | Workflow |
|---|---|---|---|
| happy-ai-cli（npm） | `packages/happy-cli/package.json` | 手动 `workflow_dispatch` | `cli-publish.yml` |
| 手机 App（APK/AAB/IPA） | git tag 去掉 `v` 前缀 | 推 tag `v*` | `release.yml` |
| Docker 镜像（server/webapp/voice/docs） | git tag | 推 tag `v*`（同上） | `docker-publish.yml` |
| iOS App Store 提审 | 手动输入 | 手动 `workflow_dispatch` | `release.yml`（submit-ios 分支） |

## 入口：问用户本次发什么

用 AskUserQuestion 或 options，让用户从以下选择：

- **A. 只发 CLI**（改动只动了 `packages/happy-cli/`）
- **B. 发 App + Docker**（改动涉及 happy-app / happy-server / happy-voice / happy-docs）
- **C. 全套**（A + B）
- **D. 只提 iOS App Store**（之前 tag 已发过，现在要提审）

根据选择跳到对应小节，**只展开该分支的 checklist**，用 TodoWrite 建 todo 跟踪。

---

## 共用前置检查（所有分支开头都跑）

```bash
git status           # 工作区必须干净
git branch --show-current  # 应在 main
git pull origin main # 拉最新
```

如果工作区不干净，询问用户是否先 commit 或 stash，不要自作主张。

---

## 分支 A：只发 CLI

### A1. 确认改动范围

```bash
git log origin/main~5..origin/main --stat -- packages/happy-cli/
```

向用户展示最近几个 commit 涉及的文件，确认是否仅 CLI 改动。如果混入了 App/Server 改动但用户只想发 CLI，**警告用户**——version bump commit 会混入 main，可能让后续 App tag release notes 变乱。

### A2. 本地 typecheck

```bash
cd packages/happy-cli && yarn build
```

失败就停下，不要继续发。

### A3. 决定 version bump 类型

先跑这段脚本，把当前版本和三个候选版本一次性算出来：

```bash
node -e "
const v = require('./packages/happy-cli/package.json').version.split('.').map(Number);
console.log('当前: ' + v.join('.'));
console.log('patch → ' + v[0] + '.' + v[1] + '.' + (v[2]+1));
console.log('minor → ' + v[0] + '.' + (v[1]+1) + '.0');
console.log('major → ' + (v[0]+1) + '.0.0');
"
```

再扫描自上次 CLI 发布以来的 commit 类型，给出建议的 bump 类型：

```bash
LAST_CLI=$(git log --oneline --grep='^release: happy-ai-cli' | head -1 | awk '{print $1}')
# 首次发布或找不到历史 CLI release commit 时，回退看最近 30 条 CLI 相关 commit
RANGE="${LAST_CLI:+${LAST_CLI}..HEAD}"
git log ${RANGE:--30} --oneline --no-merges -- packages/happy-cli packages/happy-wire
```

判断规则：

- 只有 `fix(...)` / `chore(...)` / `docs(...)` → 建议 **patch**
- 出现 `feat(...)` → 建议 **minor**
- commit 里带 `BREAKING CHANGE` 或 `!:` → 建议 **major**

把"当前版本 / 三个候选 / 建议 bump 类型 / 判断依据"一起展示给用户，让用户确认或覆盖。

### A4. ⏸ 手动触发 workflow

给用户这条指令：

> 请打开 <https://github.com/hitosea/happy-ai/actions/workflows/cli-publish.yml> → 点 **Run workflow** → `Version to publish` 填 `{用户选的版本}` → `Dry run` 保持 `false`（默认） → 点绿色 Run workflow。完成后告诉我"已触发"。

**等用户确认。不要继续。**

### A5. 监控 + 收尾

告知用户 workflow 会自动：bump 版本 → 跑测试 → `npm publish` → 提交 `release: happy-ai-cli v{X.Y.Z}` 回 main。

等用户确认 workflow 成功后：

```bash
git pull origin main   # 拉回 CI 提交的 version bump
node -p "require('./packages/happy-cli/package.json').version"  # 核对新版本号
```

向用户展示新版本号，确认本次发版完成。

---

## 分支 B：发 App + Docker

### B1. 确认上一个 tag + 累积改动

```bash
git tag --sort=-creatordate | grep '^v[0-9]' | head -5    # 最近几个 vX.Y.Z 格式 tag
LAST=$(git tag --sort=-creatordate | grep '^v[0-9]' | head -1)
git log ${LAST}..HEAD --oneline --no-merges
```

向用户展示累积 commit 列表，让用户决定是否值得发版。如果没什么用户可感知的变化，劝退。

### B2. 决定新 tag 版本号

先跑这段脚本，把最近的 tag 和三个候选版本一次性算出来：

```bash
LAST=$(git tag --sort=-creatordate | grep '^v[0-9]' | head -1)
node -e "
const v = '$LAST'.replace(/^v/, '').split('.').map(Number);
console.log('当前: $LAST');
console.log('patch → v' + v[0] + '.' + v[1] + '.' + (v[2]+1));
console.log('minor → v' + v[0] + '.' + (v[1]+1) + '.0');
console.log('major → v' + (v[0]+1) + '.0.0');
"
```

再基于 B1 已列出的 commit 判断建议 bump 类型：

- 只有 `fix(...)` / `chore(...)` / `docs(...)` → 建议 **patch**
- 出现 `feat(...)` → 建议 **minor**
- commit 里带 `BREAKING CHANGE` 或 `!:` → 建议 **major**

把"当前 tag / 三个候选 / 建议 bump 类型 / 判断依据"一起展示给用户，让用户确认或覆盖。

### B3. 更新 CHANGELOG + README + docs（6 个文件）

| # | 文件 | 方式 |
|---|------|------|
| 1 | `packages/happy-app/CHANGELOG.md` | 手写新版本条目 |
| 2 | `packages/happy-app/sources/changelog/changelog.json` | 运行脚本自动生成 |
| 3 | `README.md` | 合并新功能进已有章节 |
| 4 | `README.zh-CN.md` | 合并新功能进已有章节 |
| 5 | `docs/changes-from-happy.md` | 合并新功能进已有章节 |
| 6 | `docs/changes-from-happy.zh-CN.md` | 合并新功能进已有章节 |

先把 B1 列出的 commit 按功能领域分类，向用户展示分类结果，**等用户确认**后再开始写入。

#### B3.1 编写 CHANGELOG.md

文件：`packages/happy-app/CHANGELOG.md`

在文件顶部（`# Changelog` 之后、上一版本之前）插入新版本条目。

格式要求（参考已有版本风格）：

- 标题：`## Version N - YYYY-MM-DD`（N 是顺序号，不是 tag 名；日期是今天）
- 一句话摘要（英文）
- Bullet points，每条以功能领域开头，简洁描述用户可感知的变化
- 不写技术实现细节，面向用户

先把草稿展示给用户确认，再写入文件。

#### B3.2 生成 changelog.json

```bash
cd packages/happy-app
npx tsx sources/scripts/parseChangelog.ts
```

自动生成 `packages/happy-app/sources/changelog/changelog.json`。核对 `latestVersion` 已更新。

#### B3.3 更新 README（中英文）

文件：`README.md` + `README.zh-CN.md`

**关键原则**：这两个文件展示的是「Happy AI 相比 Happy 的完整功能」，**不按版本分**。

- 全新功能领域加为新的独立章节（不加版本标签）
- 同步更新 "Why Happy AI" 亮点列表（带 emoji 的那段）
- 中英文内容保持一致

#### B3.4 更新 changes-from-happy 文档（中英文）

文件：`docs/changes-from-happy.md` + `docs/changes-from-happy.zh-CN.md`

**关键原则**：同样**不按版本分**，是 Happy AI 相对 Happy 的完整变更记录。

- 更新顶部 TL;DR 概览表格
- 将新功能合并进已有章节
- 全新功能领域加为独立章节（不加版本标签）
- 更新 bug 修复计数
- 中英文内容保持一致

#### B3 注意事项

- CHANGELOG.md 是唯一按版本记录的文件，其余 4 个 md 文件都是功能总览
- 中英文文档结构和内容必须对齐
- 版本号中提到的依赖版本（如 Codex vX.Y.Z）需确认是最新的

### B4. 提交 changelog 改动并推送

```bash
git add packages/happy-app/CHANGELOG.md packages/happy-app/sources/changelog/changelog.json README.md README.zh-CN.md docs/changes-from-happy.md docs/changes-from-happy.zh-CN.md
git commit -m "docs: changelog for {新版本号}"
git push origin main
```

### B5. 打 tag 并推送

**注意**：下面命令里的 `{版本号}` 是占位符，必须替换成 B2 中用户确认的实际 tag（形如 `v2.1.0`）。**不要**原样执行。

```bash
VERSION={版本号}   # 例如 VERSION=v2.1.0
git tag $VERSION
git push origin $VERSION
```

**推送 tag 会同时触发 `release.yml` 和 `docker-publish.yml` 两条流水线**，无法撤销。推送前再次跟用户确认版本号。

### B6. ⏸ 监控构建

给用户：

> 流水线正在跑：<https://github.com/hitosea/happy-ai/actions>
> - `Release`：~20-30 分钟，并行构建 Android APK/AAB + iOS IPA，完成后自动建 GitHub Release 挂载三个安装包
> - `Docker Publish`：~10-20 分钟，推 4 个镜像到 Docker Hub `kuaifan/*`
>
> 完成后告诉我结果，或告诉我某条失败了。

**等用户确认。**

### B7. 校验 Release 页

告知用户检查 <https://github.com/hitosea/happy-ai/releases/tag/{新版本号}>：

- 有 3 个附件（APK/AAB/IPA）
- Release notes 自动生成合理

---

## 分支 C：全套

**顺序敏感**——必须先 A 再 B，不能并行：

1. 走完分支 A 全部步骤（包括 B1 前的 `git pull` 拿到 CI 推回的版本号 commit）
2. 再走分支 B

否则 CLI 的 version bump commit 会不在 App tag 里，用户用 App 时看到的 release notes 会缺这条。

---

## 分支 D：只提 iOS App Store

前提：对应 tag 的 `release.yml` 已跑完，IPA 已在 GitHub Release 里。

### D1. ⏸ 手动触发

> 请打开 <https://github.com/hitosea/happy-ai/actions/workflows/release.yml> → **Run workflow** → `version` 填要提审的版本号（不带 `v` 前缀，如 `2.0.4`） → Run。

该触发只跑 `submit-ios` 任务：重新本地构建 IPA → 通过 ASC API 提审。

**等用户确认。**

---

## 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `cli-publish.yml` 报 `npm whoami` 失败 | `NPM_TOKEN` secret 过期 | 让用户到仓库 Settings → Secrets 更新 |
| Tag 已推但 Release 页没出现 | iOS/Android 构建失败，`needs` 卡住 | 看 Actions 日志，修复后 delete + retag |
| Docker 镜像没推成功 | Docker Hub token 过期 | `DOCKERHUB_TOKEN` secret 更新 |
| `git push origin v2.0.4` 失败：already exists | 该版本号已用过 | 确认是误操作还是版本冲突；选新号或 `git push origin :refs/tags/v2.0.4` 先删再推（慎用，若已触发过 workflow 会重复发布） |

## 不要做的事

- 不要手动改 `packages/happy-cli/package.json` 的 version——`cli-publish.yml` 会自动 bump
- 不要手动改 `app.config.js` 里的 `version` 默认值——它读的是 `APP_VERSION` 环境变量（从 tag 名注入）
- 不要在 tag 已推送后再去改那个 commit——tag 指针会不匹配
