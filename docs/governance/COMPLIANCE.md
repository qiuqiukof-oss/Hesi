# Hesi（合思）合规与等保自检材料

> 用途：作为等保 2.0 三级申报、企业安全评估、客户 POC 准入的**自我声明材料**。
> 版本：`0.1.0` · 依据：对代码库（`lib/audit.js`、`lib/auth/*`、`mcp/security/policy.js`、`lib/config.js`、`server.js`、`SECURE_DEPLOY.md`）的实地勘察。
> 说明：本文档描述产品**当前**安全姿态，与《SECURE_DEPLOY.md》互为补充——后者面向运维，本文档面向合规与审计。

---

## 1. 适用范围

| 项 | 说明 |
|----|------|
| **产品形态** | 在浏览器中运行任意 CLI / 终端的本地优先（local-first）平台，集成 AI 对话、CLI Agent 协作（圆桌）、MCP 服务、浏览器控制（CDP）。 |
| **核心代码** | `server.js`（Express 入口）、`ws-handler.js` + `ws/pty.js`（node-pty 终端执行）、`lib/audit.js`（统一审计）、`lib/auth/*`（认证与 RBAC）。 |
| **适用场景** | 个人本地开发、团队/企业内网部署、可信环境私有化部署。 |
| **不适用** | **公网无认证裸跑**——会暴露任意命令执行（RCE）风险；详见《SECURE_DEPLOY.md》。 |
| **本质声明** | Hesi 是「浏览器里的本地 shell」。命令策略仅做**危险操作拦截**，并非沙箱隔离；仅应在对用户/运行环境可信的场景下使用。 |

---

## 2. 数据流向图

```
┌──────────────┐    WebSocket/HTTP(S)     ┌────────────────────┐
│  浏览器 UI    │ ───────────────────────▶ │  Hesi 服务端        │
│ (xterm.js)   │ ◀─────────────────────── │  (server.js)        │
└──────────────┘   终端输出 / 事件流        └─────────┬──────────┘
                                                      │ 命令执行
                                                      ▼
                                            ┌────────────────────┐
                                            │ node-pty 拉起 shell │
                                            │ (ws/pty.js)         │
                                            └─────────┬──────────┘
                                                      │ 同步落盘（append-only）
                                                      ▼
                                            ┌────────────────────┐
                                            │ data/audit.jsonl   │  ← 审计总线
                                            │ （本地文件，不外发） │
                                            └────────────────────┘
```

**是否有外发？**

| 数据流 | 是否外发 | 说明 |
|--------|----------|------|
| 终端命令内容 | **否（默认）** | 命令在本地 node-pty 执行，仅输出回传给本机浏览器；不主动上传命令本身。 |
| 审计日志 | **否** | 写入本地 `data/audit.jsonl`，无自动外发通道。 |
| AI 对话/上下文 | **条件外发** | 使用 AI 功能时，终端上下文 + 用户 Prompt 会发往**配置的 LLM 提供商**（OpenAI / Anthropic / 本地 LM Studio）。不配置 Key 则仅尝试本地 LM Studio（`localhost:1234`）。 |
| 可选遥测 | **默认关闭** | `TELEMETRY_OPT_IN` 默认 `false`；开启后采集匿名使用量（DAU/功能频次/连接器 Top N）。 |
| 连接器/MCP | **视连接器而定** | 企业微信、腾讯、飞书等连接器按需调用对应外部 API，由连接器自身定义。 |

> 结论：产品**默认不向外发送任何命令或审计数据**。唯一的条件外发来自用户主动启用的 AI / 遥测 / 连接器能力。

---

## 3. 认证与授权

### 3.1 认证模式（`AUTH_MODE`）

| 模式 | 行为 | 代码位置 |
|------|------|----------|
| `local`（**默认**） | 个人/本地模式，免登录，所有请求以 `admin` 身份放行（全权限）。 | `lib/auth/session.js` `requireAuth` |
| `enterprise` | 强制多用户账号，受保护路由需有效会话令牌；无令牌返回 `401`。 | `lib/auth/session.js` |

### 3.2 单令牌兼容（遗留模式）

- 环境变量 `QCLI_ACCESS_TOKEN` 设置后，远程客户端须通过 `Authorization: Bearer <token>`（HTTP）或 `?token=<token>`（WebSocket）鉴权。
- **本地回环（127.0.0.1 / ::1 / localhost）默认豁免**；设 `QCLI_TOKEN_REQUIRE_LOOPBACK=1` 可强制本机也需令牌。
- 该令牌在任一模式下均视为 `admin`，与新建账号体系并存、兼容旧部署。
- 代码：`lib/access-auth.js` + `lib/auth/session.js` 第 2 条分支。

