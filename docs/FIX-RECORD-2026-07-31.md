# 🔧 Hesi 修复记录 — 代码质量与安全检查整改（2026-07-31）

> 对应文档：[AUDIT-REPORT.md](../AUDIT-REPORT.md)（2026-07-31 深度体检报告，发现编号 1–23）
> 修复原则：**最小改动、不改行为、不扩大范围**；每项修复后均通过语法/构建验证。
> 服务已于修复完成后由用户手动重启，前端 bundle 已重建。

## 📋 修复总览

| 审计编号 | 严重度 | 文件 | 状态 |
|---------|--------|------|------|
| 1 | 🔴 高 | `routes/ai-tools/plan-routes.js` | ✅ 已修复 |
| 2 | 🔴 高 | `routes/settings.js` | ✅ 已修复 |
| 3 | 🔴 高 | `lib/access-auth.js` | ✅ 已修复 |
| 4 | 🔴 高 | `public/plan-view.js`、`public/components/plan-drawer.js` | ✅ 已修复 |
| 5 | 🔴 高 | `public/components/roundtable-view.js` | ✅ 已修复 |
| 6 | 🔴 高 | `public/bundle.js` / `public/lazy-bundle.js` | ✅ 已修复（重建） |
| 15 | 🟡 中 | `public/app/ws-router.js` | ✅ 已修复 |
| 16 | 🟢 低 | `public/plan-view.js` | ✅ 已修复 |
| 17 | 🟢 低 | `public/plan-view.js` | ✅ 已修复 |
| 7-14, 18-23 | — | 未处理项见文末「遗留项」 | ⏸️ 待确认 |

---

## 🔴 发现 #1 — 服务端 M3 讨论功能一触发就崩溃（TDZ ReferenceError）

**文件**：`routes/ai-tools/plan-routes.js`

**问题**：
- 原第 135 行（讨论分支）引用 `execId`，但 `const execId = crypto.randomUUID()` 直到第 187 行才声明 → `const` 暂时性死区（TDZ）必然抛错。
- 原第 160 行 `catch` 块内第 162 行再次引用 `execId` → catch 内二次抛出，异常逃逸出 try/catch。
- Express 4（`^4.22.2`）不自动捕获 async 异常 → 请求永不响应，前端无限等待。

**修复**：
- 将 `const execId = crypto.randomUUID();` 移至讨论分支之前（现第 115 行，位于 `let plan = ...` 之后）。
- 删除原第 187 行处的重复声明（`resolveExecutorAgentId(body);` 之后的 `const execId = crypto.randomUUID();`）。
- 补充注释说明 TDZ 成因，防止回归。

**验证**：grep 确认文件内仅剩 1 处 `execId` 声明（第 115 行）；`npm run check:server` 通过。

---

## 🔴 发现 #2 — `/api/settings/env` 泄漏所有 API Key 与访问令牌

**文件**：`routes/settings.js`（配合 `lib/env-filter.js`）

