# 四核心功能核实记录（2026-07-31）

> 本文档汇总对 Hesi 四个核心功能的「宣称 vs 实际」核实结果，全部基于代码证据（文件:行号），
> 供后续开发决策与功能报告引用。核实方式：只读调查，未修改任何代码。
> 四份独立探索报告 + 主代理精读交叉验证。

---

## 一、总判定速览

> 验证层级定义：**L0** 代码闭环（静态确认代码路径闭合）｜ **L1** 单测通过（有对应单元/契约测试）｜ **L2** curl 实测（球总用 curl 冒烟过闸门/拦截/反思）｜ **L3** 浏览器实测（UI 交互在浏览器实测）。本记录结论均达 L0，部分达 L1；**2026-08-01 用户确认**：圆桌「落座接管」、AI 讨论等多轮 UI 重交互已通过 L3 浏览器实测，相关功能升级为 L3✅。

| # | 功能 | 判定 | 一句话结论 | 验证层级 |
|---|------|------|-----------|---------|
| 1 | 圆桌讨论（围炉） | ✅ **完整可用** | 前端→后端→LLM/Agent 全链路真实闭合，非空壳 | L0✅ L1✅ L3✅已实测 |
| 2 | 全自动 Plan 执行器 | ✅ **完整实现** | README 标注"Phase 0 待实施"不准确，代码约 90%+ 已落地 | L0✅ L1✅ L2⚠️局部 |
| 3 | AI 讨论（聊天面板） | ✅ **完整可用** | 多轮交替发言真实发生，非 AI 自问自答 | L0✅ L1⚠️仅契约 L3✅已实测 |
| 4 | CLI Agent ↔ AI 双向互动 | ⚠️ **正向完备、反向受限** | 反向仅 `<cliq:ask>` 文本 sideband，非编程式调用 | 正向L0✅L1✅ / 反向L0✅L1❌ |

---

## 二、功能 1：圆桌讨论（围炉圆桌 / 圆桌视图）

**判定：完整可用** — Hesi 实现最扎实的核心功能之一。

### 链路图

```
用户点击"围炉圆桌"按钮
  → chat-panel.js:347-348  roundtableBtn.click → toggleMahjongPanel()
  → side-panels.js:64  RoundTableView.open()
  → roundtable-view.js:561-658  start() 构建 { discuss:true, partners, maxTurns, personas, protocol, takenOver }
  → chat-api.js:126-176  POST /api/chat（SSE 流）
  → routes/chat/index.js:294-322  runDiscussion()
  → discuss.js:252-359  runRoundtable()
      for round = 1..maxTurns:
        ① runAiTurn()  → streamOpenAICore / streamAnthropicCore（真实 LLM HTTP 调用）
        ② for each agent: runCliTurn() → agentPool.start → createHeadlessExec（真实 PTY 进程）→ poll
        ③ runSummary()（最后一轮真实 LLM 汇总）
  → SSE 推流：discuss_start → token → discuss_end → discuss_stats → [DONE]
  → message-dom.js:30-94 渲染气泡 / roundtable-view.js:622-656 席位动画
```

### 关键证据

| 环节 | 证据 |
|------|------|
| 前端入口 | chat-panel.js:132,347-348,727-739；chat-api.js:142-149,217-222 |
| 多轮循环 | discuss.js:295 `for (let round = 1; round <= maxTurns; round++)` |
| AI 真实发言 | discuss.js:301 → routes/chat/stream-openai.js:630-661 / routes/chat/stream-anthropic.js:294-326（fetch + SSE） |
| CLI 真实执行 | discuss.js:321-324 → agent-pool.js:162 → ws/pty.js:144 createHeadlessExec |
| 早停 | discuss.js:331 `[CONVERGE]` 且 round>=2 时 break |
| 增量抽取 | agent-pool.js:283-301 _pollCursor + discuss.js:146-151 去重 |
| 超时/TTL | 单轮 180s（discuss.js:34）、session 5min（agent-pool.js:29）、完成后 5min TTL |
| 汇总兜底 | runSummary() + generateFallbackSummary()（无 LLM 依赖兜底） |
| 模板/角色 | roundtable-presets.js:40-118（4 套模板）+ persona/protocol 注入（discuss.js:53-75） |
| 落座接管 | **已实现**：discuss.js:169-179 runHumanTurn + roundtable-view.js:466-510 |
| 皮肤系统 | roundtable-skins.js（hearth/mahjong），roundtable-skins.test.mjs 6 项 |
| 空壳标记 | 未发现 TODO/stub/空函数体 |