### 3.3 会话令牌

- 自研**无状态 HMAC-SHA256 签名**令牌（`<payload>.<sig>`），不依赖 `express-session`。
- 默认 TTL `7 × 24h`；从请求头 / Cookie / 查询参数提取。
- 校验使用 `crypto.timingSafeEqual` 防时序攻击。

### 3.4 RBAC（三角色）

角色层级：`admin > user > viewer`。权限以 capability 字符串表达，`admin` 隐式拥有全部权限。

| 角色 | 典型权限 |
|------|----------|
| **admin** | `admin:all`、审计读写、用户读写、配置读写、会话控制、工作区、许可、指标。 |
| **user** | 会话读写、工作区读写、指标/许可/配置读取。 |
| **viewer** | 会话/工作区/指标/许可/审计/配置**读取**（`sessions:read`、`audit:read`、`config:read` 等）。 |

- 鉴权网关：`requireRole(permission)` —— 非 enterprise 模式直接放行；enterprise 下校验 `rbac.can(role, permission)` 或 `admin`。
- 代码：`lib/auth/rbac.js`、`lib/auth/session.js`。

---

## 4. 审计（统一审计总线）

`lib/audit.js` 将分散的审计点收敛为**单一 append-only JSONL 落地**，覆盖核心终端层而不止 MCP 层（原 `mcp/security/audit.js` 已委托至此）。

### 4.1 记录的事件类型

| 事件类型 `type` | 触发场景 |
|-----------------|----------|
| `auth`（login / logout） | 登录 / 登出 |
| `pty_command` | **核心终端命令执行**（含 `user` / `session` / `cwd` / `cmd` / `policyResult`） |
| `mcp_tool` | MCP 工具调用 |
| `tool_call` | 通用工具调用 |
| `agent_discuss` | AI × CLI Agent 圆桌讨论 |
| `file_upload` | 文件上传 |
| `config_change` | 配置变更 |
| `resource_read` | 资源读取 |

### 4.2 敏感信息脱敏

- `sanitize()` 对 key/value 中含 `token` / `password` / `secret` / `key` / `auth` / `credential` 等字段置为 `[REDACTED]`。
- 超长命令（>500 字符）与超长字符串（>200 字符）截断，避免审计文件膨胀与敏感泄露。

### 4.3 落地与保留

| 项 | 默认值 | 说明 |
|----|--------|------|
| 落盘路径 | `data/audit.jsonl`（`QCLI_AUDIT_LOG` 可覆盖） | 异步批量追加，不阻塞请求路径。 |
| 保留期 | `AUDIT_RETENTION_DAYS = 90`（可配） | 配置项已就绪；**自动清理超期条目的定时任务为规划中**（见第 8 节）。 |
| 查询 / 导出 | `GET /api/admin/audit`（admin）、`exportCsv()` | 支持按类型 / 用户 / 时间过滤与 CSV 导出。 |

---

## 5. 传输安全

| 项 | 现状 |
|----|------|
| **默认绑定** | **双栈回环** `127.0.0.1` + `::1`（`HOST` 默认 `loopback`）。设 `0.0.0.0` / 公网 IP 会在启动日志打印高危告警，但**不主动阻止**。 |
| **HTTPS** | 服务端默认 **HTTP**；公网暴露**必须在反向代理（nginx / Caddy）终止 TLS**，启用 HSTS。裸跑 HTTP 于公网为高危。 |
| **安全头** | 已启用 `helmet`（`helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false })`）——应用 CSP 关闭以兼容 xterm/WebSocket；其余安全头默认开启。 |
| **WebSocket** | 与 HTTP 同源；受 `QCLI_ACCESS_TOKEN` 网关保护（远程需令牌）。 |
| **建议** | 公网/多人部署：前置 Nginx + TLS + HSTS，仅代理受信来源；不以 root 运行；定期更新依赖。 |

> 参考实现见《SECURE_DEPLOY.md》第 3 节 Nginx 反代片段。

---

## 6. 最小权限

