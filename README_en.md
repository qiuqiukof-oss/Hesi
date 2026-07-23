<p align="center">
  <strong>Hesi (合思): A Universal Terminal Hub in Your Browser</strong><br>
  <em>Where multiple minds meet to think — together.</em><br>
  <em>Run any CLI · Connect any Agent · Control any Browser</em>
</p>

<p align="center">
  <a href="https://github.com/qiuqiukof-oss/Hesi/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org/en/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node Version"></a>
  <img src="https://img.shields.io/badge/tested_on-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform Support">
</p>

<p align="center">
 <img width="2549" height="1191" alt="image" src="https://github.com/user-attachments/assets/9b4fe940-8b2f-417c-a63a-35a3bf6c7190" />
</p>

<p align="center">
  <b>Turn your browser into a command center for development.</b> Multi-session terminals, multi-agent round-table collaboration, browser automation, and an MCP server — all self-hosted and ready to go.
</p>

---

> ⚠️ **Security Warning · 安全警告**
>
> Hesi can execute arbitrary terminal commands over WebSocket and control browsers (via CDP integration).
> **It is strongly recommended to use it only on loopback addresses (`127.0.0.1` and `::1`) locally. If you must expose it to a non-local network, be sure to set `QCLI_ACCESS_TOKEN` and read the "Secure Deployment" section below.**
> Public deployment without authentication may lead to remote code execution (RCE) risk.

---

## ✨ Why Hesi

- 🧭 **One tab to rule them all** — terminals, AI agents, browsers, document conversion, and MCP tools, unified in a single web console.
- 🤝 **Multi-Agent Round-Table** — let opencode, Codex, aider and friends debate the same task over multiple rounds, instead of working alone.
- 🛡️ **Headless by design** — CLI agents run headless in the background; their rendering is fully decoupled from your interactive terminal, so nothing clashes.
- 🔌 **Open & extensible** — a modular MCP server, a plugin system, and CLI preset templates let you wire in your own toolchain.
- 💻 **Desktop tray bundle** — ships with an offline Node runtime; double-click `tray.bat` and you're ready, zero install.
- 🔒 **Secure & auditable** — per-session auth, audit logs, and security policies; loopback-local runs with zero config.

---

## Contents