### 遗留项（docs/roundtable.md:39-43 标注，部分已过期）

- ✅ 落座接管 → **实际已实现**，文档未同步（文档滞后）
- ⏳ 审批闸（Agent 写操作人工审批）→ 未实现
- ⏳ 记忆时间轴（session 时间戳 + 压缩检查点）→ 未实现
- ⏳ 可视化编排拖拽（S7）→ 未实现

---

## 三、功能 2：全自动 Plan 执行器

**判定：完整实现（约 90%+）** — 13 个后端模块 + 2 前端入口 + 2 测试文件，约 4500+ 行。
README「Phase 0 待实施」的标注**不准确**。

> ⚠️ **安全风险提示（补充核实 2026-08-01）**：Plan 执行器存在两项使用者需知晓的风险——
> ① **脏工作树数据丢失**：`lib/plan-git.js` 在运行 Plan 时会开 `auto-<id>` 分支并对工作树做快照；若未提交改动且未传 `scope_paths`，`git add -A` 会把未跟踪新文件一并提交到 auto 分支，闭环 `git checkout -` 切回原分支后这些文件会从工作树消失（仍可经 `git checkout auto-<id> -- <file>` 找回）。**运行 Plan 前务必先 commit/stash。**
> ② **运行时拦截仅限直执轨道**：轨道 B（AI 聊天管线）不经 `evaluateStepSecurity` 运行时拦截（run-plan.js:1159-1177）。
> 详见第八节。

### 链路图

```
用户点击「执行 plan」（plan-view.js:587 / plan-drawer.js:365）
  → POST /api/plan/execute（routes/index.js:218 挂载）
  → plan-routes.js:99
      ├─ [可选] M3 前置讨论：runRoundtable()（discuss.js:252）+ 用户确认/超时自动继续
      ├─ [可选] 自然语言→Plan：generatePlanFromObjective()（plan-from-nl.js:284，真实 LLM）
      ▼
  runPlan()（run-plan.js:981）
      ├─ ① gatePlan()（plan-contract.js:45 可验证性闸门，manual acceptance 拒收）
      ├─ [重规划循环] runOneAttempt()（run-plan.js:1105）
      │     ├─ openPlanBranch()（plan-git.js:37，git checkout -b）
      │     ├─ [逐步] budget.tickRound() + checkInterception() + snapshotStep() + resolveCheckpoint()
      │     ├─ stepRequiresApproval() → WS 审批闸（plan-routes.js:42 pendingApprovals + 30min 超时）
      │     ├─ execStepDirectly()（run-plan.js:412 execSync 真实执行）
      │     ├─ runStepViaChatLLM()（run-plan.js:704 复用 nonStreamingChat + QCLI_TOOLS）
      │     ├─ runSingleTask()（workflow-manager.js DAG 执行）
      │     ├─ budget.checkLoop()（plan-budget.js:59 循环熔断）
      │     └─ [失败] rollbackTo()（plan-git.js:65 git reset --hard）
      ├─ runAcceptance()（run-plan.js:753，command/script/http/manual 四类）
      ├─ reflectPlan()（run-plan.js:834 done/partial/diverged 判定）
      ├─ [autoReplan] revisePlan()（plan-from-nl.js:512）+ 无进展早停 planStepSig()
      └─ sinkPlanToIndex()（plan-rag-sink.js:148 执行结果→RAG 索引）
```

### 关键证据

