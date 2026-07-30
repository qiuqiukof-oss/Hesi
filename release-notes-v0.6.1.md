# Hesi v0.6.1 — 全自动 Phase 1 · auto-Planner（自然语言驱动）

## 核心新增
- **用自然语言描述目标即可生成 Plan**
  - 全自动执行器页面（`/plan.html`）新增「自然语言目标」输入框。填了目标就交给 AI 自动拆解成结构化、机器可验证的 Plan；留空则仍可手写 Plan JSON。
  - `POST /api/plan/execute` 支持 `body.objective`（字符串）。后端 `routes/ai-tools/plan-from-nl.js` 复用 `lib/memory/llm-bridge.complete`（openai / anthropic 通用），产出符合 `plan-schema` 的 plan，直接进入既有 `gatePlan → runPlan → 圆桌/过闸` 流水线，不改动执行引擎。
  - 兼容「高级」里的 API Key / Provider / BaseURL / Model / Partners，与手写 Plan 完全一致。
- **健壮的生成与降级**
  - 模型返回被 ```json 围栏包裹或夹带解释文字时，自动抽取 JSON。
  - plan 结构校验失败会自动带错误反馈重试一次；仍无效则返回明确错误（`code: GEN_INVALID` + 具体错误项）。
  - 缺 API Key / 模型未配置 / 模型调用失败 → 友好提示（`code: GEN_FAILED`），引导填 Key 或改手写 JSON。
- **测试**：新增 `test/plan-from-nl.test.mjs`（7 用例，注入 fake LLM caller 覆盖 正常生成 / 模型返回 null / 校验失败修复重试 / 修复后仍无效）。全量测试 146 绿 / 0 失败，eslint 0 error。

## 顺延（后续 P1 切片）
- 反思重规划环（受 PlanBudget 熔断后自动 replan）
- RAG 快照回流 index-store
- 运行时逐工具强制拦截（接 `mcp/security/policy.js`）

## 验证
- 启动后访问 `/plan.html`，在「自然语言目标」框输入目标并填写「高级」里的 API Key/模型，点「▶ 执行 plan」。
- 后端：`curl -X POST localhost:4264/api/plan/execute -H 'Content-Type: application/json' -d '{"objective":"在 README 顶部加构建状态章节","apiKey":"...","model":"gpt-4o"}'`