**问题**：
- 原敏感过滤正则用 `^` 锚点（`/^API_KEY/i`、`/^TOKEN/i`…）→ `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`QCLI_ACCESS_TOKEN`、`QCLI_MCP_TOKEN` 等前缀式变量名全部漏网。
- 该接口无 `requireToken`，任何回环客户端（或恶意网页经 CSRF）可读走全部密钥。

**修复**：
- `routes/settings.js`：在 `GET /settings/env` 处理器中移除本地 `^` 锚定正则，改为 `const { SENSITIVE_VAR_PATTERNS } = require('../lib/env-filter');` 复用共享敏感变量模式表。
- `lib/env-filter.js`：`SENSITIVE_VAR_PATTERNS` 升级为**段边界全名匹配**正则（不再只锚定行首 `^`），覆盖：
  - `(^|_)(API[_-]?KEY|API[_-]?SECRET|ACCESS[_-]?KEY|ACCESS[_-]?TOKEN|SECRET[_-]?KEY|SECRET[_-]?TOKEN)(_|$)` 等密钥类
  - `(^|_)(TOKEN|PASSWORD|AUTH|SESSION|COOKIE|JWT|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|...)(_|$)` 等凭据类
  - 连接字符串与已知键名（含 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`QCLI_ACCESS_TOKEN`、`QCLI_MCP_TOKEN`、`QCLI_TOKEN` 等全名匹配）

**验证**：`npm run check:server` 通过；逻辑与 PTY 环境变量过滤（同表来源）保持一致。

---

## 🔴 发现 #3 — WebSocket 升级绕过跨源守卫 → 任意命令执行

**文件**：`lib/access-auth.js`

**问题**：
- `localOriginGuard` 只拦 `MUTATING_METHODS`（POST/PUT/DELETE/PATCH）；WebSocket 握手是 GET → 完全放行。
- 浏览器对 WS 不做 CORS 拦截 → 恶意网页 `http://evil.com` 可连 `ws://127.0.0.1:4264` 发 `agent:launch` 执行任意终端命令。
- 未设 `QCLI_ACCESS_TOKEN` 时（默认）零鉴权。

**修复**（`wsAllowed(req)`，现第 108-120 行）：
- 在 token 校验**之前**增加握手 Origin 校验：
  - 带 `Origin` 头且非回环（`isLoopbackOrigin`）且不在 `QCLI_CORS_ORIGINS` 白名单（`getAllowedOrigins`）→ **直接拒绝**（返回 `false`），无论是否启用 token。
  - 无 `Origin` 头（curl / 原生应用 / 同源导航）→ 放行，与 `localOriginGuard` 行为一致。
- 补充函数级注释说明威胁模型与拦截逻辑。

**验证**：`npm run check:server` 通过；确认 `wsAllowed` 在 WebSocket 连接处理器中被调用（`lib/access-auth.js:23` 注释声明）。

---

## 🔴 发现 #4 — `esc()` 转义不完整 → 属性注入 XSS

**文件**：`public/plan-view.js`、`public/components/plan-drawer.js`

**问题**：
- 两个文件的 `esc()` 只转义 `&<>`（3 字符），却在属性上下文使用（如 `class="at-status at-${esc(a.status)}"`）→ `"` 未转义即可注入任意属性/事件处理器。

**修复**：两处 `esc()` 均升级为 **5 字符转义**（对齐 `public/escape.js` 规范实现）：
```js
// 现在（两个文件相同）
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

**验证**：重建后 bundle 内可检索到 `&quot;` / `&#39;` 转义序列。

---

## 🔴 发现 #5 — 圆桌视图 XSS / CSS 注入

**文件**：`public/components/roundtable-view.js`（另核查 `public/components/agent-avatars.js`）

**问题**：
- CLI chip（`mkChip`，原 391 行）：`c.id`、`c.displayName`、`c.name`、`c.category` 未转义拼进 `innerHTML` → CLI 注册表数据（用户可编辑 `cli-registry.json`）含 HTML 即成 XSS。
- 气泡（原 534 行）：`style="border:1.5px solid ${color}"`，`themeColor` 来自用户保存的覆盖配置 → CSS 注入面。
- 座席渲染（`renderSeatBody`）：`agent.name`、`agent.roleLabel` 未转义；`agent.themeColor` 直接拼 `border-color`。
- 自定义面板（`openCustomize`）：标题行 `a.name`/`a.id` 未转义；四个 input 的 `data-id="${a.id}"` 属性边界未转义。

