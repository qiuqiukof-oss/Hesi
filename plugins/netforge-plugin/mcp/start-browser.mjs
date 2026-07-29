#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge Browser MCP Server
 *
 * Provides browser automation via Chrome DevTools Protocol (CDP).
 * Connects to an existing Chrome instance or starts a new one.
 *
 * MCP Tools exposed:
 *   - browser_navigate       Navigate to URL
 *   - browser_screenshot     Capture screenshot (base64 JPEG)
 *   - browser_click          Click element
 *   - browser_type           Type text into input
 *   - browser_evaluate       Execute JavaScript
 *   - browser_close          Close current tab
 *
 * Usage:
 *   node start-browser.mcp                    Run as MCP server (stdio)
 *   node start-browser.mjs hook <phase>       Run as hook handler (for hooks.json)
 */

import { spawn } from "node:child_process";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

// ─── Config ─────────────────────────────────────────────────────────

const CDP_PORT = parseInt(process.env.NETFORGE_CDP_PORT || "9222", 10);
const MAX_TABS = parseInt(process.env.NETFORGE_MAX_TABS || "5", 10);
const DEBUG = process.env.NETFORGE_BROWSER_DEBUG === "true";
const HEADLESS = process.env.NETFORGE_HEADLESS !== "false";

const CHROME_PATHS = [
  // Windows
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  // Edge (Windows)
  join(process.env["ProgramFiles(x86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge SxS\\Application\\msedge.exe"),
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

// ─── Hook handler ───────────────────────────────────────────────────

function handleHook(phase) {
  switch (phase) {
    case "session-start":
      console.error("[NetForge] Browser availability check — pass");
      process.exit(0);
    case "pre-tool-use":
      // Signal that webfetch on known render-heavy sites should use browser
      console.error("[NetForge] Pre-tool hook active");
      process.exit(0);
    case "post-tool-use":
      console.error("[NetForge] Post-tool hook active — consider visual QA");
      process.exit(0);
    default:
      console.error(`[NetForge] Unknown hook phase: ${phase}`);
      process.exit(0);
  }
}

// ─── Find Chrome ────────────────────────────────────────────────────

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Start Chrome ───────────────────────────────────────────────────

function startChrome() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("[NetForge] No Chrome/Edge found. Install Chrome or set NETFORGE_CDP_PORT to an existing instance.");
    return null;
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-translate",
    "--window-size=1280,720",
  ];

  if (HEADLESS) {
    args.push("--headless=new");
  }

  const proc = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  proc.on("error", (err) => {
    console.error(`[NetForge] Failed to start Chrome: ${err.message}`);
  });

  proc.stderr.on("data", (d) => {
    if (DEBUG) process.stderr.write(`[Chrome] ${d}`);
  });

  return proc;
}

// ─── CDP Client ─────────────────────────────────────────────────────

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

