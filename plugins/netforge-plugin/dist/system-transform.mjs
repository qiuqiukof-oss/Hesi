/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Agent-Aware System Prompt Injection
 *
 * Three tiers:
 * - orchestrator → Full browser capability section (decision logic, trigger phrases)
 * - general-worker → Lightweight tool availability note
 * - specialist → Nothing (no pollution)
 */

// ─── Injection Content Templates ───────────────────────────

const BROWSER_FULL_SECTION = `
<NetForge_Browser>
## Browser Automation (provided by NetForge plugin)

Hesi can control a real browser instance. **Use the browser** for any task that involves rendered pages, interactive websites, or visual verification.

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
3. Direct MCP tools: \`browser_navigate\` \`browser_screenshot\` \`browser_click\` etc.
4. Delegate: \`task(agent="netforge-browser", ...)\`

### Phase 0 Intent Routing Triggers
Route to browser when user says:
- "Compare [model A] and [model B] responses"
- "Use [web tool] to do [task]"
- "Fetch / scrape / download [URL]"
- "Open [site] and show me"
- "Screenshot [URL]"
- "Monitor [URL] for changes"

### Constraints
- Browser MCP server starts on demand
- CAPTCHAs / 2FA → pause and ask for human help
- Max 5 simultaneous tabs
</NetForge_Browser>`;

const BROWSER_LITE_SECTION = `
<NetForge_Browser>
Browser tools available:
- \`task(agent="netforge-browser", prompt="...")\` — delegate to browser agent
- \`skill("netforge-web-tool")\` — load web interaction workflow
- \`skill("netforge-multimodel")\` — load multi-model inference
- MCP tools: \`browser_navigate\`, \`browser_screenshot\`, \`browser_click\`, \`browser_type\`
</NetForge_Browser>`;

// ─── Agent Classification ─────────────────────────────────

function classifyAgent(promptText) {
  // Orchestrator
  if (
    promptText.includes("Phase 0 - Intent Gate") ||
    promptText.includes("Decompose AND Delegate") ||
    promptText.includes("Intent Verbalization") ||
    promptText.includes("You are Sisyphus")
  ) {
    return "orchestrator";
  }

  // Specialist
  if (
    promptText.includes("read-only consultation") ||
    promptText.includes("contextual grep") ||
    promptText.includes("reference grep") ||
    promptText.includes("Plan Consultant") ||
    promptText.includes("Plan Critic") ||
    promptText.includes("analyze media files")
  ) {
    return "specialist";
  }

  return "general-worker";
}

// ─── Main Hook ─────────────────────────────────────────────

export const createSystemTransformHook = async (_input, output) => {
  const promptText = output.system.join("\n");
  const agentClass = classifyAgent(promptText);

  switch (agentClass) {
    case "orchestrator": {
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
      output.system.push(BROWSER_LITE_SECTION);
      break;
    }

    case "specialist": {
      // No pollution
      break;
    }
  }
};
