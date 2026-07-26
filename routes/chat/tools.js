// @ts-check
// ============================================================
// Chat Tools — AI tool registry + execution engine
//
// Manages the tool registry (declarative tool definitions),
// MCP bridge tool dispatching, token truncation, and rate
// limiting for AI tool call chains.
// ============================================================

const crypto = require('crypto');
const { ToolRegistry, LRUCache, ToolResultTruncator, TokenBucketMap, classifyError } = require('../ai-tools');
const { registerAll } = require('../ai-tools/builtin');
const { mcpToolDefinitions, callMCPTool } = require('../../mcp/bridge');

// ── Registry & infrastructure ──
const toolRegistry = new ToolRegistry();
const toolCache = new LRUCache(50, 5 * 60 * 1000);
// M2a (v0.3.1): 只读工具结果缓存（降耗）。独立实例，避免与 web_search 的 toolCache 互相干扰。
const toolResultCache = new LRUCache(200, 10 * 60 * 1000);
// 仅缓存纯只读、无副作用的 registry 工具；写/副作用工具一律不缓存，且执行后清空本缓存。
const CACHEABLE_TOOLS = new Set([
  'read_file', 'web_fetch', 'get_self_info', 'list_clis',
]);
const toolTruncator = new ToolResultTruncator(4000);
// 限流：仅作为防止工具调用失控死循环的安全阀，阈值放宽到正常长任务绝不会触碰的水平。
// 单轮初始 300 次额度（每轮 reset），每 30s 补充 100 次；exec_terminal 消耗 1、web_search 消耗 2。
// 使用 TokenBucketMap 按 requestId 隔离，避免多用户/多会话共享全局单例导致相互饿死（P2-3）。
const toolRateLimiter = new TokenBucketMap(300, 100, 30_000);

// Register all built-in tools
registerAll(toolRegistry, { cache: toolCache, rateLimiter: toolRateLimiter });

// Build OpenAI function-calling format tool definitions
const QCLI_TOOLS = toolRegistry.definitions;

// Merge MCP Bridge Tools (session + cli_discover + browser)
QCLI_TOOLS.push(...mcpToolDefinitions);

// ── MCP tool name set for quick lookup ──
const MCP_TOOL_NAMES = new Set([
  'session_create', 'session_write', 'session_read',
  'session_signal', 'session_resize', 'session_kill', 'session_list',
  'cli_discover',
  'browser_ping', 'browser_connect', 'browser_navigate',
  'browser_screenshot', 'browser_click', 'browser_type',
  'browser_evaluate', 'browser_console', 'browser_list_tabs',
  'browser_switch_tab', 'browser_info', 'browser_network',
  // P3: Browser Farm
  'browser_farm_list', 'browser_farm_create', 'browser_farm_switch', 'browser_farm_close',
  // P3: DOM Diff
  'browser_dom_snapshot', 'browser_dom_diff',
  // P3: Form Auto-fill
  'browser_detect_forms', 'browser_fill_forms',
  // P3: Accessibility
  'browser_accessibility',
]);

// ── Tools that should skip token truncation ──
const SKIP_TRUNCATE_NAMES = new Set([
  'write_file', 'web_fetch', 'rebuild_frontend',
  'agent_delegate', 'agent_start', 'agent_poll', 'agent_send', 'agent_cancel', 'agent_list',
  'agent_callbacks',
  'workflow_start', 'workflow_status', 'workflow_add_task',
]);

/**
 * Execute a tool call — dispatches to registry or MCP bridge with truncation + metric broadcast.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {Function} [broadcastFn] - WebSocket broadcast for frontend metrics
 * @param {string} [requestId] - 每请求隔离标识，用于限流桶归属（P2-3）
 * @returns {Promise<string>}
 */
async function executeToolCall(name, args, broadcastFn, requestId) {
  const _tcStart = Date.now();

  // Emit tool_call_start SSE event for frontend tracking
  const emitToolEvent = (eventType, extra = {}) => {
    if (!broadcastFn) return;
    broadcastFn({
      type: 'mcp_metric',
      data: {
        t: new Date().toLocaleTimeString('en-US', { hour12: false }),
        ev: eventType,
        tool: name,
        args: eventType === 'tool_call_start' ? JSON.stringify(args).slice(0, 200) : undefined,
        durMs: Date.now() - _tcStart,
        ...extra,
      },
    });
  };

  emitToolEvent('tool_call_start');

  // M2a (v0.3.1): 只读工具结果缓存检查。命中直接返回（跳过 registry/MCP 执行），降重算。
  const _isReadOnly = CACHEABLE_TOOLS.has(name);
  let _cacheKey = null;
  if (process.env.HESI_TOOL_CACHE !== '0' && _isReadOnly) {
    _cacheKey = `${name}:${crypto.createHash('sha1').update(JSON.stringify(args)).digest('hex')}`;
    const cached = toolResultCache.get(_cacheKey);
    if (cached !== null && cached !== undefined) {
      console.log('[tool-cache] HIT', name, _cacheKey.slice(0, 16));
      emitToolEvent('tool_cache_hit');
      emitToolEvent('tool_call_end', { durMs: Date.now() - _tcStart, cached: true });
      return cached;
    }
  }

  // ── MCP Bridge Tools ──
  if (MCP_TOOL_NAMES.has(name)) {
    const mcpStart = Date.now();
    try {
      const mcpResult = await callMCPTool(name, args);
      emitToolEvent('tool_call_end', { durMs: Date.now() - mcpStart });
      toolResultCache.clear(); // M2a: 副作用工具执行后清空只读缓存，保证后续只读读到最新
      return mcpResult;
    } catch (err) {
      emitToolEvent('tool_call_error', { error: err.message });
      return `[MCP Error] ${err.message}`;
    }
  }

  // ── Registry Tools ──
  if (toolRegistry.has(name)) {
    try {
      let result = await toolRegistry.execute(name, args, broadcastFn, requestId);
      // 放宽截断阈值：原 2000 字符过小，read_file / exec_terminal 等输出动辄被截断，
      // 造成 AI 拿到残缺结果（也是一种“限制”）。20000 字符内原样返回，超出再走 token 感知截断。
      if (!SKIP_TRUNCATE_NAMES.has(name) && typeof result === 'string' && result.length > 20000) {
        result = toolTruncator.truncate(result);
      }
      // M2a (v0.3.1): 只读工具结果写入缓存；写/副作用工具执行后清空，保证后续只读读到最新。
      if (_isReadOnly && _cacheKey) toolResultCache.set(_cacheKey, result);
      else toolResultCache.clear();
      emitToolEvent('tool_call_end', { durMs: Date.now() - _tcStart });
      return result;
    } catch (err) {
      const e = classifyError(err);
      emitToolEvent('tool_call_error', { error: e.message });
      return `[${e.type}] ${e.message}`;
    }
  }

  emitToolEvent('tool_call_error', { error: 'Unknown tool' });
  return `Unknown tool: ${name}`;
}

module.exports = {
  toolRegistry,
  QCLI_TOOLS,
  MCP_TOOL_NAMES,
  executeToolCall,
  toolRateLimiter,
};