**修复**：
1. `mkChip`：`c.id` → `this.esc(c.id)`；`c.displayName || c.name` → `this.esc(...)`；`c.category` → `this.esc(...)`（现 391 行）。
2. `renderSeatBody`（现 429-435 行）：`agent.themeColor` → `this.sanitizeColor(agent.themeColor)`；`agent.name` → `this.esc(agent.name || '')`；`agent.roleLabel` → `this.esc(agent.roleLabel || '')`。
3. 气泡（现 530-534 行）：`s.agent.themeColor` → `this.sanitizeColor(...)`（用于 innerHTML 内 style 的部分）；`s.avEl.style.borderColor`/`boxShadow` 为 DOM 属性赋值（本就安全，不改动）。
4. `openCustomize`（现 766-771 行）：标题行 `a.name`/`a.id` → `this.esc(...)`；四个 input 的 `data-id` → `this.esc(a.id)`（`value` 部分原本已转义）。

**新增** `sanitizeColor(v, fallback = '#c9ced4')` 白名单校验：
- 接受：`#` 开头 hex 3–8 位；`rgb/rgba/hsl/hsla(...)` 函数式颜色；常见命名色。
- 拒绝（回退 `#c9ced4`）：`expression(...)`、`url(...)`、`;`、`"` 等注入载荷。

**连带核查**：`public/components/agent-avatars.js` 中 `renderAvatarInner`（163-173 行）的 emoji 用 `escapeHtml`、img 用 `escapeAttr`，均已转义 ✅。`renderSeat`（137-160 行）/`renderAvatar`（115-130 行）的 name/role/bubble 均已 `escapeHtml`；其 `border-color:${color}` 与发现 #5 同类，但**经核查这两个导出函数在 `public/` 内无任何调用点**（grep `renderSeat(` / `renderAvatar(` 仅命中定义处；roundtable-view.js 只 import `renderAvatarInner`/`statusClass`/`applyOverrides` 等）→ 属导出死代码，当前无风险面，**未扩大改动范围**（保持最小改动）。

**验证**：源码 grep `\$\{(c\.id|c\.displayName|c\.name|c\.category|a\.name|a\.id|agent\.name|agent\.roleLabel|agent\.themeColor)` 零匹配；重建后 `sanitizeColor` 存在于 lazy-bundle（roundtable-view 属懒加载包）。

---

## 🔴 发现 #6 — `bundle.js` 构建过期 17 小时 → 聊天面板仍在跑旧代码

**文件**：`public/bundle.js`、`public/lazy-bundle.js`

**问题**：bundle 构建于 7/31 04:23，而 `discuss-controls.js`（21:18）经 `chat-panel.js → chat-ui.js → main.js` 打进 bundle；旧版 bundle 内仍是内联 fetch `/api/agents`+`/api/clis`，没有 `PS.loadPartnerSource()` / `PS.subscribe()` 跨页同步。

**修复**：执行 `npm run build`（esbuild，`--bundle --format=iife --minify`）。
- `public/bundle.js`：980.4kb（重建于 22:54）
- `public/lazy-bundle.js`：215.8kb（重建于 22:55）

**验证**（对重建后产物）：
- bundle 时间戳晚于全部修改源码 ✅
- `loadPartnerSource`、`.subscribe(` 存在于 bundle ✅
- 旧式内联 fetch 已从 `discuss-controls.js` 源码移除（chat 组件目录 grep `/api/agents|/api/clis` 零匹配）✅
- bundle 内剩余的 `/api/agents` 引用全部来自合法组件（`plan-view.js`/`agents.js`/`agent-install-ui.js`/`plan-drawer.js`/`partner-store.js`）✅
- `no_ws_router_log`、`no_plan_llm_diag` 标记确认清理项已随重建生效 ✅

---

## 🟡 发现 #15 — 每条 WS 消息 `console.log`（高频诊断残留）

**文件**：`public/app/ws-router.js`

**问题**：default 分支对每条路由消息 `console.log('[WS] Routed message type:', msg.type, JSON.stringify(msg).substring(0, 200))`。

**修复**：删除该行（现 default 分支直接走 `Q.Agents/Q.Workflows/Q.Orchestrator` 分发）。

---