| 模块 | 状态 | 证据 |
|------|------|------|
| 前端入口 | ✅ | plan-view.js:587 + plan-drawer.js:365 |
| API 路由 | ✅ | routes/index.js:218 |
| 前置讨论 | ✅ | plan-routes.js:137-170 |
| NL→Plan | ✅ | plan-from-nl.js:284（llm-bridge.complete 真实调用，3 层容错） |
| Plan 校验 | ✅ | plan-schema.js:50 validatePlan() |
| 可验证性闸门 | ✅ | plan-contract.js:45 gatePlan |
| Checkpoint 圆桌 | ✅ | plan-contract.js:81 resolveCheckpoint（≤3 轮推导） |
| Plan→DAG | ✅ | plan-to-workflow.js:26 |
| DAG 引擎 | ✅ | workflow-manager.js:72（调度/依赖/并发/重试/角色转岗） |
| 命令直执 | ✅ | run-plan.js:412 execStepDirectly（Windows/WSL/Git Bash 自适应） |
| AI 管线执行 | ✅ | run-plan.js:704 runStepViaChatLLM |
| 预算守卫 | ✅ | plan-budget.js（tickRound + checkLoop 每步调用） |
| Git 快照/回滚 | ✅⚠️ | plan-git.js（真实 git CLI）— **脏工作树风险**：未传 `scope_paths` 时 `git add -A` 会把未跟踪新文件提交到 auto 分支，切回原分支后被从工作树删除（详见第八节） |
| 安全拦截 | ✅⚠️ | run-plan.js:141 checkInterception（静态+前置）+ run-plan.js:1159 evaluateStepSecurity **仅对直执轨道A生效**，AI 聊天轨道B 不经此运行时拦截（详见第八节） |
| 审批闸 | ✅ | plan-routes.js pendingApprovals + WS + 前端闸门卡片 |
| 验收/反思/重规划 | ✅ | runAcceptance / reflectPlan / revisePlan + classifyFailure |
| RAG 回流/召回 | ✅ | plan-rag-sink.js:148 + plan-rag-recall.js:63 |
| 单元测试 | ✅ | test/run-plan.test.mjs（9+ 用例）+ run-plan-retry.test.mjs（6+ 用例） |

### 剩余差距

1. **无独立 Scheduler 后台进程** — 执行需手动触发 `POST /api/plan/execute`，无自动轮询调度循环
2. **无显式 plan.md 磁盘持久化** — Plan 对象内存流转 + RAG index-store JSON，未落盘结构化 plan.md
3. **可补充集成测试** — 当前仅单元测试
4. **runtimeIntercept 条件性生效** — 仅直执模式生效（run-plan.js:1159-1177）

---

## 四、功能 3：AI 讨论（聊天面板）

**判定：完整可用** — 多轮交替发言真实发生，AI 助手与 CLI Agent 是**两个独立执行路径**（LLM API vs 本地子进程），通过 transcript 数组串联。**非自问自答**。

### 链路图

```
用户点「讨论」开关 → discuss-controls.js（开关/多选 Agent/轮数 1-12）
  → chat-panel.js:727-758 sendMessage({ discuss:true, partners:[...], maxTurns:N })
  → chat-api.js:142-149 POST body → fetch('/api/chat')
  → routes/chat/index.js:294-323 检测 discuss → runDiscussion()
  → discuss.js:252-359 runRoundtable()
      for round = 1..maxTurns（discuss.js:295）
        ① AI 发言：runAiTurn()（discuss.js:301）→ streamOpenAICore/streamAnthropicCore 真实 LLM 流
        ② 每个 CLI：runCliTurn()（discuss.js:321-324）→ agentPool.start → createHeadlessExec 真实子进程
        ③ 早停：/\[CONVERGE\]/ && round>=2（discuss.js:331）
      → runSummary()（discuss.js:337-345）+ generateFallbackSummary 兜底
```

### 4 个内置 CLI 的 HEADLESS 描述符（lib/cli-headless.js:42-50）

| CLI | 命令 | stdin 注入 | 备注 |
|-----|------|-----------|------|
| opencode | `opencode run` | ✅ | subcommand: 'run' |
| claude | `claude -p` | ✅ | args: () => ['-p'] |
| codex | `codex exec -` | ✅ | `-` sentinel |
| aider | `aider --yes-always --no-auto-commits --no-pretty --no-stream` | ✅ | |

- 全部走 headless（非 TTY）路径，从源头避免 TUI 渲染污染
- **Windows 安全设计**（cli-headless.js:33-38）：提示词一律 stdin 注入，绝不拼进 argv，规避 shell:true 参数分词
- 注释标记「均经实测」（cli-headless.js:32）

### 已知缺口

