# Hesi v0.7.4 发布说明

> 发布日期：2026-08-02
> 基础版本：v0.7.3
> 包含提交：b4cbcc1 → 126acaf（7 个）

## 核心功能

### 1. 深度思考检测 + 透传（L1）
- 后端 `stream-openai.js` 解析 `delta.reasoning_content`、`stream-anthropic.js` 解析 `thinking_delta`，按 chunk 透传 `type:'reasoning'` 事件（Anthropic 仅上游启用 extended-thinking 时下发）。
- 前端思考气泡内新增**可折叠灰色块「🧠 推理过程」**（默认折叠、可滚动、点击展开）；首个推理 chunk 到达时自动展开，并把标题从伪「🤔 深度思考中」切到真「🧠 推理中…」。
- **普通模型无 reasoning 事件 → 完全保持现状，无回归**。

### 2. 工具调用改为随流内联折叠块
- 流式文本改为分段渲染：工具调用 `start` 时冻结当前文本段 → 在其后插入一个**内联折叠块** → 再开新段接后续文字。工具记录**精确落在触发它的那句话下方**。
- 内联块默认折叠为一行（`🔧 读取记忆 (memory_search) · 123ms ✓`），点开才展开结果预览（复用 `.tool-preview`，`textContent` 防 XSS）。
- **移除末尾 `--- 🔧 工具调用 (N)` 大段汇总 dump**，消除"输出完留大空白再总结"。
- `displayContent` 仍保留一份紧凑工具记录供刷新/历史回溯（不渲染进实时气泡）。
- plan / 讨论通道继续走旧面板列表兜底，普通对话轮不再残留"⏳ 等待工具调用…"空提示。

### 3. 解除自检工具轮次硬帽
- `routes/chat/index.js` 移除早期为规避免费档 apihub 429 限流而加的 `isSelfCheck ? 6 : undefined` 特殊收紧。
- 现运行环境为本地 LLM / 自有 key，429 不再成立；`circuit-breaker.js` 的累计工具次数 + 15 分钟总超时仍是终极安全阀。
- 自检现在和普通对话一样最多 50 轮。

## 紧凑化修复（消除气泡内大片空白）
- `e46c5bc` 收紧思考气泡内联工具布局（flex gap → block，隐藏空面板）。
- `7ca3384` 修复 `.msg-bubble:has(.inline-tool)` flex gap 覆盖问题，进一步贴近 WorkBuddy 紧凑风格。
- `0156208` 消除文本段末尾空行导致的工具调用上方大空白（渲染前 trim 尾部空白 + 折叠空段/br）。
- `1552072` 完成态气泡剥离思考骨架（`.thinking-body/.footer/.header`），消除工具调用结束后的大片空白。
- `126acaf` 完成态把工具/推理合并折叠成一行摘要（`🔧 N 个工具调用 ▾` / `🧠 推理过程 ▾`），点开才看详情；进行态保持内联卡片展开样式不变。

## 验证状态
- `node --check` 全过；ESLint 改动文件 0 error；`check:server` 241 文件通过；`bundle.js` 已重建。
- 宿主机实测：推理灰块透传有效、工具内联块随流紧凑、完成态折叠摘要生效。

## 后续
- v0.7.5（待立项）：推理强度控制（L3），见 `.workbuddy/推理强度控制-执行方案.md`。
