/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// NetForge — Plugin lifecycle: onLoad
// Logs that the browser engine is ready.
// Browser MCP server starts on demand (not eagerly).

console.log('[NetForge] ✅ Browser engine plugin loaded');
console.log('[NetForge]    MCP server: netforge-browser (CDP port 9222)');
console.log('[NetForge]    Start: node mcp/start-browser.mjs');
