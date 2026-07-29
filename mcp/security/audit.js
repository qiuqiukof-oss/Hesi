/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Audit — now a thin delegate to the unified audit bus.
//
// All MCP tool/resource events are routed into lib/audit.js so they share
// the same append-only trail (data/audit.jsonl) as PTY, auth, and upload
// events. The original public API (log / logToolCall / logResourceRead) is
// preserved so existing MCP callers keep working unchanged.
// ============================================================
const audit = require('../../lib/audit');

function log(entry) {
  return audit.log(entry);
}

function logToolCall(toolName, params, result) {
  return audit.mcpTool(toolName, params, result);
}

function logResourceRead(uri, result) {
  return audit.resourceRead(uri, result);
}

module.exports = { log, logToolCall, logResourceRead };
