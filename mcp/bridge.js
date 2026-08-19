/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Bridge — adapts MCP tool definitions + handlers to
// OpenAI Function Calling format, for use in routes/chat.js
//
// Each MCP tool handler is a pure (args) => result function.
// We convert the MCP schema (name + inputSchema) to OpenAI's
// tool format (name + parameters) and provide a dispatcher.
// ============================================================
// ── Lazy-loaded tool modules (loaded on first use) ──
// Improves startup time by deferring MCP tool module loading
let _lazySession = null, _lazyExecute = null, _lazyRegistry = null, _lazyBrowser = null;
function getSession() { return _lazySession || (_lazySession = require("./tools/session")); }
function getExecute() { return _lazyExecute || (_lazyExecute = require("./tools/execute")); }
function getRegistry() { return _lazyRegistry || (_lazyRegistry = require("./tools/registry")); }
function getBrowser() { return _lazyBrowser || (_lazyBrowser = require("./tools/browser")); }

// ── Selectively pick which MCP tools to expose to the AI chat ──
// We include all session tools (persistent terminal interaction) and
// cli_discover (trigger a fresh scan). We skip execute_cli (existing
// exec_terminal already covers one-shot commands) and switch_preset.
const ALLOWED_TOOL_NAMES = new Set([
  "session_create",
  "session_write",
  "session_read",
  "session_signal",
  "session_resize",
  "session_kill",
  "session_list",
  "cli_discover",
  // CDP Browser Control — AI 助手可以感知和控制自己的浏览器
  "browser_ping",
  "browser_connect",
  "browser_navigate",
  "browser_screenshot",
  "browser_click",
  "browser_type",
  "browser_evaluate",
  "browser_console",
  "browser_list_tabs",
  "browser_switch_tab",
  "browser_info",
  "browser_network",
  // P3: Browser Farm — 跨会话隔离浏览器上下文
  "browser_farm_list",
  "browser_farm_create",
  "browser_farm_switch",
  "browser_farm_close",
  // P3: DOM Diff — 页面结构变化追踪
  "browser_dom_snapshot",
  "browser_dom_diff",
  // P3: Form Auto-fill — 表单自动检测和填写
  "browser_detect_forms",
  "browser_fill_forms",
  // P3: Accessibility — 可访问性分析
  "browser_accessibility",
]);

// ── Build handler map lazily (deferred until first call) ──
let _allHandlers = null;
function getHandlers() {
  if (!_allHandlers) {
    const session = getSession();
    const exec = getExecute();
    const reg = getRegistry();
    const browser = getBrowser();
    _allHandlers = {
      ...session.createHandlers(),
      ...exec.createHandlers(),
      ...reg.createHandlers(),
      ...browser.createHandlers(),
    };
  }
  return _allHandlers;
}

// ── Convert MCP tool definitions to OpenAI function calling format ──
function toOpenAITool(mcpDef) {
  return {
    type: "function",
    function: {
      name: mcpDef.name,
      description: mcpDef.description,
      parameters: _flattenSchema(mcpDef.inputSchema),  // handle anyOf/oneOf
    },
  };
}

/**
 * Flatten JSON Schema anyOf/oneOf into a single object type.
 * OpenAI function calling doesn't support anyOf/oneOf at top level.
 */
function _flattenSchema(schema) {
  if (!schema) return { type: 'string' };

  // Handle anyOf/oneOf — merge properties from all variants
  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf || schema.oneOf;
    // Guard: empty anyOf/oneOf array → return object schema
    if (!Array.isArray(variants) || variants.length === 0) {
      return { type: 'object', description: schema.description };
    }
    const mergedType = variants.every(v => v.type === variants[0]?.type) ? variants[0].type : 'object';
    const mergedProps = Object.assign({}, ...variants.map(v => v.properties || {}));
    const mergedRequired = [...new Set([].concat(...variants.map(v => v.required || [])))];
    return {
      type: mergedType,
      properties: Object.keys(mergedProps).length > 0 ? mergedProps : undefined,
      required: mergedRequired.length > 0 ? mergedRequired : undefined,
      description: schema.description,
    };
  }

  // Deep-clone to prevent callers from mutating the original schema definition
  return JSON.parse(JSON.stringify(schema));
}

/** Array of OpenAI-format tool definitions from allowed MCP tools */
function getMcpToolDefinitions() {
  const session = getSession();
  const exec = getExecute();
  const reg = getRegistry();
  const browser = getBrowser();
  return []
    .concat(session.toolDefinitions, exec.toolDefinitions, reg.toolDefinitions, browser.toolDefinitions)
    .filter((def) => ALLOWED_TOOL_NAMES.has(def.name))
    .map(toOpenAITool);
}

// Cached tool definitions (built on first access)
let _mcpToolDefinitionsCache = null;
function getMcpTools() {
  if (!_mcpToolDefinitionsCache) {
    _mcpToolDefinitionsCache = getMcpToolDefinitions();
  }
  return _mcpToolDefinitionsCache;
}

/**
 * Call an MCP tool handler directly (no protocol serialization).
 *
 * @param {string} name  — Tool name (e.g. 'session_create')
 * @param {object} args  — Tool arguments
 * @returns {Promise<string>}  — Text result (extracted from MCP content[])
 */
async function callMCPTool(name, args) {
  const handlers = getHandlers();
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }

  const result = await handler(args);

  // MCP handlers return { content: [{ type, text }], isError?: boolean }
  if (result && Array.isArray(result.content)) {
    const text = result.content.map((c) => c.text ?? '').join("\n");
    // Propagate isError so the AI caller can distinguish failure from success
    if (result.isError) {
      throw new Error(text || 'MCP tool returned error');
    }
    return text;
  }

  return String(result);
}

module.exports = {
  get mcpToolDefinitions() {
    return getMcpTools();
  },
  getMcpTools,
  callMCPTool,
};
