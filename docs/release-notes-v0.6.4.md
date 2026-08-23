# Hesi v0.6.4 — v0.6.3 验收修复 + 讨论伙伴多选 + 安全整改

> 基线：v0.6.3（三大功能打磨完整）。本版为 v0.6.3 发布后的验收修复 + 两项体验增强 + 一次安全体检整改。
> 全部为 Bug 修复 / 体验打磨 / 安全加固，**无新增破坏性变更、无新增环境变量 gate**，升级平滑。
> 按「实测后上线」纪律：AI 全权实施 → 球总多轮实测 → 通过后发布。

## 一、v0.6.3 验收实测缺陷修复（bed6756 + c9f32f0）

5 处真实实测缺陷：

- **历史接口瘦身**：`/api/plan/history` 外发 BM25 内部字段 `tf` → 加 `toView()` 投影，响应 112KB→36.8KB（−67%）。
- **历史状态三态**：状态改 `ok`/`fail`/`unknown`，旧记录 44/54 曾被误染红（`fail` 仅当确有错误）。
- **重试时间线可见性**：`renderAttempts` 单轮 fatal/修订异常被整块隐藏 → 仅 `kind=terminal` 才隐藏，其余显「🔎 执行诊断」。
- **autoReplan 超时提示**：LLM 超时误报「Plan 无法自动优化」→ 改为提示调大 `HESI_LLM_API_TIMEOUT_MS`（`llm-bridge` 导出 `LLM_BRIDGE_TIMEOUT_MS`）。
- **错误原因取真**：`summarizeAttemptReason` 取尾 3 行只剩 `}`/`Node.js v22.x` 噪声 → 新增 `pickErrorLines()` + 单测（7 条）。

## 二、讨论伙伴多选（ee767ac → f719bdc，含系列定位修复）

把 Plan 页「Partners」纯文本框升级为与聊天面板一致的**多选下拉**，并打通双边同步与持久化：

- **数据源复用**：Favorites + 已装 Agent CLI（与聊天「AI 讨论」同一份 `window.PartnerStore`）。
- **双边同步 + 持久化**：`partner-store.js`（localStorage `hesi-discuss-partners` + `storage` 跨标签 + `subscribe` 同页）；聊天面板 / Plan 页 / 抽屉共用、任一处改动实时同步。
- **LLM 字段持久化**：API Key / Provider / BaseURL / Model 输入即写回 `qcli-ai-*`，刷新不丢，与「设置 → AI」互通。
- **「点不出下拉」五连修**（根因为 CSS 定位上下文缺失 + 层叠上下文囚笼 + 全局选择器泄漏）：
  - `f719bdc` click handler 同步挂载（根治早于 `await` 的点击被吞）
  - `e5d737f`→`21a8dd4`→`41b2af7` 下拉从 `<details>` 搬出、`position: fixed` / 挂 `body` 顶层（最终弃用，回归普通 absolute）
  - `b12627d` **核心修复**：`.disc-partner-wrap` 补 `position: relative`，`top:calc(100%+4px)` 的 100% 不再退化相对整个视口（下拉此前被丢到屏幕外）。
  - `b7cfa8f`+`2cb8651` 右侧抽屉补齐同一套样式并**全部限定 `#plan-embed` 作用域**，修复聊天面板被全局选择器污染「修丢」。
  - `9f23118` 选项 `flex-direction: row`（左勾选框右 CLI 横向布局）。
- 下拉默认向下弹出，z-index 对齐聊天面板。

## 三、安全审计整改（f606993，对应 `AUDIT-REPORT.md` / `docs/FIX-RECORD-2026-07-31.md`）

球总发起深度体检（发现 #1–23），落地 9 项修复 + 3 清理（最小改动、不改行为、不扩大范围）：

- **#1 崩溃修复**：`plan-routes.js` 的 `execId` 移出 TDZ（M3 前置讨论一触发即 `ReferenceError`）。
- **#2 敏感泄漏**：`env-filter.js` 升级为段边界正则，覆盖 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `QCLI_ACCESS_TOKEN` 等前缀式变量；`settings.js` 复用同一过滤。
- **#3 远程命令执行**：`access-auth.js` 的 `wsAllowed` 在 token 校验前增加 WS 握手 `Origin` 校验，阻断恶意网页经 `ws://127.0.0.1` 执行任意命令。
- **#4 XSS 转义**：`plan-view.js` / `plan-drawer.js` 的 `esc()` 升级 5 字符（`&` `<` `>` `"` `'`），封堵属性注入。
- **#5 圆桌 XSS**：`roundtable-view.js` CLI chip / 气泡 / 座席 / 自定义面板输入转义 + 新增 `sanitizeColor` 白名单（连带核查 `agent-avatars.js` 已转义）。
- **#6 产物重建**：`bundle`/`lazy-bundle` 重建，跨页同步代码进入产物。
- **#15 / #16 / #17 清理**：删除 `ws-router.js` 每条 WS 消息高频日志、`plan-view.js` 诊断日志、永不可达死代码分支。

> 遗留项 #7–14、#18–23（鉴权策略 / 设计层面，如内置鉴权方案、CSP 头、依赖审计）记录在 `FIX-RECORD` 文末，待决策，本版未动。

## 四、测试与质量（M5b）

- 全量 **715/0**（`.js` 463 + `.mjs` 252），ESLint 0 error。
- `npm run check:server`：228 文件语法通过。
- 新增/增强单测：`plan-attempt-reason.test.mjs`（7）、`plan-rag-*`、`plan-discuss-before`、`run-plan-retry` 等。

## 升级注意

- **无新增环境变量**。沿用 v0.6.3 的 `HESI_PLAN_*` 总表。
- 伙伴选择持久化于 `localStorage['hesi-discuss-partners']`；LLM 字段持久化于 `qcli-ai-*`，与「设置 → AI」互通。
- 历史 Plan 列表：Plan 页「📚 历史 Plan」标签，受 `HESI_PLAN_RAG_SINK` 控制。

## 商业化前置风险（红线，待处置）

- `edge-tts`（AGPL-3.0）与 `vendor/connectors/awesun`（Oray 残留）商业化前须处置。
- `vendor/connectors`（62 SaaS）禁止删减 / 瘦身 / `.gitignore`（离线导入必需）。