| 控制面 | 默认策略 | 代码 |
|--------|----------|------|
| **命令策略** | `blocklist` 模式，开箱拦截 `mkfs` / `dd` / `shutdown` / `rm -rf /` / fork bomb / 写 boot 区 / `chmod -R 0` 等危险操作。可经 `QCLI_POLICY_PATH` 切到 `allowlist` / `permissive`。 | `mcp/security/policy.js` `DEFAULT_POLICY` |
| **AI 执行档** | 独立的更严 `AI_EXEC_BLOCKLIST`（供 Agent 自动跑命令），与终端策略共用匹配引擎。 | 同上 `AI_EXEC_BLOCKLIST` |
| **CORS** | 默认仅同源 / 回环；无 `Origin` 的请求（curl / SSE）放行；跨域需 `QCLI_CORS_ORIGINS` 显式白名单，其余一律拒绝。 | `server.js` CORS 配置 |
| **限流** | 全局 API + WebSocket 消息 + 上传限流（本地回环默认豁免）。 | `rate-limiter.js` |
| **文件隔离** | 用户上传写入隐藏目录 `uploads/.user/`，仅经鉴权的 `/api/uploads` 可读；静态路由 `dotfiles:'ignore'` 不暴露。 | `server.js` |

---

## 7. 密钥治理

| 项 | 规范 |
|----|------|
| **`.env` 不入库** | `.env` 与 `.mcp.json` 已 git-ignore；仓库仅保留 `.env.example` 作为模板（见《SECURE_DEPLOY.md》）。 |
| **`SESSION_SECRET` 持久化** | 优先读取环境变量；未设置时首次运行生成 `32 字节随机值`，写入 `data/.session-secret`（文件权限 `0600`），**重启后令牌仍可校验**。 |
| **令牌强度** | `QCLI_ACCESS_TOKEN` 应由部署者提供随机长令牌；代码不生成默认弱令牌。 |
| **密钥暴露面** | PTY 环境变量经 `lib/env-filter.js` 过滤 `API_KEY` / `TOKEN` / `PASSWORD` 等模式；审计脱敏同上。 |
| **审计** | 密钥本身永不写入审计日志（脱敏逻辑覆盖）。 |

---

## 8. 合规对照（等保 2.0 三级）

对照与产品能力相关的控制项，标注状态：

| 等保 2.0 三级控制项 | 对应产品能力 | 状态 |
|---------------------|--------------|------|
| **身份鉴别**（8.1.2：唯一标识、口令/令牌、登录失败处理） | `AUTH_MODE=enterprise` 多用户账号、HMAC 会话令牌、单令牌兼容 | ✅ 已实现（本地免登录为设计选择，企业模式强制认证） |
| **访问控制**（8.1.3：默认拒绝、角色分级、权限分离） | RBAC 三角色 `admin/user/viewer`、capability 网关、`requireRole` | ✅ 已实现 |
| **安全审计**（8.1.4：覆盖重要用户行为/安全事件、审计记录含时间/主体/客体/结果、防止中断） | 统一审计总线覆盖登录/PTY命令/MCP工具/上传/配置变更；append-only 落盘；脱敏 | ✅ 已实现（核心覆盖） |
| **审计留存与集中管理**（8.1.4 / 8.1.5） | `AUDIT_RETENTION_DAYS` 配置；`/api/admin/audit` 查询导出 | 🟡 部分（保留期已可配；**超期自动清理**与**审计仪表盘 UI** 为规划中） |
| **入侵防范**（8.1.6：最小化服务、关闭多余端口、命令级防护） | 默认回环绑定、命令 `blocklist` 拦截、AI 执行档严格清单 | ✅ 已实现（默认最小暴露面） |
| **通信传输完整性/保密性**（8.1.7） | 公网建议反向代理 TLS；已启用 `helmet` | 🟡 规划中（产品侧提供指引，TLS 终止依赖运维部署） |
| **数据保密性/个人信息保护**（8.1.8） | 审计脱敏、PTY 环境变量过滤、`.env` 不入库 | ✅ 已实现（静态数据） |
| **集中安全管理中心**（8.1.10：系统管理/审计管理/集中监控） | 审计查询导出、指标端点（`/api/metrics`，规划）、管理 API | 🟡 规划中（需审计仪表盘与集中管理 UI 落地，见产品方案 B3 / C2） |
| **可信验证/边界防护**（8.1.1 / 8.1.9） | 本地优先架构，无跨信任域调用 | ⚪ 不适用（由部署网络边界承担） |

> 图例：✅ 已实现 ｜ 🟡 规划中 ｜ ⚪ 不适用 / 由部署方承担
>
> 说明：状态基于当前代码快照。等保正式测评需由有资质机构执行；本文件为**厂商自声明**，不替代第三方测评报告。

---

## 9. 相关文档

- [SECURE_DEPLOY.md](./SECURE_DEPLOY.md) — 运维视角的部署安全清单
- [README.md](./README.md) — 产品说明与安全部署章节
- [CONTRIBUTING.md](./CONTRIBUTING.md)（如有）/ README 贡献指南
- `lib/audit.js` · `lib/auth/session.js` · `lib/auth/rbac.js` · `mcp/security/policy.js` — 实现参考
