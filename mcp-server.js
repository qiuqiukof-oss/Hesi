/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Hesi MCP Server — Thin Entry Point
//
// Delegates to the modular mcp/ architecture.
// Start: node mcp-server.js
//
// Environment variables:
//   QCLI_API_URL       - Hesi HTTP API base (default: http://127.0.0.1:4264/api)
//   QCLI_WS_URL        - Hesi WebSocket URL  (default: ws://127.0.0.1:4264)
//   QCLI_MCP_TOKEN     - Bearer token for MCP auth (optional, dev: skip)
//   QCLI_SESSION_TTL   - Session TTL in ms (default: 900000 = 15 min)
//   QCLI_MAX_SESSIONS  - Max concurrent sessions (default: 10)
//   QCLI_POLICY_PATH   - Path to .cli-q-policy.json (optional)
//   QCLI_AUDIT_LOG     - Path to audit log file (optional)
// ============================================================

// All logic moved to mcp/index.js — this file is now the entry point only.

// Global unhandled rejection handler — prevents crashes from async errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Q-CLI MCP] Unhandled Rejection at:", promise, "reason:", reason);
});

require("./mcp");
