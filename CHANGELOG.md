# Changelog

All notable changes to **Hesi（合思）** are documented here. This project follows
a lightweight [Keep a Changelog](https://keepachangelog.com/) convention; versions
use `vMAJOR.MINOR.PATCH-<tag>`.

---

## [v0.7.5] — 2026-08-03

### 全站主题跟随 + 持久化修复
- **主题持久化修复（致命）**：`uiStore.getSavedTheme()` 保留完整主题 id（xuan/quiet/xuanye/cyber），不再回落成仅 light/dark；修复「设置主题后刷新即恢复默认」且独立页面读不到自定义配色的问题。
- **独立页面 / 插件页跟随 6 主题**：新增 `public/lib/standalone-theme.js` 注入器（跨标签页实时跟随）；文档画廊 / 预算管理 / 图表模板 / 插件广场 / workbuddy 广场 / tools 及 admin / blackboard / onboarding-guide / plugin-market 均随主题整套换肤。
- **Agnes 工作台跟随 + 拖拽卡顿修复**：`style.css` 显式映射 6 套主题；`backdrop-filter` 由 20px 降至 10px 并加交互守卫，消除拖拽 / 缩放迟滞。
- **多 Agent 黑板排版协调**：三处硬编码色改为主题令牌。
- **CLI 关闭红字收敛**（前序）：`ws-router.js` 不再泄漏退出红字到其它 CLI 标签页。

## [v0.5.1] — 2026-07-28

### 语音输出 / 工具调用稳定性修复（实测问题修复）
- **TTS 只读最后一句（致命）**：Web Speech `onstart` 异步回调里才置 `_state.speaking`，导致流式多句几乎同时判定「空闲」→ `synth.cancel()` 把前句全部掐断，只剩末句出声。改为 **`synth.speak()` 同步置忙** + 新增 `isTtsBusy()` 队列守卫，逐句串行合成。
- **Emoji 字面读音（体验）**：TTS 文本统一经 `stripEmoji()` 过滤（覆盖 `\u{1F000}–\u{1FAFF}` 等 7 段 emoji 区间），**无条件关闭** emoji 朗读（按用户要求不做开关），保留箭头 `→`、项目符号 `•`、中英文标点。
- **工具名现身（体验）**：AI 调用工具时的状态文案由裸工具名改为中文「使用「读取工具」「编辑工具」…」，新增 `routes/chat/tool-labels.js` 映射 31 个内置工具 + MCP/未知回退「工具」。`stream-openai.js`/`stream-anthropic.js` 均已接入。
- **幽灵中断（致命）**：本地模型（如 gamma4/qwen3）常「同工具不同参数」循环，旧守卫只去重精确签名 / 8 轮窗口，最终撞 50 轮硬上限静默中断。新增 `TOOL_LOOP_GUARD`（默认 15，env `HESI_LLM_TOOL_LOOP_GUARD`，0=关）连续重复守卫，超阈优雅停止并提示「疑似循环，已停止」。

### 验证
- `npm test` **全绿（300 用例）**
- `npm run lint` **0 error**
- `npm run build:main` ✅ **969.1kb**；`npm run build:lazy` ✅ **263.1kb**
- 提交范围：voice-output.js / stream-openai.js / stream-anthropic.js / tool-labels.js（新）+ bundle.js（重建）

---

## [v0.5.0] — 2026-07-28

### 验证优先模式（Verify-First，Phase 0）
- 聊天面板新增 🔍 核查开关，开启后本次对话向系统提示词追加「核查模式已开启」段，强制 AI 先调用 read_file / grep / web_fetch / exec_terminal 取证再下结论，要求引用具体文件路径:行号。
- 状态走 `verifyMode` 字段贯穿到后端 `routes/chat/index.js`，前端开关与请求体一致；关闭时零注入、零行为变化。

### 语音方案 v1（输入泛化 + 输出 TTS）
- **输入泛化**：麦克风可路由到**聊天输入框**或**终端**双目标；识别成文字后弹**确认条**（可编辑、重录、取消、切换目标），默认 `autoSend` 关 → 确认再发送；识别语言默认 `zh-CN` 保证高识别率。
- **输出 TTS**（重点优化 AI 文字快速读出）：
  - AI 回复**边生成边读**（`_ttsStreamOnToken` 按句末标点 `。！？!?\n` 增量合成）。
  - 引擎可切 **Web Speech / Edge TTS / auto**；Edge TTS 走 `edge-tts-universal`（纯 Node，零原生依赖）。
  - **Edge 流式串行队列**（promise 链）避免多句音频重叠；**`splitForSpeech` 长文本切分**降低 Web Speech 单 utterance 失败概率。
  - 后端新增 `lib/tts/edge-tts.js` + `routes/tts.js`（`POST /api/tts/synthesize` / `GET /api/tts/voices`）；挂载到 `/api/tts`（与前端一致）。
- **独立设置面板**：标题栏新增 🎛️ 入口；含「自动发送」「识别语言」「默认发送目标」三项；默认目标支持 `auto|chat|terminal`，持久化、可 pin。
- **降级链**：Edge TTS → Web Speech → 纯文本；单段失败不影响后续。

### 圆桌交互增强（P2.5 落座接管）🟢
- 圆桌讨论中，用户可**接管**任意 Agent 席位：点击席位「接管」→ 填写「以该 Agent 身份发言」文本 → 讨论开始时该席位的发言由人工提交文本代替自动生成（仅首次注入，后续轮保持接管态）。
- 内核 `routes/chat/discuss.js` 跳过被接管席位的 `runCliTurn`，改为注入人工文本并写入讨论转录；点「归还」恢复自动协作，不影响其他席位。
- 前端 `roundtable-view.js` 席位新增接管/归还控件与状态管理，`chat-api.js` / `routes/chat/index.js` 透传 `takenOver`（cliId→文本）。纯前端状态 + 内核跳过逻辑，零新依赖。

### 记忆时间轴（P2.1）🟢
- 新增后端只读端点 `GET /api/memory/sessions/:id/timeline`：聚合 session 消息时间戳 + 压缩检查点 + 收益记录（turnMetrics），按时间排序返回。
- 记忆抽屉（🧠）新增「🕒 时间轴」Tab，纵向时间轴区分**消息（🙋用户 / 🤖助手）/ 压缩检查点（🧊）/ 收益累计（💡）**节点，点击展开当轮预览。
- 纯函数组件 `public/components/memory-timeline.js`（`computeTimeline` + `renderMemoryTimeline`，零 DOM 副作用、可单测），入 main bundle。

### Bug 修复（语音 + verify 累计）
- **致命**：Edge TTS 路由 mount 路径修复（`/api` → `/api/tts`），与前端请求对齐；`toEdgeRate` 无效输入 fallback 从 `'+0.00%'` 改为 `'+0%'` + clamp 到 `[-90%, +100%]` 区间（避免 UI 最大 3× 时 502 回落）。
- **中度**：语音确认条发送后清空（避免 continuous 模式重复发送）；`onerror no-speech` 加 `voice.active` 守卫（避免主动停止后被重启）；TTS 设置面板引擎/音色/测试按钮互斥与刷新逻辑。
- **体验**：CSS 变量替换暗色硬编码 fallback（亮色主题可读）；CSS 死样式清理（43 行）；i18n 字段补全（`voice.inputSettings` / `voice.defaultTargetLabel` / `voice.effectiveTarget`）。

### 验证
- `npm test` **全绿**（300 用例）；`npm run lint` **0 error**（历史遗留警告未引入新增）。
- `npm run build:main` ✅ **968.8kb**；`npm run build:lazy` ✅ **263.1kb**。
- **Edge TTS 端到端冒烟**：`/api/tts/synthesize` 返回 `200 audio/mpeg`（rate=undefined/1.0/3×→clamped/0.5× 全测），`/api/tts/voices` 返回 322 音色（14 中文）。

### 升级提示
- 用户升级后首次启用 Edge TTS 会**首次联网**获取微软音色列表；离线环境自动降级 Web Speech Synthesis。
- 「默认发送目标」设置沿用 `qcli-voice-input-defaultTarget` localStorage key；老用户读不到值时回落到 `auto`（按焦点/终端自动判断）。

---

## [v0.4.2] — 2026-07-28

### 聊天体验增强
- **分类 Chips（任务模式）**：聊天面板消息区下方新增 6 个分类 Chip（日常开发 / 网站开发 / Agent 应用 / Skill 开发 / CI/CD / 文档）。点击高亮、再点取消、刷新保留（localStorage）；选中后向后端注入 `[当前模式：xxx]` 系统提示段（未选时零注入），并使同类 Skill 检索加权优先。
- **粘贴 / 拖拽上传附件**：输入框支持 Ctrl+V 粘贴图片或文件、以及把文件拖入输入框直接成为附件，复用既有 `_handleFiles` 上传链路，后端零改动。纯文本粘贴不拦截。

### 多轮回滚（rollback 增强）
- **Phase 1 — 任意轮次回滚**：检查点由单槽升级为栈模型（`<id>.ckpt.<seq>.json`，保留最近 30 轮）；聊天面板 ⏪ 旁新增 🕘 历史按钮，浮层选择任意轮次回滚；回滚后节省图标自动联动跳回该轮基线。
- **Phase 2 — 文件写类副作用还原**：`write_file` 工具写文件前自动快照原内容并挂到对应轮次检查点；回滚到某轮时按「每文件取 ≥目标轮的最早快照」规则还原（新建文件删除、已存在文件写回原内容，>256KB 标记跳过）。回滚前弹出确认框列出将还原/删除的文件。
- 边界：CLI 命令 / 浏览器 / 外部 API / 插件安装等物理不可逆副作用不还原；无 redo；单会话内。

## [v0.2.8] — 2026-07-25

可用性提升（响应《Hesi 可用性缺口分析》实证复核，仅落地已验证的真实短板）：

### 文档与新手体验
- **README 拆层**：顶部新增「🚀 30 秒快速体验」速览（零安装便携包 / 源码运行 / 让 AI 干活 三入口），并链接新手指引与贡献者指南，新用户无需再翻长文档。
- **新增 `docs/getting-started.md`**：面向新手的完整上手指南（4 步首次体验、Key 配置、圆桌玩法、工作空间设置、快捷键）。
- **新增 `CONTRIBUTING.md`**：贡献者指南，重点标注仓库特有地雷——前端 bundle 双轨（`build:main` vs `build:lazy` 千万别选错）、eslint 前端 globals 配置、husky 钩子、gh-pages worktree 发布流程、禁止 `git add -A`。

### 全局工作空间选择器（新功能）
- 终端标签栏 + 聊天工具栏各新增醒目「📂 选择工作空间 ▾」按钮，点击打开**服务端目录浏览**弹窗（浏览器原生选择器无法暴露绝对路径，故由后端列目录）。
- 选定后同时驱动：① 新开终端的默认 cwd ② AI 工具 `exec`/文件操作的默认目录，消除"终端在 A 目录、AI 在 B 目录"的割裂。
- 选择持久化到 localStorage，重启后自动回写服务端；确认时可顺带把当前终端 `cd` 过去。
- 新增后端：`lib/workspace.js`（全局工作目录状态）、`routes/workspace.js`（`GET/POST /api/workspace`）、`routes/fs.js`（`GET /api/fs/dirs` 目录浏览），均受 `requireToken` 保护（loopback 默认豁免）。

---

## [v0.2.7] — 2026-07-25

工程健康度修复（响应第三方实地评测 HESI-EVALUATION 复核）：
- **Lint 归零**：`eslint.config.js` 为 `plugins/agnes-ai/web/**/*.js` 补充浏览器全局变量（`document`/`window`/`navigator` 等），消除 201 个 `no-undef` 误报。`npm run lint` 由 201 errors → 0 errors，CI lint 步骤转绿。
- **修复潜在运行时崩溃**：删除 `plugins/agnes-ai/web/js/app.js` 中 `totalAdjusted++` 死代码（变量从未声明、从未被读取，在 class 严格模式下执行该路径会抛 `ReferenceError`）。

---

## [v0.2.6] — 2026-07-25

新手指引气泡定位精修（基于自动化截图诊断）：
- 等聊天抽屉滑入动画结束再定位气泡，修复 ⭐AI讨论 步气泡悬空 ~200px
- 移除每步气泡的全屏黑色遮罩暗化（`.og-overlay` 不再 `rgba(0,0,0,0.55)`），主界面不再变暗
- 删除 `hideWelcomeOverlay()` 误判（chat-drawer z-index:6 天然在 welcome-overlay:5 之上），欢迎页始终可见、背景不再消失
- AI讨论气泡位置微调（最终 offset.y=-90，累计上移 90px）

主题：
- 默认主题改为**亮色**（首次访问/清缓存后自动亮色，预设 active 指向「亮色默认」）

---

## [v0.2.5] — 2026-07-25

侧栏新手引导（onboarding）全套上线 + 欢迎页/气泡像素级打磨 + 整体代码审查修复 + 主题切换重新开放 + Logo 光晕清理。

### Added
- **侧栏新手引导 v1→v4** — 气泡 A/B 混合（目标不可见时自动开对应面板、可见时静默跳过）；四方位智能定位 + 箭头指向 + 像素级偏移微调；⭐AI 讨论步骤金色高亮着重标记（`highlightTarget` 精确圈选开关）。
- **新手教程页（独立标签页）** — 双语（中/EN）产品介绍风格 7 页幻灯片：Start Page → Hesi 是什么 → 为什么选 → 核心功能 → 三步上手 → ⭐AI 讨论 → 📎多模态；原生 `speechSynthesis` TTS 朗读旁白 + 语言切换 + 自动播放进度条；虚化主界面截图作背景。

### Changed
- **欢迎页布局美化** — 压缩密度使 Slide 0/1 不滚动；修复欢迎层横向溢出（`-16px` 负边距）。
- **主题切换功能重新开放** — 移除 🌙暗/亮与 🎨背景定制按钮的 `display:none`（图标换新设计后暗色下不再失真）；亮色/半透/纸质等预设可用。
- **Logo 光晕清理** — 源图自带外发光+投影是 alpha=255 实色浅蓝白渐变环（非半透明），大图露白边毛刺；改用 BFS 泛洪填充 + 双阈值（`lum>140 AND r>100`）从四边吃掉光晕、保留图标青色渐变本体（清除 182,293 像素）。

### Fixed
- **确凿 Bug（整体检查）** — `index.html` 的 `#discuss-switch` 漏 id 致 ⭐AI 讨论高亮框静默失效；`welcome.css` 孤立多余 `}`；`state.js` 分类筛选记忆恢复后高亮 chip 与状态不同步。
- **中危项（整体检查）** — ① onboarding 进 chat 步时临时隐藏 `#welcome-overlay` 防遮挡气泡目标；② 全局 Enter 监听加焦点判断防误推进；③ 教程页切语言时页码提示与「下一步」文案即时跟随；④ `/api/tools` 补 `requireToken` 与其他 `/api` 路由对齐（`requireToken` 未设 token 时为空操作、回环默认放行，本地使用无影响）。

## [v0.2.4] — 2026-07-25

侧栏/右面板布局精细化 + 对话框多媒体输入 + 全新品牌 Logo。

### Added
- **对话框多模态输入** — 用户可在聊天框发送图片 / 视频 / 文本·代码文件，后端 `injectAttachments` 同机转码为 base64 喂给模型（Claude 真看视频、OpenAI 降级提示），持久化只存短 URL 不爆上下文。
- **全新品牌 Logo** — 换用「圆角方块 + 蓝青渐变 + 脑形 H」图标，统一托盘 / 应用内 / 欢迎页；托盘图标最大化至 88% 填充，与系统图标尺寸一致。
- **左栏工具去重** — 13 个工具按钮收敛为 3 个独立页面入口，其余统一以右面板 Tab 为唯一入口，消除全局重复。
- **Workflows 迁移到右面板** — 从左栏网格改为右面板独立 Tab 的卡片行样式；并修复双图标重复渲染、网格化 + 悬停 tooltip。

### Changed
- **右面板收窄** 480→300px，并在全标签页做 UI 美化（dashboard 去重+折叠、抽共享 `.rp-card` 基类、插件 2 列、图表/长表默认折叠）。
- **Tab 顺序重排** + 默认强制仪表盘；修复 `category` 漏改与异步注册不重排导致的顽固乱序；修复 Tab 点击偶尔空白（switchTab 守卫与重排时序矛盾）。
- **无障碍** — 11 个搜索框补 `aria-label`；Logo 图片补 `alt`；文件上传 input 补 `aria-label`。

### Fixed
- **工作流面板 ID 选择器覆盖** — `#rp-workflows` specificity 压过 `.rp-panel` 导致所有 tab 内容被推到底部，改为统一由 `.rp-panel.active` 控制显隐。

## [v0.2.3] — 2026-07-24

AI 多媒体生成能力 + 聊天框链接可点击。

### Added
- **AI 多媒体生成引导提示词** — 主聊天系统提示词新增「多媒体生成」段，引导 AI 主动、且高质量地调用 `generate_image` / `generate_video`（Agnes 插件），并把中文意图改写为细节化英文 prompt + 负面提示词。
- **聊天框链接可点击** — `renderMarkdown` 新增白名单链接化（`http(s)://`、`file://`、`/uploads/`），代码块/行内代码内的 URL 不会被误链；输入已转义且不接受 `javascript:` 等协议 ⇒ XSS 安全。

### Fixed
- **视频生成不可用（真 bug）** — `routes/ai-tools/builtin/index.js` 此前漏注册 `videoGen`，`generate_video` 从未进入工具表，主聊天 AI 只能生图不能生视频；现已补注册。
- **视频生成进度回调硬报错** — `video-gen.js` 的 `progressFn` 实为字符串（registry 第三参透传的是 requestId），每次调用必抛 TypeError 被 catch → 返回"生成失败"；统一改为 `emitProgress` 走 `broadcastFn`。
- **图片/视频返回 token 精简** — `image-gen.js` 最终返回从 verbose 表格（~250 token）改为简洁一行（~60 token），降低回灌 LLM 上下文占用。
- **首次对话必现 "messages array is required"** — 首条消息 push 进 `this.messages` 后，发送用的 `msgs` 却在 `isConfigured()` 异步回调里才读取；首次运行 `MemorySession.init()` 拉回的历史会整体覆盖 `this.messages`，竞态窗口内刚 push 的消息被抹空 → 发出空 `messages` → 后端 400。改为 push 后立即同步拍快照 `requestMsgs`，发送用快照，消除竞态。

---

## [v0.2.2] — 2026-07-24

Maintenance drop: dependency hygiene + persisted LLM key. No breaking changes; chat API and CLI behavior preserved.

### Fixed
- **Dependency security upgrade** — `npm audit fix` (non-force) upgraded 42 compatible packages, eliminating `fast-uri` (high, authority-host confusion) and `body-parser` (moderate, DoS via invalid `limit`). The remaining `@hono/node-server` moderate is an unused transitive dep of `@modelcontextprotocol/sdk` (Hesi uses Express, loopback-only) — a supply-chain false positive with zero real impact.

### Changed
- **Persisted LLM API key** — `chat-api.js` now stores the key in `localStorage` instead of `sessionStorage`, so it survives browser restarts. Local single-machine scope; the key stays in the browser's Web Storage and never enters Hesi `data/` or git.

### Docs
- **README (zh/en)** — added an "On `npm audit` Warnings" note under Secure Deployment so downloaders know the `@hono` moderate is a benign false positive.

---

## [v0.2.1] — 2026-07-24

Maintenance drop focused on **discussion-mode stability, the "deep thinking" panel UX, and SSE / context robustness**. No breaking changes; chat API and CLI behavior are preserved.

### Fixed
- **Discussion mode (圆桌) root-cause fix** — `routes/chat/discuss.js` now reuses the main chat's streaming parser (`streamOpenAICore` / `streamAnthropicCore`) as a single source, eliminating the bespoke parser that caused "AI assistant says nothing" + "empty summary" + "token 0/0". Discuss module shrinks 419 → 325 lines.
- **SSE event batching** — `server.js` `compression()` now skips `text/event-stream`, so tool-call events stream in real time instead of dumping at the end (the "all-at-once pop" bug).
- **Truncation mis-detection on local models** — parser now treats `data: [DONE]` / `message_stop` as the authoritative completion signal (not the optional `finish_reason`); fixes false "truncated → resume loop" on qwen3.6 / LM Studio which omit `finish_reason`.
- **Context snowball → 429** — new `capToolRounds()` caps old tool rounds (keep recent 6 + compress earlier), with a corrected Chinese token estimate (`len/1.6`); stops the geometric context growth that blew free-tier token/min limits.
- **Export chat** — filename is now `hesi-chat-YYYYMMDD.md` with `text/plain` MIME so it is selectable / openable on Windows.
- **Thinking panel lifecycle** — "still shows 🤔 after done" + "onToken wiped the tool list" fixed; panel persists through the whole agentic phase and flips to ✅ on `onDone`.

### Added
- **WorkBuddy-style "deep thinking" panel** — live per-tool cards (running → done with duration), collapsible header, semantic icons, and tool-result preview (`<pre>` via `textContent`, XSS-safe).
- **Tool result preview** in SSE `tool_call_end` (server-truncated; the model-context copy is untouched).
- **Lightweight self-check** — detects "全面自检 / 自检" intent and caps to 6 tool rounds, cutting ~20+ LLM calls to ~7.

### Changed
- `max_tokens` raised 16384 → 32768 across 7 sites (handles long local-model summaries without truncation).
- SSE idle timeout raised 60s → 120s (`HESI_LLM_STREAM_IDLE_MS`, configurable).
- README version badge → 0.2.1.

### Verification
- `node --check` on touched server modules (server.js, stream-openai.js, stream-anthropic.js, discuss.js, utils.js, index.js): 0 errors.
- `npm run build`: succeeded (bundle.js ~896kb, lazy-bundle.js ~237kb).
- Runtime: local server returns HTTP 200; qwen3.6-35b self-check no longer mis-triggers truncation.
- Privacy: `data/` and `.workbuddy/` remain untracked (gitignored); no secrets in this drop.

---

## [v0.2.0] — 2026-07-23

Two headline features land on top of v0.1.0-optimized: the **cross-session long-term
memory subsystem** and the **Agnes AI plugin**.

### Added
- **Cross-session long-term memory subsystem** (`lib/memory/*`, `routes/memory/*`, `public/memory/*`)
  - Server-side per-session persistence in `data/memory/` — survives refresh / restart, no longer depends on browser `localStorage`
  - Auto summary compaction (`<session_summary>`) replacing naive truncation; degrades to raw history when the LLM is unavailable
  - BM25 recall injecting a `<memory>` block into the AI context (zero-dependency, local, offline)
  - Layer-A auto profile + facts (`profile.md` / `facts.json`), viewable and forgettable in the 🧠 memory drawer
  - Frontend: left-panel session list (new / resume / search / rename / delete), session recovery on refresh, soft-delete **trash / recycle bin**
  - Legacy `localStorage['qcli-chat-history']` auto-migrated into the first session; `scripts/memory-migrate.js` for offline import
  - Master kill-switch `HESI_MEMORY_ENABLED=0` — whole subsystem off, chat falls back to `localStorage`, zero behavior change
  - 25-case memory test suite (`test/memory-*.test.js`)
- **Agnes AI plugin** (`plugins/agnes-ai/`) — an in-panel workbench (chat / image / video / storyboard) wired through a Hesi backend proxy
  - API key stored **server-side** (`data/plugin-data/agnes-ai/config.json`), never exposed to the browser
  - CORS solved by the Node proxy; streaming (SSE) piped through transparently
  - **Zero new dependencies** — reuses Hesi's existing Node + express; no Python, no extra npm packages
  - Skills square shipped as an external link (skills.sh) in v0.2.0

### Changed
- `npm run check:server` now also syntax-checks `lib/memory/*` and `routes/memory/*`
- `package.json` `files` already includes `plugins/` — the plugin ships with the package

### Verification
- `npm test`: 92 pass / 0 fail (incl. 25 memory cases)
- `npm run check:server`: 0 errors
- Agnes plugin verified live: `/api/plugins` lists `agnes-ai`; proxy returns 400 until a key is configured; config + static assets served correctly

---

## [v0.1.0-optimized] — 2026-07-21

Optimization plan (Phase 0–4) landing: engineering health, local security, and
frontend governance — done without bloating monolithic files or introducing regressions.

### Added
- **Engineering health**
  - GitHub Actions CI (`build` + `node --test` + `plans/` regression) — `.github/workflows/ci.yml`
  - ESLint flat config (`eslint.config.js`), `no-undef` = error
  - husky pre-commit scaffold + `lint-staged` config
  - 9 unit tests: `access-auth`, `asset-hash`, `cli-headless`, `digital-employee-worker`, `escape`, `orchestrator-concurrency`, `rate-limiter`, `ring-buffer`, `terminal-clean`
  - `lib/asset-hash.js` — content hash for `bundle.js` / `lazy-bundle.js` (`?v=` cache-busting)
- **Feature gaps**
  - Digital-employee round-table now really executes — `ws/digital-employee-worker.js` (reuses `agentPool`, runs real tasks)
  - Headless completion — `lib/cli-headless.js` ships 4 verified descriptors (`opencode` / `claude` / `codex` / `aider`), all **stdin-injected, never concatenated into argv**; Windows `shell:true` re-tokenization covered by `test/cli-headless.test.js`
  - `ws/orchestrator.js` supports single-ws concurrent workflows (TUI preserved)
  - Tray / USB packaging scripts (`scripts/build-tray-exe.bat`, `scripts/package-usb.bat`)
- **Local security**
  - `localOriginGuard` in `server.js` — rejects non-loopback Origin state-changing requests (drive-by / CSRF defense for a `127.0.0.1` local tool)
  - `requireToken` hardened on `/api/tools/exec` and upload routes
- **Frontend governance**
  - Consolidated 17 duplicate `escapeHtml` definitions onto `public/escape.js` (single source of truth, attribute-safe, 5-char map)
  - AI API key moved out of `localStorage` → `sessionStorage` (`lib/storage.js` `makeSafeStore` factory; no code path re-persists the secret)
  - XSS scheme allowlist `safeImageUrl()` + field escaping in `multi-media.js` / `digital-employees.js`
- **Docs**
  - README / README_en / SECURE_DEPLOY / AGENTS / CLAUDE aligned to the local-run positioning; README_en synced with the headless + architecture-tree updates

### Changed
- Architecture tree in README reflects `digital-employee.js`, `digital-employee-worker.js`, `asset-hash.js`, and the concurrent orchestrator

### Deferred (P2)
- `window.QCLI` global-singleton convergence (~85 files reference it, ~40 assign it directly) — deferred as P2 due to init-order coupling risk. Planned incrementally: introduce a DI container, replace in batches, run the full test suite after each batch.

### Verification
- `npm test`: 66 pass / 0 fail
- `npm run lint`: 0 errors (pre-existing warnings are non-blocking)
- `npm run plans`: 2/2 pass
- `npm run build`: succeeded (bundle.js 875.5kb, lazy-bundle.js 237.3kb)

---

## Previous releases

Earlier tagged releases (`v1.0.0`, `v1.1.0`) are tracked on the
[GitHub Releases page](https://github.com/qiuqiukof-oss/Hesi/releases). This
`CHANGELOG.md` starts from the optimization drop above.
