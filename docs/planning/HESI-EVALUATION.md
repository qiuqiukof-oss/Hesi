# Hesi（合思）项目客观评估报告

> 评估时间：2026-07-21 ｜ 评估方式：源码实证（静态审查 + 关键论断运行核验）｜ 版本：0.1.0 (MIT)
> 评估范围：后端架构、前端质量、安全态势、测试与工程健康度四个维度

---

## 一、一句话总评

Hesi 是一个**野心很大、底层工程相当扎实**的"浏览器里的终端 + AI 智能体中枢"：分层清晰、错误处理与资源回收到位、终端流式清洗等细节处理得很专业。但它在两个层面存在明显落差——**① 旗舰功能（多 Agent 圆桌、headless、会话持久化）在代码侧普遍偏薄甚至为空壳；② 质量门（测试/CI/lint）基本是装饰性的**。作为个人本地工具，它有真实可用价值；但 README 的成熟度观感明显高于代码实际成熟度（版本号 0.1.0 反而诚实地标对了位置）。

**综合评分（四维度均值）：5.25 / 10**

| 维度 | 评分 | 一句话 |
|------|------|--------|
| 后端架构与代码质量 | 7 / 10 | 分层清晰、错误处理与资源回收到位，少量设计缺陷 |
| 前端代码质量 | 6 / 10 | 构建拆分合理，但全局单例滥用、零测试、XSS 热点 |
| 安全态势 | 4 / 10 | 默认本地优先设计合理，但授权不一致+命令执行未鉴权是真实风险 |
| 测试与工程健康度 | 4 / 10 | 测试近乎空白、CI 不跑测试/lint、husky 失效，质量门形同虚设 |

---

## 二、项目定位与客观规模（事实）

- **定位**：本地优先（local-first）的 Web 终端桥接平台，集成 AI 对话、多 Agent 圆桌、浏览器 CDP 控制、MCP 服务、插件系统、离线便携托盘包。
- **技术栈**：Node.js + Express + node-pty + ws + SSE；前端原生 ESM 经 esbuild 打包；AI 接 OpenAI/Anthropic。
- **代码规模**（去 node_modules/node 的**源码**统计）：
  - 总源码约 **60,800 行 JS**，分布在 ~257 个源文件中。
  - routes/ 18,770 行（101 文件）｜ public/ 32,949 行（92 文件）｜ mcp/ 3,378 行（24 文件）｜ ws/ 2,902 行（10 文件）｜ lib/ 1,599 行（17 文件）｜ 其余 plugins/scripts/agents-src 约 1,240 行。
- **依赖健康**：`package-lock.json` 存在、可复现；`npm audit --audit-level=high` 仅 1 条 low（body-parser），无 high/critical。
- **文档**：README 24KB、architecture.md、COMPLIANCE.md、SECURE_DEPLOY.md、BP.md 齐全，文档投入明显。

---

## 三、真实优点（值得肯定）

1. **分层与职责清晰**：`server.js`（入口）→ `routes/`（HTTP）→ `ws-handler.js`（连接）→ `ws/*`（PTY/agent/编排）边界明确；`message-dispatch.js` 把巨型 switch 抽离，`pty.js`/`agent.js`/`orchestrator.js` 各司其职。
2. **错误处理扎实**：`ws-handler.js:393-405` 用 try/catch 包裹消息分发，单条畸形消息不会击垮整个 server；`server.js` 兜底 `unhandledRejection`/`uncaughtException` 并优雅关闭 PTY/MCP。
3. **资源管理到位**：断线重连宽限、僵尸进程看门狗（`agent.js:59-105`）、后台定时器 `.unref()`（`context-store.js:319`、`rate-limiter.js:44`），不阻止进程退出。
4. **底层工程细节专业**：`terminal-clean.js` 的 `createStreamCleaner` 解决**跨 chunk 的转义序列切分**问题——这是真能根治 opencode 类 TUI 污染的工程难点，处理得很到位。
5. **编排引擎有料**：`orchestrator.js` 实现了 DAG（`normalizeDef`+`schedule`）、Kahn 环检测（`isAcyclic`）、失败传播、重试、human-in-loop，结构清晰。
6. **安全"意识"到位**：默认双回环绑定（`server.js:230-238`）、env 凭据过滤（26 条正则）、审计日志脱敏（`lib/audit.js`）、可选 Bearer 令牌、helmet、CORS 白名单、上传限制（100MB/文件 + 扩展名白名单）。
7. **前端构建合理**：`main.js`/`lazy.js` 拆分出 `bundle.js`(约 897KB) + `lazy-bundle.js`(约 243KB) 两段按需加载；有响应式 store、i18n、聊天 Markdown 先转义后渲染。

