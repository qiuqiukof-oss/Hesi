# v0.6.2 — 全自动 Phase 1 闭环 + Plan 执行修复 + 模块精简

## ✨ 新功能 / 改进

### 全自动 Phase 1 四件套（②③④）
- **② 反思重规划环**（`plan-from-nl.js` `revisePlan`）：Plan 首跑 diverged/partial 时，自动基于执行结果修订并重试（`autoReplan` 开关，默认关闭，`maxRetries` 可配）
- **③ RAG 快照回流**（`plan-rag-sink.js`）：每次 Plan 执行完成自动回流到本地 index-store，聊天可召回历史 Plan
- **④ 运行时逐工具强制拦截**（接 `mcp/security/policy.evaluateAiExec`）：开启后每个步骤 action 经安全策略评估，危险命令被拦截为 `blocked`。默认关闭

### Plan 执行器：双轨制修复（🔧 关键 Bug 修复）
- **根因**：LLM 生成的 Plan 步骤缺少 `agentId` → workflow manager 调用 `agentPool.start(undefined, ...)` → 注册表查不到 → 整步 FAILED → partial (0/1)
- **轨道 A — 直执模式**：`action` 是 shell 命令时（如 `echo`、`npm run build`、`mkdir`），绕过 agentPool 直接 `execSync` 执行。Windows 下优先 sh（Git Bash），降级 cmd
- **轨道 B — Agent 模式**：自然语言指令型步骤，自动从 CLI registry 取首个可用 Agent 作为 `defaultAgentId`
- **LLM Prompt 优化**：`plan-from-nl.js` SYSTEM_PROMPT 强烈建议生成 `type:"command"` + 具体 shell 命令，提高直执命中率
- 新增导出：`execStepDirectly()`、`shouldExecDirectly()`

### Plan UI：聊天侧边抽屉（#plan-embed）
- 复用 Q.ChatAPI 同源 LLM 设置（与 AI 助手完全一致，不再有独立配置问题）
- 执行结果：状态卡片 + 反思概览 + 逐步详情（含 checkpoint/快照/输出）
- 错误提示优化：rejected/diverged 给出 💡 可操作建议
- 高级面板：API Key 自动填充（同源 fallback）

## 🗑️ 删除模块
- **stocks + quant**（15 文件）：股票分析 + 量化交易，scope-creep 清理
- **multimedia**（6 文件）：多媒体画廊/预览（`media.html`、`multi-media.js`、`media-preview.js`、`media.css`、`media-preview.css`），Agnes 已替代功能
- lazy-bundle 从 250.9kb → **210.5kb**

## 🔧 工程改进
- **check:server** glob 重构（`scripts/check-server.mjs`）：递归扫描 server `.js` 226 文件（原 40+）
- 前端 bundle 重建（`build:lazy`）

## 📊 测试 & 质量
- 全量 **157 测试通过**，0 失败
- ESLint **0 error**
- 新增冒烟验证：`execStepDirectly` / `shouldExecDirectly` / `planToWorkflowTasks(defaultAgentId)` 传导

## ⚠️ 已知限制
- 直执模式依赖 `sh`（Git Bash）或 Windows `cmd`；纯环境无 shell 时 Agent 型步骤仍需可用 Agent
- 反思重规划环 / 运行时拦截默认关闭（需显式开启避免回归）
- edge-tts AGPL-3.0 与 awesun Oray 残留风险（商业化前须处置）
