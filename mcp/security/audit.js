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
// 个人版（Hesi-Q）已裁剪企业版审计总线（lib/audit.js 不存在）；
// 这里做优雅降级：有审计模块就用，没有则 no-op，保证 MCP server 可独立启动。
let audit = null;
try {
  audit = require('../../lib/audit');
} catch { /* 个人版无 lib/audit：审计降级为 no-op */ }

function log(entry) {
  return audit ? audit.log(entry) : undefined;
}

function logToolCall(toolName, params, result) {
  return audit ? audit.mcpTool(toolName, params, result) : undefined;
}

function logResourceRead(uri, result) {
  return audit ? audit.resourceRead(uri, result) : undefined;
}

module.exports = { log, logToolCall, logResourceRead };
