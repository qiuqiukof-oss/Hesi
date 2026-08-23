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

## 本轮补丁：Plan 执行全链路商用级打磨（v0.6.1 发布后修复）

针对实际部署中暴露的 Plan 执行问题，逐轮修复并验证：

- **占位符步骤不再假成功**：LLM（轻量 flash 模型）偶发返回空壳步骤（`goal=action="步骤 N"`），旧版静默标记为 done（假成功）。现改为返回 `error` + 明确诊断提示（模型不稳定/API 配置有误/网络截断）。
- **严格闸门 Fast Fail**：恢复备份版 `isMachineVerifiable` 严格逻辑——空/manual acceptance → `gatePlan` 立即拒收（不再进入「执行→错误→重试→错误」的慢循环）。`resolveCheckpoint` 无 roundtableFn 恢复严格阻塞。
- **heredoc 单行兼容**：`cat > file << 'EOF'content...EOF`（flash 模型常把 heredoc 内容输出在同一行）现在能正确匹配并用 Node.js `fs.writeFileSync` 原生写入，绕过 shell 依赖（PortableGit 缺 coreutils 也不怕）。
- **路径拦截去误判**：`_pathTokens` 恢复排除相对路径、保留绝对路径；`resolveProjectRelativePath` 简化仅处理 `/` 开头项目相对路径；`inScope` 双边盘符+分隔符归一化。
- **autoReplan 保留**：占位符检测自动启用 autoReplan（maxRetries=1）作为保护网，正常输出时 2 轮重试可恢复执行。
- **反思环修订失败明确化（内部 AI 检查报告问题2 修复）**：`revisePlanFn` 抛异常时不再返回误导性的 `partial`，而明确升级为 `rejected` + 原因「autoReplan 修订失败…」，避免用户误判为「部分成功」。
- **测试债清理**：`run-plan.test.mjs` 4 个遗留 fail（之前恢复严格闸门时断言未同步 + 被测试超时掩盖）已修正——checkpoint 无 roundtableFn → 整 plan `diverged`（退回需人补充 acceptance）；`_pathTokens` 排除相对路径 → 越界测试改用绝对路径。
- **验证**：`.mjs` 套件 226 通过 / 0 失败；`.js` 套件 436 通过 / 1 失败（仅 compaction 模块独立测试债，与 Plan 执行无关）；ESLint 0 error。

## 顺延（后续 P1 切片）
- 反思重规划环（受 PlanBudget 熔断后自动 replan）
- RAG 快照回流 index-store
- 运行时逐工具强制拦截（接 `mcp/security/policy.js`）

## 验证
- 启动后访问 `/plan.html`，在「自然语言目标」框输入目标并填写「高级」里的 API Key/模型，点「▶ 执行 plan」。
- 后端：`curl -X POST localhost:4264/api/plan/execute -H 'Content-Type: application/json' -d '{"objective":"在 README 顶部加构建状态章节","apiKey":"...","model":"gpt-4o"}'`
