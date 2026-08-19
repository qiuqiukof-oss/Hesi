/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Tool Interceptor Hooks
 *
 * Before tool: catches webfetch on JS-render sites → browser hint
 * After tool: detects frontend file writes → suggests visual QA
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
];

export const createToolBeforeHook = async (input, output) => {
  if (input.tool === "webfetch") {
    const url = output.args?.url || "";
    const needsBrowser = BROWSER_REQUIRED_SITES.some((d) => url.includes(d));
    if (needsBrowser) {
      output.args = {
        ...output.args,
        _netforge_hint: `[NetForge] ${url} requires JS rendering. Use browser: /browser or skill("netforge-web-tool") or delegate to agent="netforge-browser".`,
      };
    }
  }
};

export const createToolAfterHook = async (input, output) => {
  if (["edit", "write", "Edit", "Write"].includes(input.tool)) {
    const filePath = input.args?.filePath || "";
    const isFrontend =
      filePath.endsWith(".html") ||
      filePath.endsWith(".css") ||
      filePath.endsWith(".jsx") ||
      filePath.endsWith(".tsx") ||
      filePath.endsWith(".vue") ||
      filePath.endsWith(".svelte");

    if (isFrontend && output.output && !output.output.includes("NetForge")) {
      output.output += `\n\n---\n[NetForge] Frontend file changed: ${filePath}. Verify visually via browser.`;
    }
  }
};
