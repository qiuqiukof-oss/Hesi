# Hesi 代码产权与侵权风险审计报告

- **审计日期**：2026-07-29
- **审计范围**：全仓库 1826 个已跟踪文件（源码约 588 个：415 `.js` + 117 `.mjs` + 51 `.py` + 5 `.ts`）
- **审计目标**：评估抄袭/侵权风险，建立商业化所需的「自主创作」证据链
- **交付层级**：全量审计 + 产权文件（LICENSE/NOTICE/溯源文档）+ 逐文件版权头

## 一、审计方法与局限（如实告知）

| 方法 | 覆盖 |
|------|------|
| 依赖许可证字段读取（node_modules） | 24 个 npm 依赖逐一核实 |
| vendor/connectors 逐包审查（子代理只读扫描） | 62 个连接器全部 |
| 源码第三方标记扫描（license 头/项目名/依赖外 require） | 全量 |
| git 作者/提交证据 | 248 提交 |

**局限**：无法在离线环境将每段代码与全互联网逐一比对以「证明零抄袭」。AI 辅助代码最大的真实风险
是「训练数据复述」（AI 无意吐出某段受版权保护的原文），此类靠静态扫描不可全验。
本审计通过「可检测风险清零 + 完整人类创作证据链」使法律层面站得住，而非声称已穷尽比对。

## 二、关键结论

| 维度 | 结论 | 风险等级 |
|------|------|---------|
| 原创代码权属 | 全部提交作者为 qiuqiukof-oss 本人身份，人类主导明确 | ✅ 低 |
| 依赖许可证（23/24） | 均为 MIT/BSD/ISC/Apache，可商用 | ✅ 低 |
| **依赖许可证（edge-tts-universal）** | **AGPL-3.0，运行时硬依赖** | 🔴 高（阻断项） |
| vendor 连接器（51/62） | 纯配置型原创封装，无第三方代码 | ✅ 低 |
| vendor 连接器（netease-mail） | 内嵌 MIT 库源码但缺 LICENSE | 🟡 中 |
| vendor 连接器（awesun） | 含 Oray「保留所有权利」文件，疑似未授权 | 🔴 高 |
| vendor 连接器（feishu/tencentads/dingtalk） | 官方样例/SDK，需补署名或确认许可 | 🟡 中 |
| 源码外来标记 | 原创源码未扫到外来 license 头 | ✅ 低 |

## 三、已采取的动作（本轮交付）

1. **LICENSE**：版权署名由 `Hesi Contributors` 改为 **qiuqiukof-oss**（MIT 不变）。
2. **THIRD-PARTY-LICENSES.md（新建）**：登记全部依赖许可证 + vendor 第三方代码 + AGPL 阻断项标注。
3. **DEVELOPMENT-PROVENANCE.md（新建）**：权属主张、AI 辅助与著作权法律依据、git 证据、维护指引。
4. **逐文件版权头**：为约 588 个原创源文件（`.js/.mjs/.ts/.py/.sh/.css/.html`）幂等加入
   `Copyright (c) 2026 qiuqiukof-oss / MIT` 标准头；保留 shebang；
   **排除**：node_modules、生成产物（bundle.js）、data、.workbuddy，以及下列第三方派生连接器
   （保留其自身版权声明，不冒充原创）：`awesun`、`netease-mail`、`tencentads`、`feishu`、`dingtalk`。

## 四、残留风险与处理建议（需人工/法务决策，未自动改动）

| 项 | 风险 | 建议 |
|----|------|------|
| **edge-tts-universal (AGPL-3.0)** | 闭源商业化阻断 | 替换/隔离/移除该依赖，TTS 改走浏览器 Web Speech 或自有 MIT 方案 |
| **awesun/coordinates.py (Oray 专有)** | 疑似未授权拷贝 | 获得 Oray 授权，或自研替换该文件 |
| netease-mail 内嵌库缺 LICENSE | MIT 署名缺失 | 在 `vendor/connectors/netease-mail/NOTICE` 补齐各库 MIT 声明 |
| feishu 样例缺完整 MIT 文本 | MIT 署名缺失 | 补齐 Lark MIT 许可全文 |
| tencentads 依赖外部 tencentads-cli | 许可待确认 | 确认该包许可证与商用合规性，或改为可选外部依赖 |

