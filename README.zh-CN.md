<div align="center"><img src="/.github/logotype-dark.png" width="400" title="Happy AI" alt="Happy AI"/></div>

<h1 align="center">
  Claude Code、Codex 和 Gemini 的移动端和 Web 客户端
</h1>

<h4 align="center">
随时随地使用 Claude Code、Codex 或 Gemini，端到端加密。
</h4>

<div align="center">

[🖥️ **Web 应用**](https://app-happy.zonease.org/) • [📱 **TestFlight**](https://testflight.apple.com/join/XyjvbhXe) • [📦 **APK 下载**](https://github.com/ZonEaseTech/happy-wfs/releases/latest) • [📚 **文档**](docs/README.md) • [🇬🇧 **English**](README.md)

</div>

<img width="5178" height="2364" alt="Happy AI Overview" src="/.github/header-cn.png" />

<h3 align="center">
第一步：下载应用
</h3>

<div align="center">
<a href="https://testflight.apple.com/join/XyjvbhXe"><img src="/.github/badge-testflight.svg" height="39" alt="Download on TestFlight" /></a>
&nbsp;&nbsp;
<a href="https://github.com/ZonEaseTech/happy-wfs/releases/latest"><img src="/.github/badge-github-apk.svg" height="39" alt="Download on GitHub" /></a>
</div>

<h3 align="center">
第二步：在你的电脑上安装 CLI
</h3>

```bash
npm install -g @zonease/happy
```

<h3 align="center">
第三步：用 `happy` 代替 `claude`、`codex` 或 `gemini`
</h3>

```bash
# 原来用: claude
# 现在用: happy

happy

# 原来用: codex
# 现在用: happy codex

happy codex

# 原来用: gemini
# 现在用: happy gemini

happy gemini
```

运行 `happy` 会打印一个二维码用于设备配对。

- 用第一步下载的应用扫描二维码（或在浏览器中打开 [app-happy.zonease.org](https://app-happy.zonease.org/)）。
- 前提：安装你想要控制的供应商 CLI（`claude`、`codex` 和/或 `gemini`）。

<div align="center"><img src="/.github/mascot.png" width="200" title="Happy AI" alt="Happy AI"/></div>

## 🔥 为什么选择 Happy AI？

- 🎛️ **Claude、Codex 和 Gemini 的远程控制** — 三个 Agent 均为一等公民
- 🤖 **编排器** — 定义多 Agent 任务 DAG 并自动调度执行
- ⚡ **即时设备切换** — 一键夺回控制权
- 🔔 **推送通知** — 随时知道你的 Agent 需要关注
- 🔐 **端到端加密 + 可自托管** — 默认加密，一条命令 Docker 部署
- 🎙️ **语音助手** — 基于 LiveKit 的语音网关，可插拔 STT/LLM/TTS 供应商
- 🧰 **多仓库工作区** — 基于工作树的多仓库工作流，支持分支选择和 PR 创建
- 📁 **代码浏览器和 Git 管理** — 从手机浏览文件、查看 diff、暂存/提交/丢弃
- 📨 **待发消息队列** — CLI 繁忙时消息排队，就绪后自动分发
- 🖥️ **设备编队** — 一条命令纳管机器，随后可执行命令、开终端，AI 也能直接触达
- 🐞 **Bug 看板** — 带截图的反馈提交、讨论与跟踪，全公司共享

## 工作原理

在电脑上运行 `happy` 代替 `claude`，`happy codex` 代替 `codex`，或 `happy gemini` 代替 `gemini`，通过我们的包装器启动你的 AI。当你想从手机上控制编码 Agent 时，它会以远程模式重启会话。要切换回电脑，只需按键盘上的任意键。

## Happy AI 新特性

Happy AI 是原版 Happy 的重大演进，以下是亮点：

### 编排器（Orchestrator）
- 定义任务依赖图（DAG），支持按任务指定模型和工作目录
- 跨 Claude、Codex 和 Gemini 自动调度执行
- 实时状态徽章、活动计数和状态颜色进度条
- 通过会话恢复跟进已完成任务
- MCP 工具集成，自动填充工作目录

### 待发消息队列
- CLI 繁忙时消息在服务端排队，就绪后自动分发
- 队列面板 UI，支持图片数量徽章和立即发送
- 重连同步和并发分发安全

### 多 Agent 支持（Claude Code + Codex + Gemini）
- 三个 Agent 均为一等公民，支持会话恢复、复制/分叉和历史记录
- 多 Agent 历史页面，按供应商分标签页，支持设备和 Agent 类型筛选
- 按 Agent 选择模型、费用追踪和上下文窗口显示
- Codex 支持 ACP 和 App-Server（JSON-RPC）两种后端，Codex v0.121.0 支持 fast mode
- AI 后端配置文件，内置 DeepSeek、Z.AI、OpenAI、Azure 和 Google AI 预设
- Claude Opus 5 成为 Claude 默认模型，过滤空 thinking 块以保证渲染干净
- 新增 GPT-5.6 Codex 支持，提供 low/medium/high/xhigh 四档推理强度；复制出的 Codex 会话默认用 GPT-5.6

### 语音助手（Happy Voice）
- 基于 LiveKit 的语音网关，支持可插拔的 STT/LLM/TTS 供应商
- 麦克风静音、语音消息发送确认、"思考中"指示器
- 上下文感知语音：应用状态自动注入到语音 LLM
- 按前缀自动切换供应商（如 `openai/gpt-4.1-mini`、`cartesia/sonic-3`）

### 多仓库工作树工作区
- 从应用中创建、切换和归档多仓库工作区
- 按仓库选择分支、设置和脚本
- 跨仓库聚合 git 状态
- 自动生成工作区 `CLAUDE.md` / `AGENTS.md`（含 `@import` 引用）
- 工作树合并和 PR 创建，支持目标分支选择
- AI 驱动的 PR 代码审查，结果发布为 GitHub 评论

### 代码浏览器和 Git 管理
- 完整的文件浏览器，支持搜索、Monaco 编辑器查看/编辑
- 提交历史，支持分支选择器（本地 + 远程）
- Git 变更页面：暂存、取消暂存、提交、丢弃
- 按文件差异统计（+N/-N），支持 Claude、Codex 和 Gemini
- 图片预览，支持分享

### 设备编队
- 一行纳管：服务端 token + 安装脚本，每台机器一条 CLI 命令
- `happy ssh` 支持交互式设备选择、单命令执行（带回远端退出码）、输出实时流式返回
- 设备终端跨路由常驻，标签页以设备名命名
- 每台设备的用途备注会透传给 AI，让它知道哪台机器该干什么
- 免隧道向设备传文件；在应用内重命名、移除设备、审批设备密钥
- `device_exec` MCP 工具：会话默认可触达所有已纳管设备，也可指定其中若干台
- 通过托管 MCP 端点共享设备 —— 一个 token 可覆盖多台设备，授权可查看、延期、吊销

### Bug 看板与反馈
- 从任意会话提交 bug，笔记式富文本编辑器，评论支持直接粘贴截图
- 共享反馈看板，全公司可见并标注提交人
- 待处理 bug 优先排序，列表和角标每分钟自动刷新，搜索框旁提供手动刷新
- 未发送的 bug 草稿在浏览器刷新后仍在
- 新建 bug 和新评论通过飞书 webhook 通知，带真实 @ 提醒

### 公司与协作
- 公司成员管理与 mention 共享
- 把人 @ 进会话 —— 协作者可以 @ 会话参与者，编辑权限的协作者可以 @ 自己的好友
- 公开共享会话中可以聊天

### 通知与收件箱
- 醒目的未读圆点 + 浏览器 mention 通知，通知里带会话标题
- 一键清除已读或全部条目，7 天自动过期
- 记忆列表缓存在设备上，打开即显示

### 会话共享
- 直接邀请好友或通过公开链接分享会话
- 端到端加密：直接分享使用 NaCl Box，公开链接使用 token 派生密钥
- 实时同步消息、git 状态和语音聊天
- 按访问级别（查看/编辑/管理）控制权限
- 会话列表"全部/共享给我/我分享的"过滤标签和共享指示器
- 公开分享网页查看器，无需安装应用即可访问

### OpenClaw 网关
- 通过中继隧道或直连 WebSocket 连接外部 AI 机器
- Ed25519 密钥交换进行机器配对
- 聊天界面，支持实时流式传输和会话管理
- 丰富内容块渲染：支持外部 AI 的 thinking、tool use 和 image 内容块

- 任务列表，支持过滤、搜索、分页和状态工作流
- 任务详情，支持 HTML 渲染、负责人、文件、子任务
- 实时 WebSocket 聊天（Slack 风格布局、表情回应、语音回放、图片/视频）
- 从任一任务一键启动 AI 会话（MCP 服务透传）
- 在应用内直接创建任务和项目，跨平台日期选择器
- 全局化 WebSocket 连接，实时任务更新，持久化服务端连接

### 自托管
- 一条命令 `docker-compose up`（Web + API + Voice + Postgres + Redis + MinIO）
- 独立源架构（无路径反向代理）
- `.env.example` 包含完整配置参考
- Docker 构建的运行时环境变量注入

### 同步和可靠性
- v3 消息 API，基于 seq 的同步、批量写入和游标分页
- WebSocket 不可用时的 HTTP 发件箱可靠投递
- 服务端确认消息发送，支持重试和消息接收追踪
- 修复游标跳过、发件箱竞争、消息重复/丢失

### 聊天和会话体验
- 会话打开后在后台补全整段历史，并缓存到设备，重新打开时一次性全部呈现
- 桌面端消息导航条：悬停可预览自己发过的任意一条消息，点击跳回该处
- 把消息钉为会话目标 —— 一个会话可钉多条，通过服务端同步，以强调色卡片呈现
- 手机端快捷命令，执行状态和输出就地展示
- 图片附件和剪贴板粘贴（Web），草稿支持图片；上传最大尺寸提升到 1568px 并跳过冗余压缩，保留代码截图和 UI 截图的文字清晰度
- 新会话标题以第一条用户消息播种（AI 摘要生成后再接管），不再使用目录名兜底
- 即使 Agent 没有 assistant 消息（如未知斜杠命令），CLI 的 result 文本也会呈现到手机端，不再出现空白回复
- `/duplicate` 命令从任意消息分叉会话
- 消息分页、未读蓝点指示器、紧凑列表视图
- Active/Inactive 标签页过滤器、会话预览展开/折叠、元数据缓存
- 会话重命名并锁定（防止 AI 自动更新）、历史搜索
- 选项点击发送 / 长按填充、滚动到底部按钮
- 下拉刷新、内嵌分隔线、Agent tool 展示（机器人图标）
- 工具输入/输出格式化为 key-value 对（替代原始 JSON）
- `preview_html` 工具全页面 HTML 预览，公开分享提供短链接，冒号分隔 MCP 工具命名
- CLI 会话中途热升级
- 侧边栏项目分组按机器拆分，紧凑会话视图与合并工作树分组默认开启

### CLI
- `happy update` 自更新、`happy --version` 显示所有 Agent 版本
- 守护进程开机自启动（`happy daemon enable/disable`）、重启命令
- 统一 Codex 和 Gemini 系统提示注入
- 消息接收追踪，兼容旧版本

### Bug 修复和稳定性
- 安全：Shell 命令注入修复、计划模式权限处理
- 性能：移动端载荷精简、延迟加载 diff、渲染优化

### UI 和打磨
- 全应用暗色模式修复
- i18n 改进（简体中文/繁体中文、CJK 输入处理）
- Markdown 渲染：表格、内联代码、嵌套代码块、可点击文件路径
- 键盘处理、加载状态、导航稳定性、图标字体预加载

完整变更日志：[docs/changes-from-happy.zh-CN.md](docs/changes-from-happy.zh-CN.md)

## 项目组件

- **[Happy App](packages/happy-app)** — Web UI + 移动客户端（Expo）
- **[Happy CLI](packages/happy-cli)** — Claude Code、Codex 和 Gemini 的命令行界面
- **[Happy Server](packages/happy-server)** — 加密同步后端服务器
- **[Happy Voice](packages/happy-voice)** — 语音网关（基于 LiveKit）
- **[Happy Wire](packages/happy-wire)** — 共享线路类型和 Schema

## 自托管（Docker Compose）

完整的自托管部署指南请参阅 **[自托管文档](docs/self-host.zh-CN.md)**。

## 兼容性说明

Happy AI 在品牌重塑中有意更改了客户端 KDF 标签。请将其视为**全新一代**：不要期望旧客户端创建的加密数据能被 Happy AI 读取（反之亦然）。

## 关于我们

我们开发 Happy AI，是因为我们想在任何地方（Web/移动端）监控编码 Agent，同时不放弃控制权、隐私或自托管的选择。

## 文档和贡献

- **[文档](docs/README.md)** — 了解 Happy AI 的工作原理（协议、部署、自托管、架构）
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 开发环境搭建和贡献指南
- **[SECURITY.md](SECURITY.md)** — 安全漏洞报告政策
- **[SUPPORT.md](SUPPORT.md)** — 支持与故障排查

## 许可证

MIT 许可证 — 详见 [LICENSE](LICENSE)。
