# Hesi（合思）架构白皮书 · 护城河证据

> 版本：v0.1.0 · 依据：代码库实地勘察（`Hesi-产品打磨实施方案.md` 第一轮现状盘点核对的真实资产）
> 本文档用于对外证明 Hesi 的四大技术支柱**真实存在、可核查**，并说明其轻量/离线设计哲学与商业取舍。

---

## 0. 摘要

Hesi（合思）是一个 **local-first（本地优先）的浏览器终端中枢**，在 `node-pty + xterm.js + WebSocket` 的终端内核之上，叠加了三件已落地的差异化能力：

1. **多 Agent 圆桌协作**（回合制 SSE）
2. **Headless 执行引擎**（无 TTY 调用 CLI Agent）
3. **MCP 安全**（鉴权 + 审计 + 命令策略）
4. **连接器生态**（60+ 中国企业与开发工具连接器）

设计哲学是**轻量、无 Electron、离线文件夹、便携 Node**——这既是工程取舍，也是面向企业"内网离线部署、数据不出网"的卖点。

> 状态图例：✅ 已实现（代码可核查）／🟡 规划中（能力矩阵已定义，实现待补）。

---

## 1. 四大支柱详解

### 支柱一 · 多 Agent 圆桌协作（回合制 SSE）

**解决的问题**：单一 AI 模型容易"自说自话"。让"AI 助手"与一个或多个"CLI Agent（如 opencode）"就同一问题**多轮辩论、互相质疑、收敛方案**，输出质量通常优于单模型。

**实现要点**：
- 协调器：`routes/chat/discuss.js`。
- **回合制**：每轮 AI 助手先发言（流式），再把发言交给各 CLI Agent（每个 Agent 新开 session，task 含完整讨论记录，保证无状态亦可连续）→ 交替直至 `maxTurns` 或 AI 标记 `[CONVERGE]` 早停。
- **实时推流**：全程 SSE（`discuss_start` / `token` / `discuss_end` / `status` / `[DONE]`），前端按 `speaker` 渲染气泡。
- **可选多 Agent**：最多同时 `MAX_DISCUSS_AGENTS = 4` 个 CLI Agent 参与（控成本 / 防失控）。
- **成本可见**：记录 AI 输入/输出 token 与各 Agent 输出字符数，圆桌 vs 单模型成本可被实测。
- **文本治本**：Agent 输出经 `lib/terminal-clean.js` 流式清洗，跨 poll 边界缓存未完成的转义序列，喂给 AI 与气泡的都是纯净文本。

> 状态：✅ 已实现。

### 支柱二 · Headless 执行引擎（无 TTY 调用）

**解决的问题**：opencode 等 CLI Agent 是全屏 TUI，放进 PTY 会绘制 ASCII 界面/状态条，其渲染帧是字面文本，剥掉转义后只剩碎片，**污染喂给 AI 的讨论文本**（表现为"陷入界面渲染，未提供实质分析"）。

**实现要点**：
- 描述表：`lib/cli-headless.js` 的 `HEADLESS` 映射。
- **opencode 已验证**：改用 `opencode run` 并通过 **stdin 管道**注入任务（非 TTY，从源头杜绝 TUI），输出为干净纯文本；多行 prompt 走 stdin 避免 shell 转义风险。
- **可扩展**：`aider` / `claude` / `codex` 等以 argv 形式的描述已预留，经实测后补充。
- **回退兼容**：未声明 headless 的 Agent 仍走 PTY + `lib/terminal-clean.js` 转义清洗，行为不变。
- **TUI 保留**：人工交互终端（`ws/agent.js`）与工作流（`ws/orchestrator.js`）的 TUI 完整保留——自动执行走 headless，人工交互保留界面，两者分离互不污染。
- 执行入口：PTY 层的 `ws/pty.js` 提供 `createHeadlessExec`。

> 状态：✅ 已实现（opencode 路径已验证）。

### 支柱三 · MCP 安全（鉴权 + 审计 + 命令策略）

**解决的问题**：一个能执行任意命令、控浏览器的终端若暴露出去，就是 RCE 风险。Hesi 在 MCP 层与终端层都做了安全治理，**默认即偏安全**。

**三层组成**：

