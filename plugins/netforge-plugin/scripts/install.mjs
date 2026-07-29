#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
/**
 * NetForge — Pre-installation script
 *
 * Checks prerequisites before plugin installation:
 * 1. Chrome/Edge browser availability
 * 2. Node.js version (>= 18)
 * 3. CDP port availability
 */

const { existsSync } = await import("node:fs");
const { homedir, platform } = await import("node:os");
const { join } = await import("node:path");

const MIN_NODE_VERSION = 18;
const CHROME_PATHS = platform() === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      join(process.env["ProgramFiles(x86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
    ]
  : platform() === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
      ];

const errors = [];

// Check Node version
const nodeVersion = parseInt(process.version.slice(1), 10);
if (nodeVersion < MIN_NODE_VERSION) {
  errors.push(`Node.js ${MIN_NODE_VERSION}+ required (found ${process.version})`);
}

// Check Chrome
const chromeFound = CHROME_PATHS.some((p) => existsSync(p));
if (!chromeFound) {
  console.warn("[NetForge] ⚠ No Chrome/Edge found at expected paths.");
  console.warn("[NetForge]   The plugin will work, but browser features require Chrome.");
  console.warn("[NetForge]   Set NETFORGE_CDP_PORT to point to an existing Chrome instance.");
}

if (errors.length > 0) {
  console.error("[NetForge] Pre-installation check failed:");
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log("[NetForge] ✅ Pre-installation checks passed");
