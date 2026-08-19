/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Auth — Bearer Token authentication for MCP Server
//
// When QCLI_MCP_TOKEN is set, all requests must include
// Authorization: Bearer <token> in the JSON-RPC request metadata.
// When not set, auth is skipped (development mode).
// Stdio transport always skips auth (local trust).
// ============================================================
const config = require("../config");

/**
 * Check if a request is authorized.
 * @param {object} request - The JSON-RPC request object
 * @returns {{ authorized: boolean, reason?: string }}
 */
function checkAuth(request) {
  // Skip auth if no token configured (dev mode)
  if (!config.mcpToken) {
    return { authorized: true };
  }

  // Extract token from request metadata or params
  const token =
    (request.meta && request.meta.authorization) ||
    (request.params && request.params._meta && request.params._meta.authorization) ||
    "";

  // Strip "Bearer " prefix if present
  const bearer = token.replace(/^Bearer\s+/i, "");

  if (!bearer || bearer !== config.mcpToken) {
    return { authorized: false, reason: "Invalid or missing authorization token" };
  }

  return { authorized: true };
}

module.exports = { checkAuth };