1. **测试覆盖严重不足**：`test/discuss-roundtable.test.mjs` 仅 3 项契约测试（导出形状/无 Key 安全/normalizeTranscript）；`plans/test-discuss.js` 7 项模块契约。**无行为级集成测试**（mock LLM + mock agentPool 的端到端、超时/中断/SSE 事件序列均未覆盖）
2. **运行时前置条件**：需安装对应 CLI Agent + 配置 API Key

---

## 五、功能 4：CLI Agent ↔ AI 双向互动

**判定：正向完备（5 条路径）、反向部分存在但架构受限。**

### A. 正向链路（AI → CLI Agent）✅ 确认存在且完备

| # | 机制 | 证据 |
|---|------|------|
| 1 | 同步委派 `agent_delegate` | routes/ai-tools/builtin/agent.js:239-294（阻塞至进程退出，不支持回呼） |
| 2 | 异步池 `agent_start/poll/send/cancel/list` | routes/ai-tools/builtin/agent.js:297-455 + agent-pool.js |
| 3 | 圆桌讨论 `discuss` | routes/chat/discuss.js |
| 4 | WebSocket `agent:launch` | ws/message-dispatch.js:213-292 |
| 5 | 工作流 `workflow_start/status/add_task` | routes/ai-tools/builtin/agent.js:481-643（DAG 编排） |

全部注册于 routes/chat/tools.js:120-125（SKIP_TRUNCATE_NAMES）。

### B. 反向链路（CLI Agent → AI）⚠️ 部分存在：`<cliq:ask>` 文本 sideband

**这是唯一反向通道，但非编程式反向调用**：

- **协议定义**：agent-callbacks.js:27-37 `CLIQ_ASK_PROMPT`（注入 Agent prompt）
- **注入时机**：仅异步路径（agent-pool.js:157-158），同步 agent_delegate 明确不支持（agent-callbacks.js:24-26）
- **扫描**：agent-callbacks.js:52-128 正则匹配 `<cliq:ask id="xxx">问题</cliq:ask>`，每 session 50 条上限
- **AI 感知**：agent_poll 内联返回 pendingCallbacks（agent-pool.js:303-316）
- **AI 回答**：agent_send 带 callbackId 写回 Agent stdin（agent-pool.js:335-361 + markAnswered）
- **主代理验证**：routes/ai-tools/builtin/agent.js:341/371/407/477 → pool.start/poll/send/callbacks 全链路路由确认

**为什么不是真正的反向通道**：

1. **无编程式 API 调用** — Agent 只能打印 XML 标签，不能调用 AI 的 read_file/exec_terminal/web_search 等工具
2. **无推送机制** — AI 必须主动 poll 才能发现 pending callbacks，无 webhook/WS push
3. **仅限异步路径** — 同步 agent_delegate 明确不支持
4. **依赖 LLM 遵从** — Agent 必须「知道」协议并正确输出格式化标签
5. **单向且被动** — Agent 只能问问题等答案，不能触发 AI 执行任务

**架构根因**：CLI Agent（opencode/codex/aider）是第三方无头进程，经 stdin/stdout 管道通信，无 WS/HTTP client 能力，不知道 Hesi MCP server 或 REST API 存在。全仓库搜索确认无 webhook/回调 URL/反向 HTTP 机制。

### C. 可复用的打通基础（由易到难）

| 方案 | 复用基础 | 成本 |
|------|---------|------|
| ① 演进 `<cliq:ask>` 为结构化 JSON sideband | agent-callbacks.js（高复用） | 低 |
| ② Agent 作为 MCP client 连入 Hesi MCP server | mcp-server.js + mcp/index.js（中） | 中 |
| ③ Agent 内嵌 HTTP 回调 | 新增 `/api/agent-request` 路由 + prompt 告知 curl | 中 |
| ④ Context Store 消息总线 | ws/context-store.js pub/sub（高复用，digital-employee.js:124-161 已有 Agent→Human 闭环可参考） | 低-中 |
| ⑤ 文件系统请求队列 | data/agent-requests/ + watch | 最低但延迟高 |

---

## 六、交叉发现（跨功能问题）