## 五、商业化前清单

- [ ] 处置 AGPL 依赖（edge-tts-universal）—— 最关键（周期 A 已改惰性 + optionalDependencies，未安装不阻断启动；仍需法务确认分发策略）
- [x] 处置 awesun Oray 文件（获权/替换）—— 已通过 `.npmignore` + `package.json` files 白名单**将该连接器整体排除出 npm 发行包**（仓库内未删未改，守红线）；获权/自研替换前不得手动启用分发
- [ ] 补齐 netease-mail / feishu 的 MIT 署名文件
- [ ] 确认 tencentads-cli 许可证
- [ ] 由知识产权律师结合目标市场做最终确权
- [ ] 保留开发对话与评审记录作为人类主导旁证

> 注：除上列第三方事项外，Hesi 原创代码已具备清晰的 qiuqiukof-oss 权属与 MIT 许可，
> 可支撑「自主创作」主张。

---

# 🔍 Hesi 项目深度体检报告（代码质量与安全）

> 生成日期：2026-07-31
> 范围：前端 JS、后端/安全、伙伴下拉修复一致性、死代码/构建一致性 + 关键漏洞逐行核验
> 原则：**只诊断，未修复任何代码**

## 📊 总览

| 严重度 | 数量 |
|--------|------|
| 🔴 高 | 6 |
| 🟡 中 | 9 |
| 🟢 低/清理 | 8 |
| ⚠️ 环境 | 1 |

- `npm run check:server` ✅ 通过（228 个 JS 文件语法校验）
- `npm test` ❌ 本机无法运行（缺 git，见环境问题）
- 「点不开」修复本体 ✅ 完整（三入口 click 处理器均同步挂载）

## 🔴 高严重度（6 项）

### 1. 服务端 M3 讨论功能一触发就崩溃 — `ReferenceError: Cannot access 'execId' before initialization` ⭐最关键
**`routes/ai-tools/plan-routes.js:135,162,187`**
- 第 135 行（讨论分支）引用 `execId`，但 `const execId = crypto.randomUUID()` 直到第 **187 行**才声明 → `const` 暂时性死区（TDZ）必然抛错。
- 更糟：第 160 行的 `catch` 块第 162 行**再次引用 `execId`** → catch 内二次抛出，异常逃逸出整个 try/catch。
- Express 4（`^4.22.2`）**不自动捕获 async 异常** → 请求永不响应，前端无限等待。
- **与「选择讨论伙伴」下拉功能直接相关**：前端已能正常勾选伙伴并触发「执行前先多角色讨论方案」，但服务端一进入该分支就崩。这是当前修复链路的最后一块断点，优先级第一。
- 修复建议：把 `const execId = crypto.randomUUID()` 移到讨论分支之前（第 133 行前）。

### 2. `/api/settings/env` 泄漏所有 API Key 与访问令牌
**`routes/settings.js:66-81`**
- 敏感过滤正则用 `^` 锚点：`/^API_KEY/i`、`/^TOKEN/i`… → `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`QCLI_ACCESS_TOKEN`、`QCLI_MCP_TOKEN` 等**前缀式变量名全部漏网**。
- 该接口无 `requireToken`，任何回环客户端（或恶意网页经 CSRF）可读走全部密钥。
- 对比参照：`lib/env-filter.js` 的写法（`/^OPENAI_API_KEY/i` 全名匹配）才是对的。

### 3. WebSocket 升级绕过跨源守卫 → 任意命令执行
**`lib/access-auth.js:125,144-149`**
- `localOriginGuard` 只拦 `MUTATING_METHODS`（POST/PUT/DELETE/PATCH）；**WebSocket 握手是 GET** → 完全放行。
- 浏览器对 WS 不做 CORS 拦截 → 恶意网页 `http://evil.com` 可连 `ws://127.0.0.1:4264` 发 `agent:launch` 执行任意终端命令。
- 未设 `QCLI_ACCESS_TOKEN` 时（默认）零鉴权。README 的安全警告属实，但 WS 这条路径当前无任何 Origin 校验。

