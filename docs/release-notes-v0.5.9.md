# Hesi v0.5.9

> 打磨季开篇——去冗余、修 bug、为全自动铺路。全量 **139** 测试绿、lint 0 error。

本版本按「分阶段小发布」策略，先交付清理与稳定性底座；全自动 Phase 1（auto-Planner / 反思重规划环 / RAG 回流 / 运行时逐工具拦截）、圆桌画廊 UI、讨论衔接将在 **v0.6.0+** 陆续发布。

## 🧹 去冗余（Cleanup）

- **D1** 删除一次性 esbuild 运行时装配验证脚本 `scripts/verify-chat-panel-runtime.cjs`（README 无引用）。
- **D3** release-notes 治理：纳入正式稿 `release-notes-v0.5.8.md`；删除已被取代的 `release-notes-v0.5.7.md` 旧稿；`release-notes.md` 头部由 v0.5.3 更正为 v0.5.8。
- **D2 / D6（调研纠偏，未改动）**：`theme.css` 两处 `:root` 块实为互补增强层（变量名不重复），`public/orchestrator.js` 由 `main.js` 引用——均非死代码，保留。

## 🐛 Bug 修复（Fixes）

- **B4 圆桌 checkpoint 丢失前置上下文**：`runRoundtable` 解构未接收 `transcript`，`plan-routes` 又误包成数组，导致自动链路圆桌看不到上游讨论/摘要。改为将 `transcript` 归一化为字符串注入上下文，并补 `normalizeTranscript` 单测。
- **D4 右侧栏空指针**：`right-panel.js` 两处 `getTabs()[0]` 在注册表为空时崩溃，加空数组保护（与既有 `:706` 保护一致），重建 lazy bundle。

## 🔧 工程

- 版本号 `0.5.8 → 0.5.9`（原 v0.6.0 回挂为 0.5.x 收尾补丁）。