1. **鉴权（Auth）**
   - MCP 层：`mcp/security/auth.js` —— 设 `QCLI_MCP_TOKEN` 后，所有 JSON-RPC 请求须带 `Authorization: Bearer <token>`；stdio 传输默认本地信任跳过。
   - HTTP + WebSocket 层：`lib/access-auth.js` —— 设 `QCLI_ACCESS_TOKEN` 后，敏感 `/api` 与 WebSocket 需令牌；**回环地址默认豁免**（本地浏览器同源），设 `QCLI_TOKEN_REQUIRE_LOOPBACK=1` 可强制回环也校验。

2. **审计（Audit）**
   - 统一审计总线：`lib/audit.js` —— 单一 append-only JSONL 汇聚**所有**安全相关事件：登录/登出、PTY 命令、MCP 工具、Agent 讨论、文件上传、配置变更、资源读取。
   - 敏感字段自动脱敏（`token/password/secret/key…` → `[REDACTED]`），长字段截断。
   - 异步批量写入，不阻塞请求路径；提供 `query()` 与 `exportCsv()`。
   - MCP 层 `mcp/security/audit.js` 已**改为委托**到统一总线，保证终端层与 MCP 层同一份审计账本。
   - 安全中间件 `mcp/security/index.js` 的 `protectTool` / `protectResource` 自动在工具调用前后打点。

3. **命令策略（Policy）**
   - 引擎：`mcp/security/policy.js`，默认 `blocklist` 模式（旧版默认 `permissive` 已修正），内置危险命令黑名单：`mkfs*` / `dd` / `shutdown` / `rm -rf /` / `:(){` fork bomb / 裸设备写 `/dev/` 等，支持 token 与 `/regex/` 两种匹配。
   - 更严格的 **AI-exec 专用黑名单**（`AI_EXEC_BLOCKLIST`）：自治 Agent 运行时额外禁止 `rm/mv/dd/chmod 777/...` 等破坏性/侦察类命令，独立于人工可定制策略。
   - 终端桥接：`ws/pty-policy.js` 复用同一引擎，支持会话 `readonly`/`normal` 模式、输入行级拦截。
   - 文件系统沙箱：`checkFilePath` 默认限制在项目根目录内。

> 状态：✅ 已实现（鉴权、统一审计总线、命令策略与限流 `rate-limiter.js` 均已落地）。

### 支柱四 · 连接器生态（企业微信 / 腾讯 / 飞书等）

**解决的问题**：企业的能力散落在飞书、企业微信、腾讯文档、钉钉、Jira、GitHub 等数十个系统里，缺少统一、可被终端 + Agent 编排的入口。

**实现要点**：
- 连接器库：`vendor/connectors/` —— **60+ 连接器**，覆盖：
  - 协同办公：飞书 `feishu`、企业微信 `wecom`、钉钉 `dingtalk`、腾讯文档 `tencent-docs` / `tencent-docs-oa`、金山文档 `kdocs`、Notion `notion`、知识库 `km` / `iwiki-woa` / `lexiang`。
  - 研发协作：GitHub `github` / `github-remote`、Jira `jira`、TAPD `tapd` / `tapd-woa`、CI `zhiyan-cicd`、工蜂 `gongfeng-woa`。
  - 腾讯生态：腾讯云 `cloudbase`、腾讯地图 `tencent-map`、腾讯广告 `tencentads`、腾讯问卷 `tencent-survey`、腾讯健康 `tencent-health-nges`、微云 `tencent-weiyun`、企点 `tencent-qidian-cs`、CNNB `cnb-api`/`cnb-woa`、各 `*-woa` 内部系统。
  - 商业/数据：企查查 `qcc-company`、天眼查 `tyc-mcp`、专利 `patsnap-search`、法搜 `fyopen-lawsearch` / `pkulaw`、CRM `neo-crm`、问卷 `qingflow`、邮件 `gmail`/`qq-mail`/`netease-mail` 等。
- MCP 接入：`mcp/tools/connectors.js` + `mcp/tools/registry.js` 将连接器注册为 MCP 工具/资源，天然继承第三支柱的鉴权 + 审计 + 策略。
- 商业意义：连接器清单是**先发渠道资产**，对企业客户具强绑定属性，是生态护城河的核心。

> 状态：✅ 已实现（连接器数量与清单以 `vendor/connectors/` 目录为准）。

---

## 2. 模块映射表（功能 → 文件）