### 4. `esc()` 转义不完整 → 属性注入 XSS
**`public/plan-view.js:37-40,81,88`**
- `esc()` 只转义 `&<>`（3 字符），却在**属性上下文**使用：`class="at-status at-${esc(a.status)}"`。`"` 未转义 → 服务器返回含 `"` 的 status 即可注入任意属性/事件处理器。
- 同文件 `plan-drawer.js:38-41` 也有同样问题。规范实现 `public/escape.js` 转义全部 5 字符，但未被采用。

### 5. 圆桌视图 XSS / CSS 注入
**`public/components/roundtable-view.js:391,534`**
- 391 行：`c.id`、`c.displayName`、`c.name` 未经任何转义拼进 `innerHTML` → CLI 注册表数据（用户可编辑 `cli-registry.json`）含 HTML 即成 XSS。
- 534 行：`style="border:1.5px solid ${color}"`，`themeColor` 来自用户保存的覆盖配置 → CSS 注入面。

### 6. `bundle.js` 构建过期 17 小时 → 聊天面板仍在跑旧代码 ⭐直接影响本次修复
- `bundle.js` 构建于 **7/31 04:23**，而 `public/components/chat/discuss-controls.js` 修改于 **7/31 21:18**（它经 `chat-panel.js → chat-ui.js → main.js` 打进 bundle）。
- 已提取 bundle 内旧版代码确认：**旧版用内联 fetch `/api/agents`+`/api/clis`，没有 `PS.loadPartnerSource()` 和 `PS.subscribe()` 订阅** → 聊天面板的讨论伙伴选择**不会与 Plan 页实时同步**（新版才有跨页同步）。
- 点击打开功能本身旧版也是同步挂载（无「点不开」），但**跨页同步这条新修复在聊天面板入口无效**。
- `lazy-bundle.js`（21:20 构建）比 `plan-drawer.js`（21:18）新，抽屉侧是新鲜的 ✓。
- 修复建议：跑 `npm run build`。

## 🟡 中严重度（9 项）