1. **README 标注误导**：README「Phase 0 待实施」与 Plan 执行器实际实现不符（已实现 90%+）；docs/roundtable.md 的「落座接管待办」也与代码不符（已实现）
2. **测试覆盖整体偏契约**：四功能均有单元/契约测试，但缺行为级集成测试（mock LLM + mock agentPool 的端到端、超时/中断/SSE 事件序列）
3. **反向链路测试真空**：`test/` 无 agent-callbacks 专项测试；`plans/test-discuss.js` 无 cliq:ask/callback 用例 —— 唯一反向通道处于无回归保护状态
4. **共享执行引擎**：圆桌讨论、AI 讨论、数字员工（digital-employee-worker.js）、Plan 执行器均复用同一个 agentPool 实例与全局并发配额（agent-concurrency.js），架构合理非耦合问题

---

## 七、建议汇总（按优先级）

### P0（文档与事实对齐，零代码）
1. 更新 README：删除/修订「Phase 0 待实施」，标注 Plan 执行器已实现
2. 更新 docs/roundtable.md：落座接管标记为已实现
3. [安全] Plan 执行器补充安全警告：运行 `POST /api/plan/execute` 前必须 `git stash`/`commit` 干净工作树，或强制传入 `scope_paths`，否则 `lib/plan-git.js` 在脏工作树会把未跟踪新文件从工作树抹除（详见第八节）
4. [方法论] 功能报告须标注「验证层级 L0–L3」，当前全部结论达 L0/L1/L2/L3（L3 已由用户 2026-08-01 确认：圆桌落座接管、AI 讨论等 UI 重交互已浏览器实测）

### P1（补测试，保护现有功能）
3. 为 `<cliq:ask>` 反向通道补专项测试（agent-callbacks scan/list/markAnswered 边界）
4. 为讨论/圆桌补行为级集成测试（mock LLM + mock agentPool：多轮 transcript、超时、中断、SSE 事件序列）
5. 为 Plan 执行器补集成测试（当前仅单元测试）

### P2（功能增强）
6. 反向链路方案 ①：演进 `<cliq:ask>` 为结构化 JSON + 同步模式支持（最低成本、收益最大）
7. 若需全自动：新建轻量 Scheduler 轮询脚本（README 路线图唯一常驻件缺失项）
8. 可选：Plan 收敛为显式 plan.md 磁盘持久化（对齐 README 愿景）

---

## 附：核实方法与证据来源

