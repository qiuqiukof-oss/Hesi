# Changelog

All notable changes to **Hesi（合思）** are documented here. This project follows
a lightweight [Keep a Changelog](https://keepachangelog.com/) convention; versions
use `vMAJOR.MINOR.PATCH-<tag>`.

---

## [v0.2.3] — 2026-07-24

AI 多媒体生成能力 + 聊天框链接可点击。

### Added
- **AI 多媒体生成引导提示词** — 主聊天系统提示词新增「多媒体生成」段，引导 AI 主动、且高质量地调用 `generate_image` / `generate_video`（Agnes 插件），并把中文意图改写为细节化英文 prompt + 负面提示词。
- **聊天框链接可点击** — `renderMarkdown` 新增白名单链接化（`http(s)://`、`file://`、`/uploads/`），代码块/行内代码内的 URL 不会被误链；输入已转义且不接受 `javascript:` 等协议 ⇒ XSS 安全。

### Fixed
- **视频生成不可用（真 bug）** — `routes/ai-tools/builtin/index.js` 此前漏注册 `videoGen`，`generate_video` 从未进入工具表，主聊天 AI 只能生图不能生视频；现已补注册。
- **视频生成进度回调硬报错** — `video-gen.js` 的 `progressFn` 实为字符串（registry 第三参透传的是 requestId），每次调用必抛 TypeError 被 catch → 返回"生成失败"；统一改为 `emitProgress` 走 `broadcastFn`。
- **图片/视频返回 token 精简** — `image-gen.js` 最终返回从 verbose 表格（~250 token）改为简洁一行（~60 token），降低回灌 LLM 上下文占用。

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
