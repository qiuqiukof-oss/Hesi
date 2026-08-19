# NetForge — Hesi Browser Engine Plugin

Add browser automation to any Hesi agent. Navigate, screenshot, click, type — no API keys needed.

## Quick Install

```bash
# Automatic (Hesi plugin system)
omo plugin install path/to/netforge-plugin

# Or manual: just symlink to ~/.claude/plugins/
node scripts/register-plugin.mjs
```

## What You Get

| Component | Description |
|-----------|-------------|
| **MCP Browser Server** | 6 CDP-based browser tools (navigate, screenshot, click, type, evaluate, close) |
| **Agent-Aware Prompt Injection** | Orchestrator gets full browser awareness; specialists get zero pollution |
| **Tool Interception** | webfetch on JS-render sites → auto-routed to browser |
| **Skill: netforge-web-tool** | Web interaction workflow pattern |
| **Skill: netforge-multimodel** | Multi-model AI comparison workflow |
| **Agent: netforge-browser** | Dedicated browser subagent |

## Architecture

```
netforge-plugin/
├── .claude-plugin/plugin.json   → Manifest (MCP, skills, agents, hooks)
├── .mcp.json                     → Browser MCP server config
├── src/
│   ├── index.ts                  → @opencode-ai/plugin hooks registration
│   ├── system-transform.ts       → Agent-aware prompt injection (3 tiers)
│   └── tool-interceptor.ts       → webfetch routing + QA reminders
├── mcp/
│   └── start-browser.mjs         → CDP-based browser MCP server
├── skills/
│   ├── netforge-web-tool/        → Web interaction skill
│   └── netforge-multimodel/      → Multi-model comparison skill
├── agents/
│   └── netforge-browser.md       → Browser subagent definition
└── hooks/hooks.json              → Session/pre-tool/post-tool hook config
```

## Requirements

- Node.js 18+
- Chrome, Edge, or any Chromium browser (for browser features)
- Hesi (oh-my-openagent) installed

## Browser Setup

By default, NetForge starts Chrome in headless mode on port 9222. Configure via env vars:

- `NETFORGE_CDP_PORT` — CDP debug port (default: 9222)
- `NETFORGE_HEADLESS` — set to `"false"` for visible browser window
- `NETFORGE_MAX_TABS` — max concurrent tabs (default: 5)
- `NETFORGE_BROWSER_DEBUG` — set to `"true"` for verbose logging

If Chrome is already running with `--remote-debugging-port=9222`, NetForge will reuse it instead of starting a new instance.

## How Agent Awareness Works

The plugin classifies each agent by analyzing its system prompt:

1. **Orchestrators** (Sisyphus, FreeBuff, etc.) — get full `<NetForge_Browser>` section with decision logic, trigger phrases, and invocation rules
2. **General workers** (custom subagents) — get a lightweight tool availability note
3. **Specialists** (Oracle, Explore, Librarian) — get nothing (no context pollution)
