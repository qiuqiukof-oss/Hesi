/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Security Middleware Composer
//
// Composes auth, policy, and audit into middleware wrappers
// for tool calls and resource reads.
// ============================================================
const { checkAuth } = require("./auth");
const { checkCommand } = require("./policy");
const { logToolCall, logResourceRead } = require("./audit");

/**
 * Wrap a tool handler with security checks.
 * @param {string} toolName
 * @param {Function} handler - async (args) => result
 * @returns {Function} wrapped handler
 */
function protectTool(toolName, handler) {
  return async (args, request) => {
    // 1. Auth check
    const auth = checkAuth(request);
    if (!auth.authorized) {
      logToolCall(toolName, args, { isError: true });
      return {
        content: [{ type: "text", text: `Unauthorized: ${auth.reason}` }],
        isError: true,
      };
    }

    // 2. Policy check (for command execution)
    if ((toolName === "execute_cli" || toolName === "session_write") && args) {
      const input = args.command || args.input || "";
      const policyCheck = checkCommand(input);
      if (!policyCheck.allowed) {
        logToolCall(toolName, args, { isError: true });
        return {
          content: [{ type: "text", text: `Policy denied: ${policyCheck.reason}` }],
          isError: true,
        };
      }
    }

    // 3. Execute
    try {
      const result = await handler(args, request);
      logToolCall(toolName, args, result);
      return result;
    } catch (err) {
      logToolCall(toolName, args, { isError: true });
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  };
}

/**
 * Wrap a resource read handler with audit.
 * @param {Function} handler - async (uri) => result
 * @returns {Function} wrapped handler
 */
function protectResource(handler) {
  return async (uri, request) => {
    // Auth check
    const auth = checkAuth(request);
    if (!auth.authorized) {
      logResourceRead(uri);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: auth.reason }) }],
        isError: true,
      };
    }

    try {
      const result = await handler(uri, request);
      logResourceRead(uri, result);
      return result;
    } catch (err) {
      logResourceRead(uri);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  };
}

module.exports = { protectTool, protectResource };