---

## 四、核心落差：宣称 vs 代码（重点）

README 的"✨ 功能"清单与代码实际存在系统性落差：

| README 宣称 | 代码实际情况 | 证据 |
|------|------|------|
| 🤝 多 Agent 圆桌协作 | `digital-employee.js` 的 `assignTask` 仅 `taskQueue.push`，**队列无人消费、从不调用 agentManager**，调度无执行体 | `digital-employee.js:100-105` |
| 🛡️ headless 从源头杜绝 TUI | `HEADLESS` 映射**只有 opencode**；aider/claude/codex 全是注释/TODO | `lib/cli-headless.js:25-32` |
| 💾 会话持久化 | 后端 `activePTYs`/`agentSessions` 是内存 Map，重启即失；"持久化"主要靠前端 IndexedDB | `ws-handler.js:93`、`agent.js:28` |
| 多工作流并发 | 单 WS 仅支持一个并发 workflow，`activeRuns.set(ws, rs)` 覆盖式写入 | `orchestrator.js:622` |

此外还有一些"小骨感"：每次启动终端都重读 CLI 注册表未复用缓存（`message-dispatch.js:49`）；`contextStore` 用 `key.includes(pattern)` 子串匹配订阅，会误命中（`context-store.js:68`）；单 WS 多 workflow 互斥。

> 客观说：这些问题 README 在"headless 仅 opencode"处是诚实标注的；但"圆桌协作""会话持久化"的表述容易让读者高估落地程度。

---

## 五、安全评估（已实证核验）

**验证结论**：安全代理最初提出的"Critical"论断，**核心点经核验成立**，但需精确表述。

- ✅ 已证实：`routes/index.js:115` 以 `app.use('/api', createToolsRouter())` 挂载，**未挂 `requireToken`**；而 browser(`118`)、plugins(`179`/`437`)、uploads(`106`) 路由**都**挂了 `requireToken`。也就是说——**即便设置了 `QCLI_ACCESS_TOKEN`，最危险的"任意命令执行"接口（`/api/tools/exec` 经 `exec()`）仍然不鉴权**，而相对安全的浏览器/插件路由反而被保护。这是真实的授权不一致。
- ✅ 已证实：默认 `isAuthEnabled=false`（`access-auth.js:24`），`requireToken` 在未设令牌时是 no-op，默认全开。
- ⚠️ 风险条件化：默认仅绑回环（`127.0.0.1`/`::1`），所以**默认部署下爆破面是本机级的**（需已在本机）。真正危险出现在两种误配：① `HOST=0.0.0.0`（仅打印警告、**不阻断**，`server.js:237`）+ 未设令牌 → 等同开放 RCE；② 设了令牌但攻击者仍能打 `tools/exec`（绕过令牌）。
- ✅ AI 执行黑名单（`AI_EXEC_BLOCKLIST`）不拦 `bash/sh/python/node`，可 `bash -c '...'` 绕过——黑名单思路本身脆弱。
- ⚠️ 前端 API Key 明文存 `localStorage`（`chat-api.js`）并经 HTTP 明文上传；默认无 TLS。
- ⚠️ 插件清单接口 `GET /api/plugins` 无令牌（`routes/index.js:218`），且 `/plugin-assets` 静态服务 `plugins/`，`/plugins/create` 可写文件 → 若可达即服务端代码执行面。
- ⚠️ 回环豁免导致本地无限流（`rate-limiter.js`、`ws-handler.js:19`），恶意本地页可对 `localhost:4264` 无限制调用。

**安全加固优先级**：① 对 `/api/tools/*`、`/api/agent*`、`/api/workflows`、`/api/plugins*` 统一加 `requireToken`；② `HOST=0.0.0.0` 且未设令牌时**直接拒绝启动**而非仅告警；③ AI 执行改 allowlist + 交互终端输入行策略校验；④ 补全 env 过滤（漏 `CLIENT_SECRET`/`ACCESS_TOKEN`/`REFRESH_TOKEN`/`SESSION_TOKEN`/`WEBHOOK_SECRET`）与审计对命令内联凭据脱敏；⑤ 前端 Key 改 sessionStorage/内存。

---

## 六、测试与工程健康度（重大短板）

