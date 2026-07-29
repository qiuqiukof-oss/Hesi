/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Tool Interceptor Hooks
 *
 * Two hooks for transparent browser routing:
 * 1. tool.execute.before — catches webfetch on known JS-render sites → redirects to browser
 * 2. tool.execute.after — detects frontend file writes → suggests visual QA
 */

import type { Hooks } from "@opencode-ai/plugin";

/**
 * Sites known to require JavaScript rendering.
 * webfetch/curl will return empty or incomplete content for these.
 */
const BROWSER_REQUIRED_SITES = [
  "chatgpt.com",
  "claude.ai",
  "gemini.google.com",
  "x.ai",
  "perplexity.ai",
  "chat.deepseek.com",
  "kimi.moonshot.cn",
  "qwen.aliyun.com",
  "huggingface.co",
  "github.com",
  "gitlab.com",
];

export const createToolBeforeHook: Hooks["tool.execute.before"] =
  async (input, output) => {
    // Intercept webfetch — if URL needs browser, rewrite the behavior
    if (input.tool === "webfetch") {
      const args = output.args as { url?: string } | undefined;
      const url = args?.url || "";

      const needsBrowser = BROWSER_REQUIRED_SITES.some((domain) =>
        url.includes(domain)
      );

      if (needsBrowser) {
        // Signal that this should be routed to browser instead
        // The agent will see this guidance in the output
        output.args = {
          ...output.args,
          _netforge_hint: `[NetForge] ${url} requires JavaScript rendering. Use the browser instead: /browser ${url} or skill("netforge-web-tool") or delegate to agent="netforge-browser".`,
        };
      }
    }
  };

export const createToolAfterHook: Hooks["tool.execute.after"] =
  async (input, output) => {
    // After editing frontend files, suggest visual verification
    if (["edit", "write", "Edit", "Write"].includes(input.tool)) {
      const args = input.args as { filePath?: string } | undefined;
      const filePath = args?.filePath || "";

      const isFrontend =
        filePath.endsWith(".html") ||
        filePath.endsWith(".css") ||
        filePath.endsWith(".jsx") ||
        filePath.endsWith(".tsx") ||
        filePath.endsWith(".vue") ||
        filePath.endsWith(".svelte");

      if (isFrontend) {
        const existingOutput = output.output || "";
        if (!existingOutput.includes("NetForge")) {
          output.output =
            existingOutput +
            `\n\n---\n[NetForge] Frontend file changed: ${filePath}. Open a browser to visually verify the change: /browser or skill("netforge-web-tool") with "take screenshot of preview".`;
        }
      }
    }
  };