| 功能 | 核心文件 | 状态 |
|------|----------|------|
| 多 Agent 圆桌 | `routes/chat/discuss.js`、`routes/ai-tools/agent-pool.js` | ✅ 已实现 |
| Headless 执行 | `lib/cli-headless.js`、`ws/pty.js`（`createHeadlessExec`）、`lib/terminal-clean.js` | ✅ 已实现 |
| 终端内核 | `ws-handler.js`、`ws/pty.js`、`ws/agent.js`、`ws/orchestrator.js`、`public/`（xterm.js） | ✅ 已实现 |
| MCP 鉴权 | `mcp/security/auth.js`、`lib/access-auth.js`（HTTP+WS） | ✅ 已实现 |
| 统一审计总线 | `lib/audit.js`、`mcp/security/audit.js`（委托） | ✅ 已实现 |
| 命令策略 | `mcp/security/policy.js`、`ws/pty-policy.js`、`rate-limiter.js`（限流） | ✅ 已实现 |
| RBAC | `lib/auth/rbac.js`（admin/user/viewer） | ✅ 已实现 |
| 许可 / 能力门控 | `lib/license.js`（社区/商业能力矩阵） | ✅ 已实现 |
| 连接器生态 | `vendor/connectors/*`、`mcp/tools/connectors.js`、`mcp/tools/registry.js` | ✅ 已实现 |
| 离线便携 | `tray/tray.js`、`tray/tray.exe`（Node SEA）、`node/`（便携运行时） | ✅ 已实现 |
| 前端（Lit 架构） | `public/`（ESM 组件化、`public/components/*`、`public/admin/`） | ✅ 已实现 |
| **SSO / 企业身份** | `lib/license.js` 已列为商业版能力（`sso: false` 社区） | 🟡 规划中 |
| **团队工作区** | `lib/license.js` 已列为商业版能力（`teamWorkspace: false` 社区） | 🟡 规划中 |
| **遥测 / 增长指标** | 实施方案工作流 C（`lib/telemetry.js`） | 🟡 规划中 |
| **审计仪表盘 UI 完善** | `public/admin/` 雏形 + 商业化打磨 | 🟡 规划中 |

---

## 3. 设计哲学与商业取舍

### 3.1 轻量 / 无 Electron

- 终端与 UI 均为 **Web 技术栈**（Node + Express + xterm.js + Lit），**不引入 Electron**，避免百 MB 级客户端与多进程开销。
- MCP sidecar（`mcp-server.js`）独立进程，按需启用（`QCLI_WITH_MCP`）。

### 3.2 离线文件夹 / 便携 Node

- 分发形态是一整个 `hesi/` 文件夹（node + server.js + node_modules + public + tray），**U 盘复制即用、离线可跑**——这是特性不是缺陷。
- `tray/tray.exe` 由 `tray/tray.js` 经 **Node SEA** 编译，纯 Node 启动器（非浏览器壳），把便携 `node/` 注入 PATH 拉起服务。
- 企业价值：可**完全内网离线部署、数据不出网**，契合政企/金融合规诉求。

### 3.3 默认安全（local-first）

- 默认仅绑定回环 `127.0.0.1` / `::1`；`HOST=0.0.0.0` 打印高危警告。
- 命令策略默认 `blocklist`，限流默认开启（回环豁免），令牌未设则仅本地开放——开箱即用偏安全。
- 公网暴露有明确清单（令牌 + CORS + 策略 + 反向代理 HTTPS），见 README「安全部署」。

### 3.4 商业取舍（开源 vs 付费）

- **免费版保留核心价值**：多 Agent 圆桌、离线/便携、开源核心——维持社区与开源引力。
- **付费仅针对企业治理**：审计、团队工作区、SSO、私有部署管控（`lib/license.js` 能力矩阵），降低社区反弹。
- **模型成本转嫁**：无自研模型；商业版"私有部署 + 自带 Key"把 API 成本转给客户，反成卖点。

---

## 4. 护城河小结（对外一句话）

> Hesi 的护城河不是"技术黑箱"，而是**已落地的四件套**——多 Agent 圆桌、Headless 引擎、MCP 安全治理、60+ 中国企业连接器——叠加**轻量离线内核**与**先发生态渠道**。这四点均可在此代码库逐一核查，构成可演示、可审计、可销售的真实壁垒。
