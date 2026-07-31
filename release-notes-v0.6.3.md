# Hesi v0.6.3 — 三大半吊子功能打磨完整（RAG 闭环 / 多角色讨论 / 自动重试）

> 基线：v0.6.2（Plan 执行稳定性 + 可配置化）。本版聚焦「v0.6.2+ 三功能从半吊子打磨到商业化级可用」：
> 执行记录可搜索（RAG 闭环）、多角色讨论方案再动手（生成前置）、干坏了自动重试（autoReplan 打磨）。
> 全部新默认行为均经 `HESI_PLAN_*` 环境变量 gate（**默认关闭/最低风险**），不干扰既有稳定链路。
> 按「实测后上线」纪律：每个里程碑独立 commit，AI 全权实施 → 球总逐步实测 → 通过后发布。

## 模块 A：执行记录可搜索（RAG 闭环）

把原本「写入端有、读取端零调用」的空壳回流，打磨成端到端可用的检索与历史管理。

### A1 检索服务 + 历史列表 UI（M1）
- 新增 `routes/ai-tools/plan-rag-recall.js`：`recallPlans(q, {topK, type:'plan'})`（BM25，带 title 加权与 `type` 过滤）、`listPlans({limit, offset, status})`、`deletePlan(ref)`、`clearPlans()`。
- 新增路由（均 gate by `HESI_PLAN_RAG_SINK !== '0'`）：
  - `GET /api/plan/history` → 历史列表（按 `updatedAt` 倒序）
  - `GET /api/plan/history/search?q=` → 关键词召回
  - `DELETE /api/plan/history/:ref` → 精确删除
- Plan 页 `public/plan.html` + `public/plan-view.js`（**原生加载、免 bundle 重建**）新增「📚 历史 Plan」标签：列表（标题/时间/状态/耗时）、搜索框、点击展开步骤与结论、`删除`/`重新执行`（回填 Plan JSON 到输入框）。

### A2 回流增强 + 失败也回流（M1/M2）
- `routes/ai-tools/plan-rag-sink.js` 重构：
  - `buildPlanDocText` 扩展为结构化（执行元信息 + 每步 `action`+`status` + 产出）。
  - **稳定 ref**：优先 `plan.id`；缺失时回退 `plan:<content-hash(objective+steps)>`，更新而非新增、不互相覆盖。
  - **失败 Plan 默认也回流**（A3 决策：默认回流）：`sinkMode` 区分 ok/failed，受 `HESI_PLAN_RAG_SINK_FAILED`（默认 `1`）控制。
  - **上限截断**：单 doc text 超 4096 字符截断，防止撑爆索引 JSON（P-A2）。
  - **容量清理**：写入前检查容量，超限删最旧；上限受 `HESI_PLAN_INDEX_MAX`（默认 `500`）控制（P-A3/A5）。

### A3 聊天召回 + 隐私闸（M2）
- `routes/chat/index.js` 新增分支：当 `HESI_PLAN_RAG_RECALL==='1'` 时，调用 `recallPlans(lastUserText, {topK:3})`，把命中摘要作为**独立 system block**（明确标注「历史执行记录」，不与记忆块混淆）注入；仅命中分数超过阈值时注入、不覆盖原记忆、失败静默跳过（P-A1/A7）。
- **默认 OFF**（决策：防污染）；仅 Plan 页列表可见，用户显式开启才进对话（P-A7）。

### A4 隐私脱敏（M2）
- 新增 `redact(text)`：对 action 命令中的绝对路径用户段（`/home/xxx`、`/Users/xxx` 等）+ 高熵密钥模式（`sk-...`、明显 token）做轻量打码，受 `HESI_PLAN_RAG_REDACT`（默认 `1`）控制（P-A6/A7）。
- 只打码前缀与密钥，保留命令结构，提供关闭开关。

## 模块 B：多角色讨论方案再动手（生成前置）

把圆桌引擎从「仅用于 checkpoint 推导验收」接入「Plan 生成前置」，让用户能「先讨论再动手」。

### B1 前置讨论链路（M3）
- `routes/ai-tools/plan-routes.js` `/execute` 新增：`discussBeforePlan`（bool）、`discussTemplateId`、`discussMode: 'auto'|'confirm'`（默认 `confirm`）、`discussMaxTurns`。
- 开启且 partners/template 存在时，先在 `generatePlanFromObjective` **之前**跑 `runRoundtable`，把 `summary+transcript` 作为 `discussionContext` 注入生成。
- **confirm 模式**（默认）：讨论结论经 WS 广播 `plan:discussion-result`，**暂停**生成，等用户点「据此生成 Plan」才继续；`auto` 则直接继续（B2 决策：默认 confirm，用户把关）。

### B2 生成器注入讨论结论（M3）
- `generatePlanFromObjective(text, runtime, { discussionContext })`：在 userMsg 追加「【多角色讨论结论（仅供参考，须对齐原始目标）】…【原始目标】…请据此产出 Plan」。
- 讨论上下文过长截断（≤ 6KB，B3 防烧 token）。

### B3 失败兜底与可追溯（M3）
- 讨论引擎无 key / 无 partner / 超时 → 自动降级为「直接生成 Plan」并提示，不阻断（B6）。
- 讨论 transcript 随 Plan 一起回流（模块 A 的 sink），历史回看「当时为什么这么定」（B5）。

