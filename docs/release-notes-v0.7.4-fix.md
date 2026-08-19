# Hesi v0.7.4-fix 发布说明

> 发布日期：2026-08-03
> 基础版本：v0.7.4（126acaf）
> 包含提交：4335e01 → ffc9430（3 个）

## 核心功能

### 1. 推理强度控制（L3，三档抽象）
- 新增独立下拉「推理强度」（AI 设置内，仅推理模型显示）：**关 / 标准 / 深度**。
- 与 L1 透传（推理过程可见）解耦：L1 控制"看不看得到推理流"，L3 控制"推理用多大力气"。
- 抽象档位按 provider 原生参数映射（`routes/chat/reasoning-config.js`）：
  - OpenAI o-series / DeepSeek-R1 → `reasoning_effort`
  - Qwen3 / 本地推理模型 → `enable_thinking`
  - Claude → `thinking.budget_tokens`（并关闭并行工具调用避免冲突）
- 非推理模型（gpt-4o / haiku 等）不显示开关、不注入任何推理参数。
- `HESI_REASONING_CONTROL=0` 可全局关闭该能力（兜底开关）。
- 前端 `public/lib/reasoning-config.js` 暴露 `window.QCLI.ReasoningConfig`，设置项持久化到 localStorage，切换模型/provider 时实时刷新可见性。

## 修复 / 打磨

### 2. AI 完成态空行清理
- `chat-panel.js` 新增 `_collapseBlankLines`：回答完成后**连续 ≥3 个空行压成 1 行，≤2 个空行原样保留**，消除气泡顶部/段间大片空白。
- `chat.css` 收敛激进规则：由 `br+br{display:none}`（全压没）改为 `br+br+br{display:none}`，仅隐藏第 3 个及之后的连续换行，恰好保留 1 行空隙。
- 历史消息（`message-dom.js`）渲染后同样经过压缩，旧会话不再残留大段空白。

## 验证状态
- ESLint 改动文件 0 error；`npm run build:main` 成功；`bundle.js` 已重建。
- 宿主机实测：推理强度下拉对推理模型正确显示、选「深度」后思考更详尽/更慢；空行清理生效且不过度（段落间保留 1 行空隙）。

## 备注
- 本版本在 v0.7.4 之上的增量修复 + 推理强度能力，按 v0.7.4-fix 发布，不另立 v0.7.5 大版本号。