- 4 个独立 explore 探索报告（圆桌/Plan 执行器/AI 讨论/双向互动）
- 主代理精读：discuss.js（403 行全文）、agent-pool.js（547 行前半）、agent-callbacks.js（231 行全文）、routes/ai-tools/builtin/agent.js 工具路由、stream-openai/anthropic 核心
- 测试清单扫描：test/*.mjs（28 个文件）+ plans/（5 个回归套件）
- 本记录为只读核实，未修改任何代码

---

## 八、补充核实建议（2026-08-01 复核）

> 本节为对原核实记录的补充，基于对当前 main（`de39f4a` = v0.6.4，与 `F:\Hesi-0.6.4` 快照一致）的真实源码精读复核。复核中纠正了原记录的路径误引（`builtin/agent.js`→`routes/ai-tools/builtin/agent.js`、`stream-openai/anthropic.js`→`routes/chat/`），其余 Plan 子模块在记录中以省略目录的简写出现（如 `plan-contract.js`、`run-plan.js`），其规范目录见 8.5。

### 8.1 验证层级方法论（最关键）
原记录全篇「✅ 完整可用 / 完整实现」均基于**静态只读代码核实**（记录第 252 行自陈）。这意味着结论是「代码路径闭合」，不等于「运行时可用」。
建议在功能报告与对外表述中显式标注验证层级：
- **L0 代码闭环**：静态确认代码路径闭合（本次全部达成）
- **L1 单测通过**：有对应单元/契约测试
- **L2 curl 实测**：球总用 curl 冒烟过闸门/拦截/反思（仅局部）
- **L3 浏览器实测**：UI 交互在浏览器实测

特别提示：圆桌「落座接管」（discuss.js:169-179 + roundtable-view.js:466-510）代码已实现，且**已于 2026-08-01 经用户确认通过 L3 浏览器实测**，可表述为「已验收可用」。

### 8.2 安全盲区：plan-git 脏工作树会抹除未提交文件（原记录完全未提）
`lib/plan-git.js` 链路：
- `openPlanBranch`（:37）→ `git checkout -b auto-<id>`，**从脏工作树切出**
- `snapshotStep`（:48）未传 `scope_paths` 时 → `git add -A`（把**未跟踪新文件**也 staged）
- 在 auto 分支 commit
- `closeBranch`（:71）→ `git checkout -` 切回原分支

**后果**：切回原分支后，未跟踪的新文件被从工作树删除（仅存于 auto 分支的那个 commit），已修改的跟踪文件也回退到原分支 HEAD。使用者不翻 `git reflog` / 执行 `git checkout auto-<id> -- <file>` 难以找回。

**建议**：
1. 功能报告/文档明确「运行 Plan 前必须 commit/stash 干净工作树」或「务必传 `scope_paths`」；
2. 代码侧可让 `openPlanBranch` 在检测到脏工作树时**拒绝启动**或**强制要求 `scope_paths`**（此为待拍板的 P0 方案，见 `.workbuddy/plan-git-脏工作树数据丢失-方案.md`）。

### 8.3 runtimeIntercept 仅直执生效 → 应升为安全旗标
已确认 `routes/ai-tools/run-plan.js:1159-1177`：`evaluateStepSecurity` 仅当 `evalCmd && !willUseChatPipeline`（轨道 A 直执）时执行，**轨道 B（AI 聊天管线）不走这道运行时拦截**。原记录「剩余差距 #4」轻描淡写，但与同表「安全拦截 ✅⚠️」行直接矛盾。建议：
- 升级表述为安全旗标；
- 核实轨道 B 的 `executeToolCall` 工具级检查是否真能兜住同等风险（原记录未验证，仅代码注释声称）。

### 8.4 execStepDirectly 为阻塞式 execSync
确认 `routes/ai-tools/run-plan.js` 用 `execSync`/`execFileSync`（:425/589/599/606/612/620/623），受 `STEP_TIMEOUT_MS` 约束。但 `execSync` **阻塞 Node 事件循环**：长命令执行期间，整个 Hesi 服务（聊天、圆桌、共享 agentPool 的其他 Plan）会一起假死。建议作为 P2 架构注记（必要时改为 `spawn` + 流式回传）。

### 8.5 目录前缀补全（提升「文件:行号」可信度）
原记录部分后端模块以省略目录的简写出现；以下为 v0.6.4 的**规范位置**，便于导航：

| 记录中简写 | 实际位置 |
|-----------|---------|
| `plan-contract.js` / `plan-from-nl.js` / `plan-rag-sink.js` / `plan-rag-recall.js` / `plan-to-workflow.js` / `plan-schema.js` / `workflow-manager.js` / `plan-routes.js` / `run-plan.js` / `agent-pool.js` / `agent-callbacks.js` | `routes/ai-tools/` |
| `builtin/agent.js`（已就地修正） | `routes/ai-tools/builtin/agent.js` |
| `stream-openai.js` / `stream-anthropic.js`（已就地修正） | `routes/chat/` |
| `discuss.js` | `routes/chat/discuss.js` |
| `plan-git.js` / `plan-budget.js` / `cli-headless.js` | `lib/`（原记录正确） |
| `ws/message-dispatch.js` / `ws/context-store.js` / `digital-employee.js` / `digital-employee-worker.js` | `ws/`（原记录正确） |

### 8.6 本地 LLM / 超时兼容未覆盖
球总实测环境为 LM Studio `http://127.0.0.1:1234/v1` 的 `qwen3.5-4b-vlm`（推理模型，长输出易超默认 5min 超时）。原记录「完整可用」未区分「云端模型验证过」还是「本地模型也跑通」——而本地模型才是真实运行时。建议补充：NL→Plan（plan-from-nl.js 真实 LLM）、圆桌/AI 讨论在本地推理模型下的超时与内容提取表现。

### 8.7 复核确证点（给原记录背书）
- **「反向链路测试真空」（六.3）确证**：`test/` 在两个树（H:\Hesi 与 F:\Hesi-0.6.4）均无 `callback*` 测试，原记录未冤枉。
- **gap #4 runtimeIntercept 条件性生效** 确证（见 8.3）。
- **版本有效性**：当前 `H:\Hesi` HEAD = `de39f4a` = v0.6.4，与 `F:\Hesi-0.6.4` 快照一致，记录仍对应当前 main，无版本漂移。建议文档头补一行 commit SHA 便于将来重验。
