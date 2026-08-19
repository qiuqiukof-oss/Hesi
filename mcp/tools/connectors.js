/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Connector Tools — dynamically surfaces tools from connected
// WorkBuddy MCP connectors into Hesi's own MCP server.
//
// Tools are NOT statically defined; they are read live from the
// hub (which holds connections to imported connectors). Each
// proxied tool is named `mcp_<connectorId>_<toolName>` so it is
// unique and traceable back to its origin connector.
// ============================================================
const hub = require('../hub');

// Cache the resolved tool definitions so ListTools is cheap.
let _defsCache = null;
let _defsCacheAt = 0;
const DEFS_TTL = 5000;

function toolKey(connectorId, toolName) {
  return `mcp_${connectorId}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

function parseKey(name) {
  // mcp_<connectorId>_<toolName>
  if (!name.startsWith('mcp_')) return null;
  const rest = name.slice(4);
  const idx = rest.lastIndexOf('_');
  if (idx < 0) return null;
  return { connectorId: rest.slice(0, idx), toolName: rest.slice(idx + 1) };
}

async function resolveDefinitions() {
  const now = Date.now();
  if (_defsCache && now - _defsCacheAt < DEFS_TTL) return _defsCache;
  const defs = [];
  const connectors = hub.list();
  for (const conn of connectors) {
    if (conn.status !== 'connected') continue;
    const tools = conn.tools || [];
    for (const t of tools) {
      defs.push({
        name: toolKey(conn.id, t.name),
        description: `[${conn.name}] ${t.description || t.name}`,
        inputSchema: t.inputSchema || { type: 'object', properties: {}, required: [] },
      });
    }
  }
  _defsCache = defs;
  _defsCacheAt = now;
  return defs;
}

function invalidateCache() {
  _defsCache = null;
  _defsCacheAt = 0;
}

const toolDefinitions = []; // kept empty; filled dynamically at request time

// Provide a getter so mcp/tools/index.js can include live defs.
function liveToolDefinitions() {
  // Synchronous snapshot for the aggregated list; resolves from cache
  return _defsCache || [];
}

async function createHandlers() {
  return {
    // Dynamic dispatch: any call to a `mcp_*` tool proxies to the connector.
    __dynamic: true,
  };
}

// Manual dispatch used by mcp/index.js CallTool handler.
async function dispatchDynamic(name, args) {
  const parsed = parseKey(name);
  if (!parsed) return null; // not a connector tool
  try {
    const result = await hub.callTool(parsed.connectorId, parsed.toolName, args || {});
    return result;
  } catch (e) {
    return { content: [{ type: 'text', text: `Connector tool error: ${e.message}` }], isError: true };
  }
}

function refreshCache() {
  // Fire-and-forget refresh (used after connect/disconnect events).
  resolveDefinitions().catch(() => {});
}

module.exports = {
  toolDefinitions,
  liveToolDefinitions,
  createHandlers,
  dispatchDynamic,
  invalidateCache,
  refreshCache,
  resolveDefinitions,
};