1. **测试密度极低**：源码 ~257 个 JS 文件 / ~60.8K 行，仅 **1 个测试文件** `test/platform.test.js`（5 用例，覆盖 RBAC/audit 脱敏/license/config，质量尚可）。`server.js`、`ws-handler.js`、`routes/`、`mcp/`、`public/` 等主流程**零覆盖**。
2. **README 承诺的回归脚本不存在**：README 提到的 `plans/verify-terminal-clean.js`、`plans/test-discuss.js`、`plans/test-stability-regression.js`——**`plans/` 目录根本不存在**。文档与代码脱节。
3. **前端测试是死引用**：`npm run test:frontend` 指向 `test/frontend/web-test-runner.config.js`，**该文件不存在** → 命令必失败。
4. **CI 不跑测试/lint**：`.github/workflows/ci.yml` 仅 `npm run build` + `npm run check:server`（且 `--ignore-scripts` 跳过 node-pty 编译，不验证运行时）。质量门形同虚设。
5. **Lint 实际失败且不强制**：`npm run lint` 报 **2092 个问题（96 errors + 1996 warnings），exit 1**；含前端 `no-undef`（document/window 未声明）、未知规则（`@typescript-eslint/no-unnecessary-condition`、`node/no-unsupported-features`）等配置不自洽；husky **未初始化**（无 `.husky/`），`lint-staged` 从未生效。
6. **正面**：`npm run check:server` 串联 23 个 `node --check` 全部通过；`npm test` 5/5 通过；依赖可复现、audit 干净；CI matrix + dependabot 齐全。

---

## 七、前端质量细节

- 全局命名空间滥用：`window.QCLI` 被 **42 处**直接赋值，本质是全局可变单例，初始化顺序耦合、隐式依赖。
- 代码重复：`escapeHtml` 在 **17 个文件**各自重复定义，应抽到 `lib/`。
- 无框架、纯手动 DOM：92 个文件几乎全原生 JS，`innerHTML` 拼接 + **93 处**全局事件监听，维护/出错成本高。
- XSS 热点：`multi-media.js` 等 `<img src="${img.url}">` 未校验协议；`orchestrator.js`/`digital-employees.js` 用 `innerHTML` 渲染 AI/后端内容，部分路径未全程转义；mermaid 渲染可被解析注入。
- 日志噪音：前端 **499 处** `console.*`，后端 routes 127 + lib 28 + ws 23 + mcp 12 ≈ 190 处，无统一日志层。
- Bundle 脱节坑：改 `public/` 源码后**必须** `npm run build` 重建 `bundle.js`，无 hash/cache-bust，忘建则页面跑旧代码，调试极困惑（README 已说明，但机制脆弱）。

---

## 八、综合评价与改进优先级

**它是什么**：一个底层工程扎实、文档用心、定位清晰的本地终端/AI 中枢原型。其最闪光处是 node-pty 终端的流式清洗、编排 DAG、资源回收这些"难而正确"的细节——说明作者是真写过生产级终端代码的。

**它还不是什么**：一个"多 Agent 协作"产品（核心是空壳）、一个可放心暴露到非本机的服务（授权不一致 + 命令执行未鉴权）、一个测试可信赖的代码库（质量门装饰性）。

**改进优先级（按 ROI）**：
1. **P0 安全一致性**：给 tools/exec、agent、workflows、plugins 补齐 `requireToken`；`HOST=0.0.0.0` 无令牌时拒绝启动。一小时可改完，收益最大。
2. **P0 测试真实化**：把 README 里"已存在"的 `plans/` 回归脚本真正落地，或删除对应文档；给 `ws-handler`、`orchestrator`、`terminal-clean` 补核心路径单测。
3. **P1 CI 强制门**：CI 加入 `npm test` 与 `npm run lint`（fail-fast）；修 eslint 配置（补前端 globals、移除未知规则）。
4. **P1 功能诚实化**：要么把 `digital-employee` 的圆桌调度真正接上 `agentManager`，要么在 README 明确标注为"规划中"。
5. **P2 前端治理**：收敛 `window.QCLI` 单例、抽离 `escapeHtml`、给 bundle 加内容 hash、Key 移出 localStorage。

**结论**：值得关注与使用的本地工具原型，远未到 README 观感所暗示的成熟度。把它当"个人本地终端 + AI 助手"用是划算的；把它当"多 Agent 协作平台"或"可公网部署的中枢"用，则需要先补上 P0/P1。客观地说，0.1.0 的版本号比 24KB 的 README 更诚实。