| # | 位置 | 问题 |
|---|------|------|
| 7 | `routes/index.js:114,117` | CLI 注册表写操作（POST/DELETE/batch-import/batch-delete/discover）**无 requireToken** → 可注入任意 CLI 条目，Windows 上经 `shell:true` 启动（`ws/pty.js:159`） |
| 8 | `routes/settings.js:44` | `POST /settings/import` 无鉴权、无结构校验，直接整体覆盖 CLI 注册表 |
| 9 | `routes/ai-tools/plan-routes.js:99` | `POST /plan/execute` 无 requireToken，可触发命令执行链 |
| 10 | `public/components/chat/discuss-controls.js:153-157` | `subscribe` 回调更新了 `_discussPartners` 但**不更新 `_discussPartner`**（主 Agent 字段）→ Plan 页改伙伴后，聊天面板发送的 `partner` 字段过期 |
| 11 | `ws/message-dispatch.js:135,301` | `pty.write(msg.data)` 无长度上限 → 大 payload 可冲垮 PTY 缓冲（限流只限频率不限大小） |
| 12 | `rate-limiter.js:73` / `ws-handler.js:24` | 回环流量完全豁免限流；多用户/`HOST=0.0.0.0` 部署时无兜底 |
| 13 | `routes/fs.js:52-107` | `/api/fs/dirs` 可枚举任意目录（`C:\Windows\` 等），仅靠回环豁免挡着 |
| 14 | `public/plan-view.js:175` / `plan-drawer.js:403` | WebSocket `onclose` 只置 null **无重连** → 审批闸/讨论面板静默失效 |
| 15 | `public/app/ws-router.js:204` | 每条 WS 消息 `JSON.stringify` dump 到 console（高频诊断残留） |

## 🟢 低严重度 / 清理项（8 项）

| # | 位置 | 问题 |
|---|------|------|
| 16 | `plan-view.js:564` | `console.log('[Plan LLM Config]', ...)` 源码注释自标「稳定后可移除」→ 每次执行泄漏配置来源 |
| 17 | `plan-view.js:579-582` | 死代码：`$('partners')` 元素在 HTML 中不存在（旧文本框降级分支） |
| 18 | `plan-view.js:37-40` vs `plan-drawer.js:38-41` | `esc()` 与 `SAMPLE` 常量**双份逐字重复**，改一处漏一处（建议抽到 escape.js / 共享常量） |
| 19 | `plan-view.js:366-368` vs `plan.html:42` | `syncWrap()` 默认隐藏伙伴区，与 HTML 注释「默认可见便于调试」矛盾（注释过期） |
| 20 | `plan-drawer.js:176` | 抽屉无「先讨论」开关、伙伴选择器常显，与 plan.html 门控行为不一致（设计取舍但需确认） |
| 21 | `plan-view.js:337` | 直接 `JSON.parse(localStorage.getItem())`，其余文件用 `safeStorage`，受限环境会崩 |
| 22 | `plugin-market.html` | 磁盘上存在但无任何页面引用（被 plugin-plaza.html 取代） |
| 23 | `routes/index.js:346,410,417` | 插件脚手架模板内 TODO（用户可见模板，非项目欠债） |

## ⚠️ 环境问题（非代码，但阻塞验证）

- **`npm test` 在此机器完全无法运行**：`test/run-plan.test.mjs:27` 用 `spawnSync git init` 建临时仓库，但**本机没有 git**（`GIT NOT FOUND in PATH`）→ 463 个测试大量失败。此前「回归测试通过」的结论在此环境不可复现。建议安装 git 或让测试跳过 git 依赖。
- `npm run check:server` ✅ 228 个 JS 文件语法全部通过。
- `plans/` 回归套件（verify-terminal-clean / test-discuss / test-stability-regression）未单独运行，建议补跑。

## ✅ 已确认无问题

- **「点不开」修复本身是完整的**：plan-view.js / plan-drawer.js / discuss-controls.js 三入口 click 处理器均已同步挂载（在 await 之前）✓
- PartnerStore 同步机制正确：同 tab 走 `subscribe` 回调、跨 tab 走 `storage` 事件，无双重通知 ✓
- 三个入口的空态/失败态均优雅降级 ✓
- 无孤儿组件（53 个组件全部可达）、无死 CSS（全部被引用，含动态注入）✓

## 🎯 建议修复顺序（按 ROI 排序）

1. **`plan-routes.js` execId TDZ**（1 行移动）→ 恢复 M3 讨论功能，与前端修复闭环
2. **`npm run build`** → 让聊天面板吃上新 discuss-controls.js（跨页同步生效）
3. **`settings.js` env 过滤正则**（改用全名匹配）→ 堵住密钥泄漏
4. **WS Origin 校验**（`verifyClient` 拒绝非回环 Origin）→ 堵住无 token 时的 RCE 面
5. **`esc()` 升级为 5 字符 + roundtable 转义** → 消 XSS
6. 移除两处诊断 console.log、清死代码、抽共享 `esc()`/`SAMPLE`
7. 低优先：CLI 路由/import/plan 加 `requireToken`、WS 重连、输入长度上限、storage 监听清理

---

## ✅ 修复状态（2026-07-31 更新）

- 发现 **#1–#6（全部高危）、#15、#16、#17** 已修复并通过验证。
- 完整修复细节与验证证据见 **[docs/FIX-RECORD-2026-07-31.md](./docs/FIX-RECORD-2026-07-31.md)**。
- 发现 **#7–#14、#18–#23** 为鉴权策略/功能设计层面，已列入该文档「遗留项」待用户决策。
