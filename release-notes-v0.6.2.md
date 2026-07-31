# Hesi v0.6.2 — 低风险增强包（Plan 执行稳定性 + 可配置化）

> 基线：v0.6.1（Plan 执行全链路稳定）。本版为「低风险增强包」，无结构性变更，向后兼容。

## 核心变更

### ① 审批超时支持 per-plan 配置（B4）
- `POST /api/plan/execute` 现在支持 `body.approvalTimeoutMs` 或 `plan.approvalTimeoutMs`，
  覆盖默认的 30 分钟审批闸超时。大型多步重构可单独调长，避免被误驳回。
- 回退链：`body.approvalTimeoutMs` → `plan.approvalTimeoutMs` → 路由工厂注入值 → 30min 默认。
- 向后兼容：不传任何值则行为与 v0.6.1 完全一致。

### ② Workflow 并发限制可配置（B5）
- `MAX_WORKFLOWS`（默认 20）、`WF_TIMEOUT_MS`（默认 30min）从环境变量读取：
  - `HESI_MAX_WORKFLOWS`：最大并发工作流数
  - `HESI_WF_TIMEOUT_MS`：工作流总超时（毫秒）
- 去掉硬编码到具体部署环境的常量，符合「杜绝硬编码」原则；不设则保留原默认值。

### ③ 清理 compaction 测试债（C6）
- `lib/memory/compaction.js` 的 `compactIfNeeded` 在 LLM 不可用（缺 Key/网络/超时）时改为
  **优雅降级为 keep-raw**（`{ degraded: true }`），不再抛出 `NO_API_KEY`。
- 修复了 `routes/chat/index.js:355` 在无 `.catch` 情况下 await 本函数时被 LLM 异常崩溃对话流的隐患。
- 验证：`test/memory-compaction.test.js` 全部通过（含 `degrades to keep-raw when LLM unavailable`）。

### ④ 运行时逐工具强制拦截（A2 · 已存在功能，本版补测试覆盖与确认）
- v0.6.1 已实现并接线：`run-plan.js` 在 `runtimeIntercept` 开启时（fullAuto/env/显式 flag）对每个步骤命令
  经 `mcp/security/policy.evaluateAiExec` 进行 allowlist + destructive-deny 拦截（默认 blocklist 仅拦破坏性命令）。
- 本版确认该接线有效，并复用既有测试（`runtimeIntercept 开启：危险 action 被拦截 / 合法命令不被误拦 / 危险 acceptance 被拦截`）。

## 验证
- 全量测试：`.mjs` 227 通过 / 0 失败；`.js` 438 通过 / 0 失败。
- ESLint 0 error。
- 新增测试：`plan-routes.test.mjs` 的「body.approvalTimeoutMs 覆盖默认 30min」。

## 升级注意
- 无破坏性变更；审批闸/并发行为默认值不变。
- 如需调并发上限，设 `HESI_MAX_WORKFLOWS` / `HESI_WF_TIMEOUT_MS` 后重启服务。
- 如需按 Plan 调审批超时，提交 plan 时带 `approvalTimeoutMs` 字段。

## 附：本地模型（Plan 生成）兼容性修复（用户实测发现，本版一并修复）
> 适用范围：Plan 页面的「自然语言 → Plan 生成」走独立的 `lib/memory/llm-bridge` 通道（与聊天通道分离）。

### ⑤ 超时从硬编码 120s 改为可配 + 重试（`38d7b9e`）
- **问题**：本地模型（Qwen3 等）生成 Plan 的长 JSON 常超 2 分钟，原硬编码 `AbortSignal.timeout(120000)` **无重试**直接抛 `The operation was aborted due to timeout`。
- **修复**：
  - 超时读 `HESI_LLM_API_TIMEOUT_MS`，默认 **300000（5 分钟）**，与聊天通道同环境变量。
  - 新增 `_fetchWithRetry`：仅对 `AbortError`（超时）/ `TypeError`（网络抖动）自动重试 **2 次**（指数退避 1s→2s），可用 `HESI_LLM_BRIDGE_RETRIES` 覆盖。

### ⑥ 内容提取兼容推理模型（`7e31ea9`）
- **问题**：超时修复后 HTTP 200 成功，但 `_extractOpenAIContent` 提取不到文本（Qwen3 推理模型返回格式非标准）。
- **修复**：新增提取路径
  - `message.reasoning_content`（vLLM/llama.cpp 常用非标准字段）
  - content 数组中 `type: thinking/reasoning/thought` 块
  - 兜底：数组中任意含文本值的块
  - 全路径失败时记录完整响应结构诊断（`[LLMBridge]` 前缀日志）
  - 前端错误信息附带 `content` 类型（string/array/null）便于定位

### 本地模型调优建议
- 若仍偶发超时：启动加 `HESI_LLM_API_TIMEOUT_MS=600000`（10 分钟）。
- 若报「模型返回空响应」：看 Hesi 终端 `[LLMBridge]` 诊断日志贴回，可进一步精确适配。