- [✨ Why Hesi](#✨-why-hesi)
- [Overview](#overview)
- [The Name](#the-name-命名由来)
- [Features](#features)
- [Quick Start](#quick-start)
- [Desktop Tray Bundle (Offline Portable)](#desktop-tray-bundle-offline-portable)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Testing](#testing)
- [Scripts](#scripts)
- [Contributing](#contributing)
- [Secure Deployment](#secure-deployment)
- [License](#license)

---

## Overview

**Hesi (合思)** is a web-based universal terminal bridging platform. It combines `node-pty` + `xterm.js` with real-time WebSocket communication, giving you a native terminal experience right in the browser. On top of that it integrates AI chat, agent management, modular MCP services, visual panels, and browser automation.

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Everything is a CLI** | Launch any command-line tool in the browser, each in its own independent tab |
| **AI-native** | AI assistant integrated with terminal context-awareness + tool-call chains (with loop detection to prevent runaway) |
| **AI × CLI Agent collaboration** | Multi-round "round-table" discussion between the AI assistant and CLI agents such as opencode / codex / aider to spark ideas |
| **Modular MCP** | Model Context Protocol services with session persistence, security policies, and audit logging |
| **Browser control** | Drive Chrome/Edge via CDP integration — script injection, network monitoring |
| **Extensible** | Plugin system + preset templates + theme customizer + custom CSS injection |

---

## The Name · 命名由来

**合思 (HeSi)** — one name, two happy coincidences.

**中文 / Chinese**
- **合 (Hé)** — collaboration & convergence: multiple agents gathered in one place, where Chinese and Western tool ecosystems meet.
- **思 (Sī)** — thinking & inspiration: the intellect of AI, and that fleeting spark of an idea.
- Together, 合思 sounds like 「巧合的灵思」(*a serendipitous stroke of genius*) — a touch of "out of the blue" delight. Two characters, unforgettable.

**English**
- **HeSi** — four letters, one keystroke away in your terminal. A name built for the CLI.
- **He** + **Si** (pinyin for 「思」, *thinking*) reads almost exactly as *"He thinks"* — a thinking companion, a purely delightful coincidence.
- Ends on a vowel, rolls right off the tongue.

> In one line: **Hesi is where multiple AIs come together to 「合」 (converge) and 「思」 (think).**
> *Hesi is where multiple minds meet to think — together.*

---

## Features

### 🖥️ Multi-Session Terminal

- **xterm.js + WebGL rendering** — smooth terminal output, with both WebGL and Canvas render backends
- **Multi-tab management** — each tab runs an independent PTY process, without interfering; supports drag-to-reorder and pinning
- **In-terminal search** — Ctrl+Shift+F to search terminal output, with up/down navigation
- **Link detection** — auto-recognizes file paths and URLs; click to preview in browser
- **Adaptive sizing** — fits the container via FitAddon
- **Session persistence** — terminal content stored in IndexedDB, restored after page reload
- **Font adjustment** — Ctrl+= / Ctrl+- for live font scaling (8–32px range)

### 🔍 CLI Auto-Discovery & Presets

- **PATH scanning** — automatically scans executables on the system to build a quick-launch list
- **Preset system** — built-in presets for developers, data scientists, sysadmins, media engineers, etc.
- **Preset inheritance** — presets support chained `extends` inheritance to share base config
- **Cache acceleration** — 24-hour on-disk cache to avoid repeated scans on every launch
- **Version detection** — auto-detects CLI version numbers (tries multiple flags: `--version`, `-v`, `-V`)
- **Type classification** — auto-detects interactive/batch types, supports custom categories
- **Folder organization** — create folder groups, drag to categorize
- **Favorites** — pin frequently-used CLIs in the left sidebar; the Agent dropdown in discussion mode **auto-syncs with favorites** (favorited items are pre-checked, pinned to top, and marked with ★)

### 🤖 AI Integration

- **Multiple providers** — OpenAI, Anthropic, LM Studio (local models)
- **SSE streaming** — structured event types (token/status/error/tool_call/usage), 120s idle timeout protection (configurable via `HESI_LLM_STREAM_IDLE_MS`)
- **Terminal context awareness** — auto-captures the latest 100 lines of terminal output as the system message
- **Incremental context trimming** — only sends changed delta lines to save tokens
- **Tool-call chains** — consecutive tool calls include loop detection (cycle detection + windowed dedupe + hard cap) to prevent "instantly hitting the limit" runaway; a live "deep thinking" panel renders per-tool cards (running → done-with-duration + result preview, XSS-safe)
- **Lightweight self-check** — detects "全面自检 / 自检" (full self-check) intent and caps tool rounds to 6, cutting redundant LLM calls
- **Tool set** — file read/write, web search, terminal execution, document conversion, image/video generation
- **Browser control tools** — navigation, screenshots, clicks, input, JS execution, DOM snapshots, form filling
- **Self-evolution** — can read/modify its own source, rebuild the frontend, screenshot to inspect the UI

### 🤝 AI Assistant × CLI Agent Collaborative Discussion (Round-Table)

> This is Hesi's core collaboration scenario: let the "AI assistant" and one or more "CLI agents (e.g. opencode)" hold a **multi-round discussion** on the same problem, questioning, complementing, and refining each other's approaches.

- **Multi-select discussion partners** — click "Discuss" in the chat panel and multi-select (up to 4) from the discovered CLI agents as participants
- **Multi-round iteration** — configurable discussion rounds; the AI assistant and agents speak in turns, converging round by round
- **Incremental extraction** — each round only feeds the **new output** of an agent to the AI (prevents the same text from repeatedly filling the context)
- **Favorites sync** — the discussion dropdown merges `/api/agents` and `/api/clis`, and reads the left-sidebar favorites; **favorited items are pre-checked, pinned to top, and marked with ★**
- **Timeout & cleanup** — a single agent session auto-terminates after a 5-minute timeout; completed sessions are cleaned up after a 5-minute TTL

### 🛡️ CLI Agent Rendering Fix · Headless Agent Execution

> Full-screen TUI CLI agents (such as **opencode**) draw ASCII UI/status bars in the PTY. Their rendered frames are literal text — after stripping escape codes only fragments remain, which pollutes the discussion text fed to the AI (manifests as "stuck in UI rendering, no substantive analysis").

- **Headless subcommand** — for agents that declare a headless mode, use a non-interactive subcommand and inject the task through a **stdin pipe** (non-TTY, eliminating the TUI at the source); output is clean plain text
- **Multi-CLI support** — the `HEADLESS` map in `lib/cli-headless.js` currently ships four built-in descriptors (all empirically tested, task prompts uniformly injected via stdin and **never concatenated into argv**): `opencode` (`opencode run`), `claude` (`claude -p`), `codex` (`codex exec -`), `aider` (`--yes-always --no-auto-commits --no-pretty --no-stream`); adding another CLI only needs one more descriptor entry
- **Windows security note** — headless execution on Windows launches with `shell:true`, which re-tokenizes argv, so **multi-line / quote-containing prompts MUST be injected via stdin** (covered by the `test/cli-headless.test.js` regression using a malicious prompt containing `"`/newlines/`rm -rf`)
- **Fallback compatibility** — agents without a declared headless mode still go through PTY + escape cleaning (`lib/terminal-clean.js`), behavior unchanged
- **TUI preserved** — the human-interactive terminal (`ws/agent.js`) and workflows (`ws/orchestrator.js`) keep their full TUI, unaffected

### 🌐 Browser Control (CDP)

- **Auto-connect** — detects Chrome/Edge CDP ports (default `localhost:9222`)
- **Page operations** — navigation, forward/back, refresh, screenshot, JS execution
- **Element interaction** — click, input, hover, scroll
- **Console monitoring** — real-time browser console logs
- **Tab management** — list/switch all browser tabs
- **Browser farm** — manage multiple isolated browser sessions in parallel
- **User scripts** — inject custom JS scripts that auto-run on specified URL patterns
- **DOM Diff** — compare DOM snapshots to track page changes
- **Auto form filling** — auto-detect and fill form fields
- **Accessibility analysis** — detect page accessibility issues
- **Network monitoring** — capture HTTP requests/responses in real time, with HAR import/export

### 📄 Document Conversion

- **AI-driven** — convert directly inside AI chat via the `convert_document` tool
- **Multi-format** — PDF / DOCX / PPTX / HTML / EPUB / LaTeX / RST / Markdown
- **Pandoc-powered** — auto-detects system pandoc; supports the `PANDOC_PATH` env var
- **Smart degradation** — falls back to a built-in Markdown→HTML converter when pandoc is absent

### 🔌 Modular MCP Server

- **Modular architecture** — the `mcp/` directory contains tools, resources, security, and session-management submodules
- **Session management** — `SessionManager` + `RingBuffer` + TTL auto-expiry
- **Security layer** — Bearer auth + audit logging + YAML policy files
- **Cache layer** — LRU cache + METRIC stats + heartbeat reporting
- **AI bridging** — MCP → OpenAI Function Calling conversion
- **Auto-restart** — health checks + exponential backoff restart
- **Rate limiting** — Token Bucket algorithm to prevent tool-call storms
- **Output truncation** — tool results auto-truncated (4K character cap)

### ✅ Code Quality & Security

- **PTY environment-variable filtering** — auto-filters sensitive patterns like API_KEY/TOKEN/PASSWORD
- **Two-tier rate limiting** — global API + WebSocket message + upload rate limits
- **Regression tests** — three layers: terminal cleaning, discussion coordinator, stability (tool interruption / rate limiting / stream completion / cycle detection)
- **Prettier + ESLint** — unified code formatting + lint-staged pre-commit checks

### 📊 Visual Panels

- **Dashboard** — system status, CLI stats, resource monitoring
- **Stock analysis / quant trading / budget** — real-time quotes, strategy backtests, income/expense stats
- **Media management** — image/video/PDF browser preview
- **MCP monitoring** — real-time event-frequency charts, tool-call distribution, incremental event log
- **Rate-limit status** — real-time per-route request frequency and 429 hit counts
- **Plugin management / plugin marketplace** — enable/disable, hot-reload, discover community plugins

### 🎙️ User Experience

- **Command palette** — Ctrl+K to quickly search CLIs and actions
- **Voice input / output** — Web Speech API input; TTS reads AI replies aloud
- **Theme customizer** — built-in presets + custom saves
- **Multilingual UI** — switch between Chinese / English instantly
- **Notification system** — Toast notifications + notification center
- **Custom CSS** — live-inject custom styles
- **Welcome carousel** — onboarding intro for first-time use

---

## Quick Start

### Prerequisites

| Item | Requirement |
|------|-------------|
| **Node.js** | >= 18.0.0 |
| **npm** | >= 9.0.0 |
| **OS** | Windows / macOS / Linux |

### Install

```bash
git clone https://github.com/qiuqiukof-oss/Hesi.git
cd Hesi               # (Need to unzip the portable node to the directory)
npm install
npm run build          # production frontend build (outputs public/bundle.js)
npx playwright install chromium   # optional, for browser-control features
cd Hesi/tray
npm install
```

### Start

```bash
npm start              # → http://localhost:3001 (listens on 127.0.0.1 and ::1 by default)
npm run dev            # development mode (hot reload)
npm run mcp            # start the MCP service standalone
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP service port |
| `HOST` | `loopback` | Bind address; setting `0.0.0.0` prints a high-risk warning |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | LLM provider keys (optional) |
| `STABILITY_API_KEY` / `BING_SEARCH_API_KEY` / `TAVILY_API_KEY` | — | Image/search keys (optional) |
| `PANDOC_PATH` | — | Pandoc path (optional, document conversion) |
| `QCLI_ACCESS_TOKEN` | `""` | Access token; once set, all sensitive `/api` and WebSocket require auth (loopback exempt by default) |
| `QCLI_TOKEN_REQUIRE_LOOPBACK` | `""` | Set to `1` to force token even on loopback |
| `QCLI_CORS_ORIGINS` | `""` | Comma-separated CORS allowlist |
| `QCLI_POLICY_PATH` | `""` | MCP security policy file (default `blocklist`) |
| `QCLI_WITH_MCP` / `QCLI_MCP_TOKEN` | `""` | Auto-start MCP / MCP Bearer token |
| `QCLI_AUDIT_LOG` | `""` | MCP audit-log path |
| `QCLI_SESSION_TTL` | `900000` | Session idle expiry (ms) |
| `QCLI_MAX_SESSIONS` | `10` | Max concurrent sessions |

> 💡 See `./.env.example` for the full list.

---

## Desktop Tray Bundle (Offline Portable)

Hesi also ships an **out-of-the-box offline agent bundle**: it bundles a portable Node.js, requires no installation, and starts on double-click.

```text
Windows: double-click tray.bat
macOS  : run ./tray.sh in a terminal (chmod +x tray.sh on first run)
Linux  : run ./tray.sh in a terminal
```

- After launch a Hesi icon appears in the tray and `http://127.0.0.1:4264` opens automatically
- On the welcome page, click "AI Agents (one-click install)" to install OpenCode / Codex etc. offline
- Tray menu: Open Hesi / Open (CDP mode) / Stop service / Exit
- Binds to loopback only by default; not exposed to the LAN
- macOS "cannot verify developer": run `xattr -dr com.apple.quarantine .` then retry
- Port in use: set the `PORT` env var to switch ports

---

## Architecture

```
├── server.js              # Express entry + static file serving
├── ws-handler.js          # WebSocket connection management + PTY (core terminal logic)
├── cli-discovery.js       # CLI auto-discovery engine (with on-disk registry cli-registry.json)
├── cli-registry.json      # CLI registry (agent list / favorites source, persisted at runtime)
├── preset-loader.js       # Preset loader
├── rate-limiter.js        # API rate limiter
├── ring-buffer.js         # Ring buffer
├── mcp-server.js          # MCP sidecar entry
├── mcp/                   # Modular MCP architecture (tools/resources/security/session)
├── ws/                    # WebSocket subsystem
│   ├── pty.js             # PTY creation abstraction + createHeadlessExec (headless agent execution)
│   ├── pty-policy.js      # PTY policy engine
│   ├── message-dispatch.js # WebSocket message routing
│   ├── agent.js           # Human-interactive agent terminal (preserves TUI)
│   ├── orchestrator.js     # Workflow orchestration (preserves TUI, supports single-ws concurrent workflows)
│   ├── digital-employee.js       # Digital-employee team (roles/personas/task dispatch)
│   ├── digital-employee-worker.js # Digital-employee task executor (reuses agentPool, runs real tasks)
│   └── context-store.js    # Shared context store
├── routes/                # RESTful API routes
│   ├── chat/              # AI chat + discuss (AI × CLI Agent round-table)
│   ├── ai-tools/          # Agent pool (agent-pool.js) + sync delegate (builtin/agent.js)
│   ├── clis.js / agents.js # CLI / Agent discovery (with category, backing favorites sync)
│   └── ...                # remaining routes
├── lib/
│   ├── cli-headless.js     # Headless agent descriptor table (opencode/claude/codex/aider, all via stdin)
│   ├── asset-hash.js       # Content hash for bundle.js/lazy-bundle.js (?v= cache-busting)
│   ├── terminal-clean.js   # TUI escape cleaning (CSI/OSC/bare-ESC streaming clean)
│   ├── env-filter.js       # PTY environment-variable filter
│   ├── access-auth.js      # Optional access-token auth
│   └── mcp-process.js      # MCP subprocess management
├── public/                # Frontend static assets (bundle.js built by esbuild)
├── cli-presets/           # CLI preset configs
├── workflows/             # Preset workflow orchestrations
├── plugins/               # Plugin system
├── tray/ + tray.bat/tray.sh  # Desktop tray launcher (offline portable bundle)
└── node/                  # Portable Node.js runtime (for offline bundle)
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js + Express |
| **Terminal** | node-pty + xterm.js + WebGL |
| **Transport** | WebSocket (ws) + SSE |
| **Build** | esbuild |
| **AI** | OpenAI API / Anthropic API |
| **Browser control** | Playwright + CDP |
| **Storage** | IndexedDB + safeStorage |
| **Code quality** | ESLint + Prettier + Husky |
| **Testing** | node --test + plans/ regression suite |
| **Docs** | OpenAPI 3.0 + JSDoc |
| **Voice** | Web Speech API |
| **Charts** | Custom Canvas engine (ChartCore) |

---

## Testing

The regression suite lives in `plans/` (plain Node scripts, no framework needed):

```bash
node plans/verify-terminal-clean.js          # terminal escape cleaning (9 cases)
node plans/test-discuss.js                  # discussion coordinator module-contract regression (7 checks: load/export/shape/async/arity/cache)
node plans/test-stability-regression.js     # stability regression (37 cases: tool interruption / rate limiting / stream completion / cycle detection)
```

Syntax and structure checks:

```bash
npm run check:server    # node --check syntax check on all server-side modules
npm run lint            # ESLint
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the production service |
| `npm run dev` | Development mode (`--watch` hot reload) |
| `npm run build` | Build frontend (esbuild minify, produces public/bundle.js) |
| `npm run build:dev` | Development build (with sourcemap) |
| `npm run watch` | Frontend watch mode |
| `npm run mcp` | Start the MCP service standalone |
| `npm run check:server` | Server-side module syntax check |
| `npm run lint` / `npm run format` | ESLint / Prettier |

---

## Contributing

Contributions are welcome — feature requests, bug reports, or code PRs.

### Dev Workflow

```bash
git clone <your-fork>
cd Hesi
npm install
npm run dev
npm run build
```

### Code Conventions

- Backend: CommonJS (`require`/`module.exports`)
- Frontend: ESM (`import`/`export`), bundled via esbuild
- New features should ship with a regression test (placed in `plans/`)

---

## Secure Deployment

Hesi is fundamentally a **local-first** terminal/browser hub: it executes arbitrary commands over WebSocket and controls browsers via CDP. The default configuration therefore follows a "minimum exposure surface" principle — secure out of the box.

### On `npm audit` Warnings

After `npm install`, `npm audit` may report some vulnerabilities (including a moderate in `@hono/node-server`). These come from an **indirect dependency of `@modelcontextprotocol/sdk`**; Hesi itself uses an **Express** server and **does not call Hono's `serve-static`**. The service also **binds to loopback only**, never exposed to the public network. That path is therefore dead code and has **no practical impact on local deployments** — it is a supply-chain false positive and can be ignored. Other directly fixable vulnerabilities have been upgraded to compatible versions via `npm audit fix` (without `--force`).

### Default Security Posture (Out of the Box)

| Item | Default Behavior |
|------|-----------------|
| Bind address | Loopback `127.0.0.1` and `::1` (local only). Setting `HOST=0.0.0.0` prints a high-risk warning |
| CORS | Same-origin/loopback only; cross-origin needs an explicit `QCLI_CORS_ORIGINS` allowlist |
| Access token | Off when `QCLI_ACCESS_TOKEN` is unset; once set, all sensitive `/api` and WebSocket require a token |
| Command policy | `blocklist` mode with a built-in dangerous-command blacklist; overridable via `QCLI_POLICY_PATH` |
| Rate limiting | Global API + WebSocket message + upload limits; **loopback exempt by default** |
| Terminal isolation | node-pty degrades gracefully if not compiled |
| Upload dir | User uploads written to `uploads/.user/` (hidden, readable after auth) |

### Public / Multi-User Deployment Checklist

> ⚠️ Only expose to a non-local network when ALL of the following are satisfied.

1. **Set an access token**: `QCLI_ACCESS_TOKEN=<strong-random-token>`; HTTP header `Authorization: Bearer <token>`, append `?token=<token>` to WebSocket
2. **Tighten CORS**: `QCLI_CORS_ORIGINS=https://your-frontend.example.com`
3. **Harden command policy**: point `QCLI_POLICY_PATH` at a `blocklist`/`allowlist` policy, or tighten to `allowlist`
4. **MCP auth**: `QCLI_MCP_TOKEN` + keep `QCLI_AUDIT_LOG` enabled
5. **Reverse proxy**: front with Nginx/Caddy enabling HTTPS/HSTS; restrict `/api/uploads` origin
6. **Never run as root**; update dependencies regularly

### Security Baseline Self-Check

```bash
[ "$HOST" = "0.0.0.0" ] && echo "WARN: HOST=0.0.0.0 exposes all interfaces" || echo "OK: loopback by default"
[ -n "$QCLI_ACCESS_TOKEN" ] && echo "OK: access token set" || echo "WARN: no access token"
```

---

## License

MIT License — see [LICENSE](./LICENSE) for details.

## Badges

> Placeholder badges below — replace with real CI / version / download links.

[![CI](https://img.shields.io/badge/CI-passing-brightgreen?style=flat)](https://github.com/qiuqiukof-oss/Hesi/actions)
[![Version](https://img.shields.io/badge/version-0.2.1-blue.svg)](https://github.com/qiuqiukof-oss/Hesi/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/qiuqiukof-oss/Hesi)
[![Stars](https://img.shields.io/badge/stars-%E2%98%85%20your__stars__here-yellow?style=flat)](https://github.com/qiuqiukof-oss/Hesi/stargazers)

<p align="center">
  <sub>Built with ❤️ by Hesi Contributors</sub>
</p>
