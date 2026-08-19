/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Agent-Aware System Prompt Injection
 *
 * Injects browser capability awareness into agent system prompts.
 * Three tiers based on agent type:
 * - orchestrator → Full section with decision logic, trigger phrases
 * - general-worker → Lightweight tool availability note
 * - specialist → Nothing (no pollution)
 *
 * Classification is automatic via prompt content analysis — no agent name whitelist.
 */

import type { Hooks } from "@opencode-ai/plugin";

// ─── Injection Content Templates ─────────────────────────────────────

/** Full section for orchestrator-type agents (Sisyphus, Hephaestus, FreeBuff, etc.) */
const BROWSER_FULL_SECTION = `
<NetForge_Browser>
## Browser Automation (provided by NetForge plugin)

Hesi can control a real browser instance. **Use the browser** for any task that involves rendered pages, interactive websites, or visual verification — do NOT fall back to curl/webfetch for these.

### When to Use the Browser
| Scenario | Examples | Reason |
|----------|----------|--------|
| JavaScript-rendered pages | SPAs, dashboards, post-login content | curl/webfetch returns no meaningful data |
| Web-based AI services | Claude, ChatGPT, Gemini, Perplexity web UIs | No API key required |
| Web tools | Canva, Suno, Midjourney, Figma | No SDK integration needed |
| Screenshots / visual QA | UI review, competitor screenshots | Only reliable method |
| File upload / download | Web tools processing files | CDP natively supports this |
| Interactive flows | Forms, multi-step workflows, login flows | Click / type / wait |

### Decision Rule
- **Use browser**: Any task involving rendering, login, interaction, or visual output
- **Use normal tools**: Plain text fetching, known API endpoints, local file operations

### How to Invoke
1. \`skill("netforge-web-tool")\` — load the web interaction workflow skill
2. \`skill("netforge-multimodel")\` — load the multi-model parallel inference skill
3. Direct MCP tools: \`browser_navigate\` → \`browser_screenshot\` → \`browser_click\` etc.
4. Delegate to browser agent: \`task(agent="netforge-browser", ...)\`
5. Slash commands: \`/browser\` \`/screenshot\`

### Phase 0 Intent Routing (add these triggers)
When user intent matches any of these, route to the browser:
- "Compare [model A] and [model B] responses"
- "Use [web tool] to do [task]"
- "Fetch / scrape / download [URL]"
- "Open [site] and show me"
- "Screenshot [URL]"
- "Monitor [URL] for changes"

### Constraints
- Browser MCP server starts on demand — no manual management needed
- CAPTCHAs / 2FA → pause and ask for human help
- Max 5 simultaneous tabs
- Browser window is headless by default; set NETFORGE_HEADLESS=false for visible mode
</NetForge_Browser>`;

/** Lightweight note for general worker subagents — just says tools are available */
const BROWSER_LITE_SECTION = `
<NetForge_Browser>
Browser tools available. If you need to interact with a web page, take screenshots, or use web-based AI:
- \`task(agent="netforge-browser", prompt="...")\` — delegate to the browser agent
- \`skill("netforge-web-tool")\` — load the web interaction workflow
- \`skill("netforge-multimodel")\` — load multi-model inference
- MCP tools: \`browser_navigate\`, \`browser_screenshot\`, \`browser_click\`, \`browser_type\`
</NetForge_Browser>`;

// ─── Agent Classification ───────────────────────────────────────────

type AgentClass = "orchestrator" | "general-worker" | "specialist";

/**
 * Classify agent by analyzing system prompt content.
 *
 * Orchestrators: contain Phase 0 / Intent Gate / Decompose AND Delegate patterns
 * Specialists: contain read-only / contextual grep / reference grep / Plan Consultant patterns
 * General workers: everything else (custom .md subagents)
 */
function classifyAgent(promptText: string): AgentClass {
  // Orchestrator — the main decision-making agents
  if (
    promptText.includes("Phase 0 - Intent Gate") ||
    promptText.includes("Decompose AND Delegate") ||
    promptText.includes("Intent Verbalization") ||
    promptText.includes("You are Sisyphus")
  ) {
    return "orchestrator";
  }

  // Specialist — purpose-built narrow agents
  if (
    promptText.includes("read-only consultation") ||     // Oracle
    promptText.includes("contextual grep") ||             // Explore
    promptText.includes("reference grep") ||              // Librarian
    promptText.includes("Plan Consultant") ||             // Metis
    promptText.includes("Plan Critic") ||                 // Momus
    promptText.includes("analyze media files")            // multimodal-looker
  ) {
    return "specialist";
  }

  // Everything else → general worker
  return "general-worker";
}

// ─── Main Hook ──────────────────────────────────────────────────────

export const createSystemTransformHook: Hooks["experimental.chat.system.transform"] =
  async (_input, output) => {
    const promptText = output.system.join("\n");
    const agentClass = classifyAgent(promptText);

    switch (agentClass) {
      case "orchestrator": {
        // Inject full section right before Constraints block
        const insertIndex = output.system.findIndex(
          (msg) =>
            msg.includes("<Constraints>") ||
            msg.includes("## Hard Blocks") ||
            msg.includes("## Constraints")
        );
        if (insertIndex >= 0) {
          output.system.splice(insertIndex, 0, BROWSER_FULL_SECTION);
        } else {
          output.system.push(BROWSER_FULL_SECTION);
        }
        break;
      }

      case "general-worker": {
        // Append lightweight note at the end
        output.system.push(BROWSER_LITE_SECTION);
        break;
      }

      case "specialist": {
        // Nothing — they don't need browser awareness
        // They can still use browser via delegate_task / MCP tools
        break;
      }
    }
  };