## 模块 C：自动重试策略打磨（autoReplan）

把反思重规划环从「触发窄、轨迹不透明」打磨成可商用、可观测、可控熔断。

### C1 失败分类（M4）
- `run-plan.js` 新增 `classifyFailure(stepResult)` → `retryable | fatal`。
  - **可重试**：`timeout` / `network` / `command-not-found` / 临时 `exit-nonzero` / `blocked`（运行时拦截/越界/禁用——可由修订转为合法命令）。
  - **不可重试（fatal）**：`permission` / `syntax` / 明确逻辑错误——直接 `rejected` + `fatalReason`，避免「假装修好」（P-C2）。
- 触发面扩大：除 `diverged`/占位符外，存在 `retryable` 失败 step 也进修订环（C1/C2）。

### C2 重试上下文增强（M4）
- `revisePlan(prevPlan, prevResult, runtime, failureContext)` 新增第 4 参 `failureContext`：把「第几步失败、错误类型、最后输出」拼入 userMsg，让修订 LLM 有的放矢（C2）。

### C3 可配置多级 + 封顶（M4）
- `maxRetries` 解析顺序：`body` > `plan` > `HESI_PLAN_MAX_RETRIES`（默认 `2`）> 旧默认 `1`；**封顶 5** 防失控（C3 决策：默认 2）。

### C4 成本熔断 + 无进展早停（M4）
- 相邻两次修订 Plan 的 `steps` 结构签名（`planStepSig`）比对；连续两次相同视为无进展 → 早停 `rejected`（P-C1/C7）。

### C5 轨迹透明（M4）
- 反思环构建 `attempts[]`（`{ n, planId, status, kind, reason, revised }`）。
- 前端 `plan-view.js` 新增 `renderAttempts(attempts)`：渲染「首次执行 / 第 N 次重试 · 状态 · 原因 · 已修订」时间线，消费 `result.attempts`（C5）。

### C6 审批闸复用（M4）
- 同一 `runPlan`（同一 execId）内重试**复用**已审批步骤结论（`opts.approvedSteps` Set），不重复弹审批；仅首次/最终需人决（P-C4）。

### 失败静默降级（全局原则）
- RAG / 讨论 / 重试任意一环失败，**绝不**阻断主流程（已有先例：`sinkPlanToIndex` 失败不影响执行）。

## 新增/增强测试（M5a）
- `test/plan-rag-sink.test.mjs`（增强）：稳定 ref（业务 id vs hash）、失败 Plan 默认回流（env 关闭验证）、脱敏、容量上限（实时 env）。
- `test/plan-rag-recall.test.mjs`（新增）：sink+listPlans 倒序、status 过滤、BM25 type 过滤召回、deletePlan、clearPlans。
- `test/plan-discuss-before.test.mjs`（新增）：`discussionContext` 注入「多角色讨论结论」块、无则不注入；`failureContext` 注入「上次执行失败详情」块、无则不注入。
- `test/run-plan-retry.test.mjs`（新增）：retryable 触发 autoReplan 成功+attempts 结构、fatal 不重试直接 rejected、无进展早停、C6 仅 1 次审批、maxRetries 封顶。

## 验证（M5b）
- 全量测试：`.mjs` + `.js` 套件跑通；ESLint 0 error。
- 预存独立测试债（与本版无关）：`compaction:169`（`degrades to keep-raw when LLM unavailable`）为 compaction 模块既有债，不在本版 scope；`run-plan.test.mjs` 含 20 个真实 git 集成测试（≈45s）属历史遗留耗时项，与本版改动无关。

## 升级注意（环境变量总览）
| 变量 | 默认 | 作用 |
|---|---|---|
| `HESI_PLAN_RAG_SINK` | `1`（开） | 总开关：回流 + 历史 API 是否启用 |
| `HESI_PLAN_RAG_SINK_FAILED` | `1` | 失败 Plan 是否也回流 |
| `HESI_PLAN_RAG_REDACT` | `1` | 回流内容脱敏（路径/密钥打码） |
| `HESI_PLAN_INDEX_MAX` | `500` | 索引容量上限（超出删最旧） |
| `HESI_PLAN_RAG_RECALL` | `0`（关） | 聊天召回历史 Plan（默认关，防污染） |
| `HESI_PLAN_MAX_RETRIES` | `2`（封顶 5） | 自动重试次数上限 |
| `HESI_PLAN_DISCUSS_MODE` | `confirm` | 前置讨论后：用户确认再生成 / 自动生成 |

- 历史 Plan 列表：Plan 页「📚 历史 Plan」标签，开箱即用（受 `HESI_PLAN_RAG_SINK` 控制）。
- 聊天召回历史：需显式 `HESI_PLAN_RAG_RECALL=1` 并重启。
- 前置讨论：Plan 页高级面板「🤝 先圆桌讨论方案」开关 + 模板下拉。

## 商业化前置风险（红线，待处置）
- `edge-tts`（AGPL-3.0）与 `vendor/connectors/awesun`（Oray 残留）仍按 MEMORY 红线：商业化前须处置。
- `vendor/connectors`（62 SaaS）禁止删减/瘦身/`.gitignore`（离线导入必需）。
