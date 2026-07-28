# Hesi v0.5.2 发布说明

本版本聚焦**全自动 Plan 执行器（Phase 0 MVP）**落地，并修复了 TTS 段落停顿问题。

## ✨ 新功能：全自动 Plan 执行器（Phase 0 MVP）

把「多 agent 圆桌辩论 → 结构化可审计 Plan → 本地执行治理」串成一条闭环：

- **可验证性闸门（决策①）**：Plan 的 acceptance 必须可机器验证（command / http / script），纯 `manual` 直接拒收并提示缺哪些项。
- **git 分支快照 + 回滚（决策④）**：执行前开 `auto-<id>` 分支，每步前 `git commit` 做锚点；某步失败自动 `git reset --hard` 回滚到本步快照，爆震半径锁在分支内，`main` 不被污染（未装 git 或 git 不在 PATH 时优雅降级、不崩溃）。
- **scope / forbidden 拦截（决策③）**：`scope_paths` 之外的路径、`forbidden` 命令清单里的指令，步前静态拦截（`blocked`），外部副作用默认全禁。
- **预算熔断（`PlanBudget` + `TOOL_LOOP_GUARD`）**：按 `budget.maxRounds/maxTokens/maxMinutes` + 连续重复调用熔断，防止跑飞。
- **checkpoint 软断点（决策②）**：标记为 `checkpoint` 的步骤会转圆桌 N 轮（默认 3）推导可验证 acceptance，仍不行兜底回拒收。
- **验收 + 反思**：跑完 acceptance 命令（command/script 走 `sh`，http 走 `fetch`）后，`reflectPlan` 判定 `done / partial / diverged`。
- **后端**：`POST /api/plan/execute`（挂载于 `/api/plan`）。
- **前端**：`public/plan.html` 独立页面（Plan 编辑/示例/格式化/▶执行/逐步结果/反思面板），侧栏「📋全自动」入口。
- **文档**：`docs/plan-execution-guide.md` 完整使用说明（协议字段表、安全模型、流程图、API 参考、本地 LLM FAQ、Phase 0 局限、Phase 1 路线）。

> 测试：新增 `test/run-plan.test.mjs`(9) + `test/plan-routes.test.mjs`(3)，用 mock 的 workflowManager / roundtableFn，不依赖真实 LLM；全量测试保持绿、lint 0 error。

## 🔧 修复：TTS 段落停顿

- **完全消除段落后的停顿**：Edge TTS 与 Web Speech 两路都把连续换行（空行）替换为空格，段落之间不再有停顿（`lib/tts/edge-tts.js` + `public/voice-output.js`）。

## ⚠️ 已知局限（Phase 0 故意范围外）

- Plan 由**人工粘贴 JSON** 输入，无 LLM 自动出图（auto-Planner 列入 Phase 1 / 0.6.0）。
- `reflectPlan` 仅判定状态，**无「读结果→改 DAG→重跑」的反思重规划环**（列入 Phase 1）。
- RAG 快照未回流 `index-store`（列入 Phase 1，复用既有 BM25，零新增依赖）。
- scope/forbidden 为**步前静态扫描**，非运行时逐工具强制拦截（列入 Phase 1，接 `mcp/security/policy.js`）。

## 升级提示

从 v0.5.1 直接拉取即可，无破坏性变更。想体验执行器：起服务后访问 `/plan.html`，先用示例 Plan 验一遍无害流程最稳。