## 🟢 发现 #16 — `console.log('[Plan LLM Config]', ...)` 诊断残留

**文件**：`public/plan-view.js`

**问题**：源码注释自标「稳定后可移除」，每次执行泄漏 LLM 配置来源（provider/base-url/model 判定结果）。

**修复**：删除整个 `try { const diag = {}; ... console.log(...) } catch {}` 块（原 561-569 行）。

---

## 🟢 发现 #17 — 死代码：`$('partners')` 降级分支

**文件**：`public/plan-view.js`

**问题**：`$('partners')` 元素在 HTML 中不存在（旧文本框降级分支，永不可达）。

**修复**：删除 `else { const ps = $('partners'); ... }` 分支，仅保留 `plan-partner-dropdown` 多选下拉读取路径（现 578-583 行）。

---

## ✅ 验证汇总（修复后全量）

| 检查项 | 结果 |
|--------|------|
| `npm run check:server` | ✅ 228 个 .js 文件语法校验通过 |
| `npm run build`（bundle + lazy-bundle） | ✅ 重建成功，产物晚于全部源码 |
| roundtable-view 注入面 grep | ✅ 零残留（`${c.id}`/`${a.name}`/`${agent.themeColor}` 等未转义模式全部清除） |
| bundle 新代码标记 | ✅ `loadPartnerSource`/`subscribe`/`sanitizeColor`/5 字符转义均在产物中 |
| 清理项标记 | ✅ WS 路由日志、Plan LLM 配置日志已不在 bundle |

---

## ⏸️ 遗留项（未处理，需用户决策）

对应审计报告发现 #7–#14、#18–#23，本轮**有意未改**（属鉴权策略/功能设计层面，需人工确认）：

| 编号 | 内容 | 处理建议 |
|------|------|---------|
| 7 | CLI 注册表写操作（POST/DELETE/batch-import/batch-delete/discover）无 `requireToken` | 加 `requireToken`（本地部署可接受，公网部署必改） |
| 8 | `POST /settings/import` 无鉴权、无结构校验 | 加 `requireToken` + JSON schema 校验 |
| 9 | `POST /plan/execute` 无 `requireToken` | 加 `requireToken` |
| 10 | `discuss-controls.js:153-157` subscribe 不更新 `_discussPartner`（主 Agent 字段） | 在 subscribe 回调中同步更新 `_discussPartner` |
| 11 | `ws/message-dispatch.js:135,301` PTY 写入无长度上限 | 加 payload 大小上限（如 256KB） |
| 12 | 回环流量完全豁免限流（`rate-limiter.js:73` / `ws-handler.js:24`） | `HOST=0.0.0.0` 部署时提供配置项 |
| 13 | `/api/fs/dirs` 可枚举任意目录 | 加目录白名单或确认回环豁免可接受 |
| 14 | WS `onclose` 无重连（`plan-view.js:175` / `plan-drawer.js:403`） | 加指数退避重连 |
| 18 | `esc()` 与 `SAMPLE` 常量双份逐字重复 | 抽到 `public/escape.js` / 共享常量 |
| 19 | `syncWrap()` 默认隐藏伙伴区与 HTML 注释矛盾 | 更新过期注释 |
| 20 | 抽屉无「先讨论」开关，与 plan.html 门控行为不一致 | 设计取舍确认 |
| 21 | `plan-view.js:337` 直接 `JSON.parse(localStorage.getItem())` | 改用 `safeStorage` |
| 22 | `plugin-market.html` 无引用（被 plugin-plaza.html 取代） | 删除或归档 |
| 23 | `routes/index.js:346,410,417` 插件脚手架模板内 TODO | 用户可见模板，非项目欠债，可不动 |

> 环境备注：`npm test` 在本机无法运行（`test/run-plan.test.mjs:27` 依赖 git，PATH 中无 git）。回归验证以 `npm run check:server` + bundle 产物标记检查代替。