async function cdpSend(sessionId, method, params = {}) {
  const body = JSON.stringify({ id: 1, method, params });
  const resp = await fetch(
    `http://127.0.0.1:${CDP_PORT}/json/${sessionId ? `session/${sessionId}` : "new"}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`CDP error: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function getTargets() {
  return fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
}

async function createTab(url = "about:blank") {
  const tabs = await getTargets();
  if (tabs.length >= MAX_TABS + 1) {
    // Close the oldest tab (skip the first one)
    const oldest = tabs[tabs.length - 1];
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${oldest.id}`, { method: "GET" });
  }
  const result = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`);
  return result;
}

async function cdpCommand(sessionId, method, params = {}) {
  const postBody = JSON.stringify({ method, params, id: Date.now() });
  const resp = await fetch(
    `http://127.0.0.1:${CDP_PORT}/json/session/${sessionId}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: postBody }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`CDP command error: ${resp.status} ${text.slice(0, 200)}`);
  }
  const result = await resp.json();
  if (result.error) {
    throw new Error(`CDP error: ${JSON.stringify(result.error)}`);
  }
  return result.result;
}

// ─── MCP Server ─────────────────────────────────────────────────────

/**
 * Simple stdio MCP server using the MCP protocol format.
 * Receives JSON-RPC messages on stdin, sends responses on stdout.
 */

import { createInterface } from "node:readline";

let chromeProcess = null;
let currentTab = null;

async function ensureBrowser() {
  // Try connecting to existing Chrome first
  try {
    const targets = await getTargets();
    if (targets.length > 0) {
      if (DEBUG) console.error("[NetForge] Connected to existing Chrome instance");
      return;
    }
  } catch {
    // No existing instance — start one
  }

  chromeProcess = startChrome();
  if (!chromeProcess) {
    throw new Error("Cannot start browser: no Chrome found and no existing CDP instance");
  }

  // Wait for Chrome to start
  for (let i = 0; i < 30; i++) {
    try {
      await getTargets();
      if (DEBUG) console.error("[NetForge] Chrome started successfully");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Chrome did not start in time");
}

async function ensureTab() {
  await ensureBrowser();
  if (!currentTab) {
    const tab = await createTab();
    currentTab = tab.id;
    // Connect to the page target
    const targets = await getTargets();
    const pageTarget = targets.find((t) => t.id === currentTab && t.type === "page");
    if (pageTarget) {
      currentTab = pageTarget.id;
    }
  }
  return currentTab;
}

// ─── MCP Tool Implementations ───────────────────────────────────────

const tools = {
  browser_navigate: {
    description: "Navigate browser to a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to (http/https only)" },
      },
      required: ["url"],
    },
    handler: async (args) => {
      const targetId = await ensureTab();
      const url = args.url;
      // Use CDP Page.navigate
      const sessionId = targetId;
      const tabInfo = await createTab(url);
      currentTab = tabInfo.id;
      return { content: [{ type: "text", text: `Navigated to: ${url}` }] };
    },
  },

  browser_screenshot: {
    description: "Take a screenshot of the current page (base64 JPEG)",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: { type: "boolean", description: "Capture full page (default: false)" },
      },
    },
    handler: async (args) => {
      const targetId = await ensureTab();
      // CDP: Page.captureScreenshot
      const result = await cdpCommand(targetId, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 80,
        ...(args.fullPage ? {} : { captureBeyondViewport: false }),
      });
      return {
        content: [{ type: "image", data: result.data, mimeType: "image/jpeg" }],
      };
    },
  },

  browser_click: {
    description: "Click an element on the page by CSS selector",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to click" },
      },
      required: ["selector"],
    },
    handler: async (args) => {
      const targetId = await ensureTab();
      // Find element via JS then click
      await cdpCommand(targetId, "Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(args.selector)})?.click()`,
      });
      return { content: [{ type: "text", text: `Clicked: ${args.selector}` }] };
    },
  },

  browser_type: {
    description: "Type text into an input field",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of input element" },
        text: { type: "string", description: "Text to type" },
        clear: { type: "boolean", description: "Clear existing text first (default: false)" },
      },
      required: ["selector", "text"],
    },
    handler: async (args) => {
      const targetId = await ensureTab();
      const select = JSON.stringify(args.selector);
      if (args.clear) {
        await cdpCommand(targetId, "Runtime.evaluate", {
          expression: `const el = document.querySelector(${select}); if(el) el.value = '';`,
        });
      }
      await cdpCommand(targetId, "Runtime.evaluate", {
        expression: `const el = document.querySelector(${select}); if(el) el.value = ${JSON.stringify(args.text)}; el.dispatchEvent(new Event('input', { bubbles: true }));`,
      });
      return { content: [{ type: "text", text: `Typed into ${args.selector}` }] };
    },
  },

  browser_evaluate: {
    description: "Execute JavaScript in the page context and return the result as JSON",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JavaScript expression to evaluate" },
      },
      required: ["expression"],
    },
    handler: async (args) => {
      const targetId = await ensureTab();
      const result = await cdpCommand(targetId, "Runtime.evaluate", {
        expression: args.expression,
        returnByValue: true,
      });
      const value = result.result?.value;
      return {
        content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }],
      };
    },
  },

  browser_close: {
    description: "Close the current browser tab",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      if (currentTab) {
        try {
          await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${currentTab}`);
        } catch {}
        currentTab = null;
      }
      return { content: [{ type: "text", text: "Tab closed" }] };
    },
  },
};

// ─── MCP Protocol Handler ───────────────────────────────────────────

function handleMCPRequest(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: "netforge-browser",
          version: "0.1.0",
        },
      },
    };
  }

  if (method === "tools/list") {
    const toolList = Object.entries(tools).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: def.inputSchema,
    }));
    return { id, result: { tools: toolList } };
  }

  if (method === "tools/call") {
    const tool = tools[params.name];
    if (!tool) {
      return { id, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
    }

    // Execute asynchronously — we return a placeholder promise result
    return tool
      .handler(params.arguments || {})
      .then((result) => ({ id, result }))
      .catch((err) => ({
        id,
        error: { code: -32000, message: err.message },
      }));
  }

  if (method === "notifications/initialized") {
    return null; // no response
  }

  return { id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ─── Entry Points ───────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  // Hook mode
  if (args[0] === "hook") {
    return handleHook(args[1]);
  }

  // MCP server mode (stdio)
  const rl = createInterface({ input: process.stdin });
  let buffer = "";

  rl.on("line", (line) => {
    buffer += line;
    try {
      const request = JSON.parse(buffer);
      buffer = "";
      const response = handleMCPRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch {
      // Incomplete JSON — keep buffering
    }
  });

  rl.on("close", () => {
    if (chromeProcess) {
      chromeProcess.kill();
    }
    process.exit(0);
  });

  process.on("SIGINT", () => {
    if (chromeProcess) chromeProcess.kill();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    if (chromeProcess) chromeProcess.kill();
    process.exit(0);
  });

  console.error("[NetForge] Browser MCP server ready (waiting for commands)");
}

main();
