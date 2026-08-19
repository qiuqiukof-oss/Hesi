/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Server — modular entry point
//
// Assembles tools, resources, and security middleware into
// a single MCP Server instance. Replaces the monolithic
// mcp-server.js while preserving the same protocol behavior.
// ============================================================
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const config = require("./config");
const { sessionManager } = require("./session-manager");
const { allToolDefinitions, allHandlers, connectorsTools } = require("./tools");
const { allResourceDefinitions, allResourceTemplates, matchHandler } = require("./resources");
const { protectTool, protectResource } = require("./security");

// ── METRIC Event Helper ──
// Emits structured JSON metrics to stderr for dashboard consumption.
// Format: [METRIC] { "ev": "tool_call", "tool": "session_read", "durMs": 42, ... }

/** Aggregate counters for cache_summary emission */
const _metricCounts = { total: 0, cached: 0, tokenSaved: 0 };

function emitMetric(ev, data = {}) {
  const metric = {
    t: new Date().toLocaleTimeString("en-US", { hour12: false }),
    ev,
    ...data,
  };
  console.error("[METRIC]", JSON.stringify(metric));

  // Track aggregates for periodic cache_summary
  if (ev === "tool_call" || ev === "resource_read") {
    _metricCounts.total++;
    if (data.cached) _metricCounts.cached++;
    if (data.tokenSaved) _metricCounts.tokenSaved += data.tokenSaved;
  }
}

/**
 * Emit a periodic cache performance summary covering only the last interval.
 * Counters are reset after emission so each 30-second report reflects fresh activity.
 */
function emitCacheSummary() {
  const { total, cached, tokenSaved } = _metricCounts;
  emitMetric("cache_summary", {
    hits: cached,
    misses: total - cached,
    rate: total > 0 ? +(cached / total).toFixed(3) : 0,
    tokenSaved,
    totalCalls: total,
  });
  _metricCounts.total = 0;
  _metricCounts.cached = 0;
  _metricCounts.tokenSaved = 0;
}

/**
 * Wrap a tool handler with METRIC event emission.
 */
function withMetricTool(name, handler) {
  return async (args, request) => {
    const start = Date.now();
    try {
      const result = await handler(args, request);
      const durMs = Date.now() - start;
      // Estimate token cost from JSON size
      const reqStr = JSON.stringify(args || {});
      const resStr = JSON.stringify(result || {});
      emitMetric("tool_call", {
        tool: name,
        durMs,
        cached: false,
        tokenIn: Math.ceil(reqStr.length / 4),
        tokenOut: Math.ceil(resStr.length / 4),
      });
      return result;
    } catch (err) {
      const durMs = Date.now() - start;
      emitMetric("tool_call", { tool: name, durMs, error: err.message });
      throw err;
    }
  };
}

/**
 * Wrap a resource read handler with METRIC event emission.
 */
function withMetricResource(uri, handler) {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await handler(...args);
      const durMs = Date.now() - start;
      const resStr = JSON.stringify(result || {});
      // Detect cache hit by checking response text for cached marker
      const isCached = result?.contents?.[0]?.text?.includes('"cached":true') === true;
      emitMetric("resource_read", {
        uri: uri.split("?")[0],
        durMs,
        cached: isCached,
        tokenOut: Math.ceil(resStr.length / 4),
      });
      return result;
    } catch (err) {
      emitMetric("resource_read", { uri, error: err.message });
      throw err;
    }
  };
}

// ── Create Server ──
const server = new Server(
  {
    name: config.serverName,
    version: config.serverVersion,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ══════════════════════════════════════════════════
// Tool Handlers
// ══════════════════════════════════════════════════

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // 连接器定义解析失败不应拖垮整个 tools/list（否则内置工具也一并消失）。
  // 单连接器故障隔离：降级为仅内置工具可用。
  let connectorTools = [];
  try {
    connectorTools = await connectorsTools.resolveDefinitions();
  } catch (e) {
    console.error('[mcp] resolveDefinitions failed, falling back to built-in tools only:', e?.message);
  }
  return { tools: allToolDefinitions.concat(connectorTools) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Find handler
  const rawHandler = allHandlers[name];
  if (!rawHandler) {
    // Dynamic dispatch for connected-connector tools (mcp_<id>_<tool>)
    if (name.startsWith('mcp_')) {
      try {
        const result = await connectorsTools.dispatchDynamic(name, args);
        if (result) return result;
      } catch (e) {
        return {
          content: [{ type: "text", text: `Connector tool error: ${e.message}` }],
          isError: true,
        };
      }
    }
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  // Apply security middleware
  const protectedHandler = protectTool(name, rawHandler);
  // Apply metric wrapping
  const metrifiedHandler = withMetricTool(name, protectedHandler);
  return metrifiedHandler(args, request);
});

// ══════════════════════════════════════════════════
// Resource Handlers
// ══════════════════════════════════════════════════

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: allResourceDefinitions,
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: allResourceTemplates,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  // Find handler via URI routing
  const rawHandler = matchHandler(uri);
  if (!rawHandler) {
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: `Resource not found: ${uri}` }) }],
      isError: true,
    };
  }

  // Apply security middleware (auth + audit)
  const protectedHandler = protectResource(rawHandler);
  // Apply metric wrapping
  const metrifiedHandler = withMetricResource(uri, protectedHandler);

  try {
    return await metrifiedHandler(uri, request);
  } catch (err) {
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ══════════════════════════════════════════════════
// Startup
// ══════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Q-CLI MCP] v${config.serverVersion} started (tools: ${allToolDefinitions.length}, resources: ${allResourceDefinitions.length})`);

  // Auto-connect connectors flagged enabled (no crash on failure)
  const hub = require("./hub");
  hub.bootstrap().catch((e) => console.warn(`[Q-CLI MCP] hub bootstrap warn: ${e.message}`));

  // Emit aggregated cache summary every 30 seconds
  const summaryTimer = setInterval(emitCacheSummary, 30_000);
  summaryTimer.unref(); // Don't prevent process exit

  // Store timer for cleanup
  process._mcpSummaryTimer = summaryTimer;
}

// Cleanup on shutdown
process.on("SIGINT", () => {
  console.error("[Q-CLI MCP] Shutting down...");
  if (process._mcpSummaryTimer) clearInterval(process._mcpSummaryTimer);
  sessionManager.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (process._mcpSummaryTimer) clearInterval(process._mcpSummaryTimer);
  sessionManager.destroy();
  process.exit(0);
});

main().catch((err) => {
  console.error("[Q-CLI MCP] Fatal:", err);
  process.exit(1);
});
