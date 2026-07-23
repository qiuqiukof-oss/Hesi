// @ts-check
// ============================================================
// Anthropic Stream — SSE streaming with tool_use support
//
// Handles Anthropic Messages API streaming with:
// - Multi-round tool calling (up to 50 rounds)
// - Content block stream parsing (text + tool_use)
// - Incremental JSON input accumulation
// - Cycle detection for repeated tool calls
// - 120s total execution timeout
// ============================================================

const {
  safeApiError,
  trimHistory,
  capToolRounds,
  capToolResultPreview,
  buildApiUrl,
  API_FETCH_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  STREAM_MAX_RETRIES,
  MAX_TOTAL_DURATION_MS,
  CONTINUE_ROUNDS,
  fetchLlmWithRetry,
} = require('./utils');
const { executeToolCall, toolRateLimiter } = require('./tools');
const { pruneToolContext } = require('./token-budget');
const { killDelegatePTY, abortDelegate } = require('../ai-tools/builtin/agent');

/**
 * Convert internal message format to Anthropic Messages API format.
 * Handles both string content (initial messages) and content block arrays (tool rounds).
 * @param {Array<{role?:string, content?:string|Array}>} messages
 * @returns {Array<{role:string, content:any}>}
 */
function buildAnthropicConversation(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (Array.isArray(m.content)) {
        return { role, content: m.content };
      }
      return { role, content: m.content };
    });
}

/**
 * Parse Anthropic SSE stream, streaming text tokens to the client
 * and collecting tool_use content blocks.
 *
 * Anthropic SSE uses `event:` prefix + `data:` JSON lines:
 *   event: content_block_start
 *   data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_...","name":"get_weather","input":{}}}
 *
 * @param {Response} response - Fetch Response object with SSE body
 * @param {import('express').Response} res - Express response for forwarding tokens
 * @returns {Promise<{ toolCalls: Array<{id:string, name:string, input:object}>, assistantBlocks: Array, assistantContent: string, stopReason: string|null, usage: object|null }>}
 */
async function parseAnthropicStream(response, res, sink = null) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // 回调槽位：讨论模式等「不直写 res」的场景通过 sink 注入 onToken/onUsage/onDone；
  // 主聊不传 sink，回落到直写 res（行为完全不变）。
  const sinkOnToken = sink?.onToken;
  const sinkOnUsage = sink?.onUsage;
  const sinkOnDone = sink?.onDone;
  const writeToken = (c) => {
    if (sinkOnToken) { sinkOnToken(c); return; }
    if (res) { try { res.write(`data: ${JSON.stringify({ type: 'token', content: c })}\n\n`); } catch {} }
  };
  const writeUsage = (u) => {
    if (sinkOnUsage) { sinkOnUsage(u); return; }
    if (res) { try { res.write(`data: ${JSON.stringify({ type: 'usage', usage: u })}\n\n`); } catch {} }
  };
  const writeDone = () => {
    if (sinkOnDone) { sinkOnDone(); return; }
    if (res) { try { res.write('data: [DONE]\n\n'); res.end(); } catch {} }
  };

  /** @type {Array<{type:string, text?:string, id?:string, name?:string, input?:object}>} */
  const assistantBlocks = [];
  /** @type {Array<{id:string, name:string, input:object}>} */
  const toolCalls = [];
  let assistantContent = '';
  let stopReason = null;
  /** @type {{input_tokens?:number, output_tokens?:number}|null} */
  let usage = null;
  let lastDataTime = Date.now();
  /** @type {boolean} 上游是否在未发送正常 stop_reason 前就结束了流（中途断流） */
  let truncated = false;
  let streamEnded = false;
  /** @type {boolean} 是否收到 Anthropic SSE 权威结束信号 event: message_stop（流正常完成的标志） */
  let sawMessageStop = false;

  while (true) {
    let done, value;
    try {
      ({ done, value } = await reader.read());
    } catch (readErr) {
      // 读取途中抛错（网络抖动 / 上游断开）→ 视为中途断流，交由外层重试
      truncated = true;
      streamEnded = true;
      break;
    }
    if (done) { streamEnded = true; break; }
    if (value) lastDataTime = Date.now();

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim();
        continue;
      }

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);
          const type = parsed.type || currentEvent;

          if (type === 'message_start') {
            if (parsed.message?.usage) {
              usage = { ...usage, ...parsed.message.usage };
            }
          } else if (type === 'content_block_start') {
            const block = parsed.content_block;
            if (block.type === 'tool_use') {
              assistantBlocks.push({
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input || {},
                _inputBuffer: '',
              });
            } else if (block.type === 'text') {
              assistantBlocks.push({ type: 'text', text: '' });
            }
          } else if (type === 'content_block_delta') {
            const delta = parsed.delta;
            if (delta.type === 'text_delta') {
              const text = delta.text || '';
              const lastBlock = assistantBlocks[assistantBlocks.length - 1];
              if (lastBlock?.type === 'text') {
                lastBlock.text += text;
              }
              assistantContent += text;
              writeToken(text);
            } else if (delta.type === 'input_json_delta') {
              const lastBlock = assistantBlocks[assistantBlocks.length - 1];
              if (lastBlock?.type === 'tool_use') {
                lastBlock._inputBuffer += delta.partial_json || '';
              }
            }
          } else if (type === 'content_block_stop') {
            const lastBlock = assistantBlocks[assistantBlocks.length - 1];
            if (lastBlock?.type === 'tool_use') {
              try {
                lastBlock.input = JSON.parse(lastBlock._inputBuffer || '{}');
              } catch {
                lastBlock.input = {};
              }
              delete lastBlock._inputBuffer;
              toolCalls.push({
                id: lastBlock.id,
                name: lastBlock.name,
                input: lastBlock.input,
              });
            }
          } else if (type === 'message_delta') {
            stopReason = parsed.delta?.stop_reason || null;
            if (parsed.usage) {
              usage = { ...(usage || {}), ...parsed.usage };
            }
          }
          // 'ping' events — ignored; message_stop 是流式正常结束的权威信号
          if (type === 'message_stop') {
            sawMessageStop = true;
          }
        } catch {
          // Skip malformed JSON
        }
        currentEvent = '';
      }
    }

    if (Date.now() - lastDataTime > STREAM_IDLE_TIMEOUT_MS) {
      // 空闲超时：视为「上游卡死 / 断流」，标记截断交由外层重试（而非直接腰斩）
      truncated = true;
      return { toolCalls: [], assistantBlocks: [], assistantContent: '', stopReason: null, usage: null, truncated: true };
    }
  }

  // Clean _inputBuffer from any remaining tool_use blocks
  for (const block of assistantBlocks) {
    if (block.type === 'tool_use' && '_inputBuffer' in block) {
      delete block._inputBuffer;
    }
  }

  const hasToolUse = toolCalls.length > 0 || stopReason === 'tool_use';

  if (hasToolUse) {
    return { toolCalls, assistantBlocks, assistantContent, stopReason, usage, truncated: false };
  }

  // ── 截断检测：流结束但从未收到正常结束信号 → 上游中途断流 ──
  // 关键修正：Anthropic SSE 以 event: message_stop 作为「流正常完成」的权威信号；
  // stop_reason 只是「为何结束」的元数据，部分本地/代理实现不发送 message_delta(stop_reason)
  // 而仅以 message_stop 收尾。收到 message_stop 即视为正常完成，不再因缺 stop_reason 误判截断。
  if (truncated || (streamEnded && !stopReason && !sawMessageStop)) {
    return { toolCalls: [], assistantBlocks: [], assistantContent, stopReason, usage, truncated: true };
  }

  // No tool calls — finalize stream
  if (usage) {
    writeUsage(usage);
  }
  writeDone();
  return { toolCalls: [], assistantBlocks, assistantContent, stopReason, usage, truncated: false };
}

/**
 * 回调版 Anthropic 流式核心（讨论模式等非工具纯文本场景共用）。
 *
 * 与主聊 streamAnthropicWithTools 共用同一解析（parseAnthropicStream），
 * token 通过 onToken 回调外抛（不直写 res），便于讨论模式路由到「当前发言方气泡」。
 *
 * @param {string} baseUrl - API base（/v1 由 buildApiUrl 自动补全）
 * @param {string} apiKey
 * @param {string} model
 * @param {string} systemText
 * @param {Array<{role:string, content:string}>} messages
 * @param {{onToken?:Function, onUsage?:Function, isAborted?:()=>boolean}} [cbs]
 * @returns {Promise<string>} 完整助手文本
 */
async function streamAnthropicCore(baseUrl, apiKey, model, systemText, messages, cbs = {}) {
  const { onToken, onUsage, isAborted } = cbs;
  const modelName = model || 'claude-sonnet-4-20250514';
  // 请求体与主聊 doModelCall 完全一致：system + messages + stream + max_tokens；
  // 不传 tools → 纯文本生成，契合讨论模式「AI 助手回合 / 结论汇总」不需要工具调用。
  const body = {
    model: modelName,
    system: [{ type: 'text', text: systemText }],
    messages,
    stream: true,
    max_tokens: 32768,
  };
  const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');
  const response = await fetchLlmWithRetry(url, {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body, { retryReasonLabel: 'Anthropic', isAborted });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(safeApiError(response, errBody, 'Anthropic API'));
  }
  const result = await parseAnthropicStream(response, null, {
    onToken,
    onUsage,
    onDone: () => {}, // 讨论模式自行管理 [DONE]，此处不结束 res
  });
  // 无工具调用却被截断 → 抛错（讨论模式不自动续传，交由外层兜底生成 fallback 摘要）
  if (result.truncated && result.toolCalls.length === 0) {
    throw new Error('讨论模型流式响应在传输中被截断（可能上游限流或单次响应长度上限）。请重试或稍后分段提问。');
  }
  return result.assistantContent;
}

/**
 * Stream Anthropic completion with tool_use support and multi-round tool calling.
 * Mirrors streamOpenAIWithTools but uses Anthropic's content block format.
 *
 * @param {import('express').Response} res - SSE response stream
 * @param {Array<{role:string, content?:string|Array}>} messages - Chat messages
 * @param {string} apiKey - Anthropic API key
 * @param {string} [model] - Model name (default: claude-sonnet-4-20250514)
 * @param {string} [baseUrl] - Custom API base URL
 * @param {Array} [tools] - Tool definitions (OpenAI format, auto-converted)
 * @param {Function} [broadcastFn] - WebSocket broadcast for metrics
 * @param {import('express').Request} [req] - Incoming request (for client-disconnect detection)
 */
async function streamAnthropicWithTools(res, messages, apiKey, model, baseUrl, tools, broadcastFn, req, maxRounds) {
  const modelName = model || 'claude-sonnet-4-20250514';
  // 每请求隔离标识：用于限流桶归属（P2-3）
  const requestId = `chat-${  Date.now().toString(36)  }-${  Math.random().toString(36).slice(2, 8)}`;

  // Convert OpenAI-format tools to Anthropic format
  const anthropicTools = tools ? tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  })) : undefined;

  let currentMessages = [...messages];
  let toolCallCount = 0;
  // 工具轮次上限：默认 50；自检等场景可由调用方收紧（如 6 轮）以砍 LLM 调用数；
  // 亦可用环境变量 HESI_LLM_MAX_TOOL_ROUNDS 覆盖。
  const MAX_TOOL_ROUNDS = Number(process.env.HESI_LLM_MAX_TOOL_ROUNDS) || maxRounds || 50;
  // 单次请求「累计工具执行次数」硬上限：防止失控循环在瞬间打满 50 轮
  const MAX_TOTAL_TOOL_CALLS = 120;
  let totalToolCalls = 0;
  const MAX_TOTAL_DURATION = MAX_TOTAL_DURATION_MS; // 放宽到 15 分钟，允许长任务 Agent 完整跑完
  const _toolChainStart = Date.now();
  let lastToolSignature = '';
  // 近期工具签名窗口：捕获「参数略有变化但调用模式重复」的循环
  const recentSigs = [];

  // ── SSE 保活心跳（同 stream-openai.js）──
  let toolRunning = false;
  let toolRunningName = '';
  let toolRunStart = 0;
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (toolRunning) {
        const secs = Math.floor((Date.now() - toolRunStart) / 1000);
        res.write(`data: ${JSON.stringify({ type: 'status', message: `⏳ ${toolRunningName} 运行中…（已 ${secs}s）` })}\n\n`);
      }
    } catch { /* connection already closed */ }
  }, 15_000);
  const _finish = () => { try { clearInterval(heartbeat); } catch { /* ignore */ } };

  // ── 客户端断开（停止生成）检测：同 stream-openai.js ──
  // ⚠️ 必须监听 res('close') 而非 req('close')：POST 请求体在 body-parser 阶段即被
  // 读完，req 的 readable 侧随即关闭，Node 会在响应刚开始流式输出时（writableEnded=false）
  // 立刻触发 req 'close'，即使客户端仍在正常接收 → 误判中断 → 首轮工具后 break →
  // 误报「已达到最大工具调用次数(50轮)」。改用 res('close') + !writableEnded 守卫。
  let _aborted = false;
  const onClientClose = () => {
    if (res.writableEnded) return; // 正常收尾触发的 close，忽略
    _aborted = true;
    try { abortDelegate(); } catch { /* ignore */ }
  };
  if (res && typeof res.on === 'function') {
    res.on('close', onClientClose);
  }

  // ── 单次模型调用封装：fetch + 流式解析，
  // 内部对「中途断流」按 STREAM_MAX_RETRIES 重试（相同 messages 重发）。
  // 返回 parseAnthropicStream 的结果（truncated 标记交由外层决定重试或断点续传）。
  let rateLimited = false; // 命中 429 限流后置位，阻止后续重试/续传挥霍额度
  async function doModelCall(conversation, systemText) {
    const body = {
      model: modelName,
      messages: conversation,
      system: systemText || undefined,
      max_tokens: 32768,
      stream: true,
    };
    if (anthropicTools) {
      body.tools = anthropicTools;
    }
    const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');
    let pr;
    let streamAttempt = 0;
    while (true) {
      if (_aborted) break; // 用户已停止，不再发起新的模型调用
      let response;
      try {
        response = await fetchLlmWithRetry(url, {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }, body, { res, retryReasonLabel: 'Anthropic', isAborted: () => _aborted });
      } catch (fetchErr) {
        // 限流（429）：标记并立即上抛，禁止后续重试/续传挥霍额度
        if (fetchErr && fetchErr.message && fetchErr.message.startsWith('RATE_LIMIT:')) {
          rateLimited = true;
        }
        throw fetchErr;
      }

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(safeApiError(response, errBody, 'Anthropic API'));
      }

      const parsed = await parseAnthropicStream(response, res);
      // 截断：在重试次数内则重发同一请求（上游可能已恢复）；否则返回 truncated 交外层
      if (rateLimited) {
        throw new Error('RATE_LIMIT: 疑似上游限流（429），已停止重试以免挥霍额度。请稍后重试或升级套餐。');
      }
      if (parsed.truncated && streamAttempt < STREAM_MAX_RETRIES) {
        streamAttempt++;
        res.write(`data: ${JSON.stringify({ type: 'status', message: `↻ 连接中断，正在重试（第 ${streamAttempt} 次）…` })}\n\n`);
        if (_aborted) break;
        continue;
      }
      pr = parsed;
      break;
    }
    return pr;
  }

  try {

  while (toolCallCount < MAX_TOOL_ROUNDS) {
    if (_aborted) {
      console.log('[chat] client disconnected (stop), aborting stream');
      break;
    }
    if (Date.now() - _toolChainStart > MAX_TOTAL_DURATION) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '工具调用总超时（15 分钟），停止继续调用' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // ── 累计工具执行次数硬上限（防失控循环瞬间打满 50 轮）──
    if (totalToolCalls >= MAX_TOTAL_TOOL_CALLS) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '已达单次请求工具调用安全上限，停止以避免失控' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const systemMsg = currentMessages.find(m => m.role === 'system');
    const conversation = buildAnthropicConversation(currentMessages);
    const systemText = systemMsg?.content || undefined;

    // ── 本轮：fetch + 流式解析（内部对中途断流按 STREAM_MAX_RETRIES 重试）──
    let parseResult = await doModelCall(conversation, systemText);

    if (_aborted) {
      console.log('[chat] client disconnected (stop), aborting stream');
      break;
    }

    // 最终回答（无工具调用）在传输途中被截断 → 「断点续传」：
    // 把已收到的半截内容回灌为 assistant 消息 + 一条「请从中断处继续」的 user 消息，
    // 重新请求模型，多段拼成完整回答。专门破解上游(apihub 等代理)对单次响应的
    // 长度/时长上限——这种确定性截断靠「相同请求重试」永远在同一处失败，必须续传。
    if (parseResult.truncated && parseResult.toolCalls.length === 0) {
      if (rateLimited) {
        throw new Error('RATE_LIMIT: 疑似上游限流（429），已停止续传以免挥霍额度。请稍后重试或升级套餐。');
      }
      let cont = 0;
      while (parseResult.truncated && parseResult.toolCalls.length === 0 && cont < CONTINUE_ROUNDS) {
        cont++;
        res.write(`data: ${JSON.stringify({ type: 'status', message: `↻ 回复在传输中被截断，正在续传（第 ${cont} 次）…` })}\n\n`);
        currentMessages.push({ role: 'assistant', content: parseResult.assistantContent || '' });
        currentMessages.push({
          role: 'user',
          content: '（你的上一段回复在传输途中被截断，请从中断处无缝继续，不要重复已输出的内容，直接接着写。）',
        });
        const conv = buildAnthropicConversation(currentMessages);
        const sys = currentMessages.find(m => m.role === 'system')?.content || undefined;
        parseResult = await doModelCall(conv, sys);
        if (_aborted) break;
      }
      if (parseResult.truncated && parseResult.toolCalls.length === 0) {
        throw new Error(`回复在续传 ${CONTINUE_ROUNDS} 次后仍被上游截断。可能是上游对单次响应有长度/时长上限（或免费额度限流），建议把任务拆小或分段提问，稍后重试。`);
      }
    } else if (parseResult.truncated && parseResult.toolCalls.length > 0) {
      // 工具轮次被截断（罕见）→ 保持原行为：相同请求重试已耗尽，抛可见错误
      throw new Error(`模型流式响应在重试用尽后仍被中断（已重试 ${STREAM_MAX_RETRIES} 次）。可能是网络不稳定、上游服务中断，或免费额度限流（429）。`);
    }

    const { toolCalls, assistantBlocks, usage } = parseResult;

    // 注意：usage 已由 parseAnthropicStream 在「无工具调用」终态分支中
    // 写入并紧接着 res.end()；此处不能再写，否则会出现「end 之后继续 write」，
    // 在真实 Express 响应上触发 write-after-end 且让 [DONE] 不再是流的最后字节。
    if (toolCalls.length === 0) {
      return;
    }

    // ── Cycle detection ──
    const sig = toolCalls.map(t => `${t.name}:${JSON.stringify(t.input)}`).join('|');
    if (sig === lastToolSignature && toolCallCount > 0) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '检测到重复工具调用，停止' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    // 近期签名窗口：捕获「参数略有变化但调用模式重复」的循环
    if (recentSigs.includes(sig)) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '检测到重复工具调用模式，停止' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    recentSigs.push(sig);
    if (recentSigs.length > 8) recentSigs.shift();
    lastToolSignature = sig;

    toolCallCount++;

    // Build assistant message with Anthropic content blocks
    const assistantMsg = {
      role: 'assistant',
      content: assistantBlocks.map(b => {
        if (b.type === 'tool_use') {
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
        }
        return { type: 'text', text: b.text || '' };
      }),
    };
    currentMessages.push(assistantMsg);

    const toolNames = [...new Set(toolCalls.map(t => t.name))];
    res.write(`data: ${JSON.stringify({ type: 'status', message: `正在查询 ${toolNames.join(', ')}...` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'tool_call_start', names: toolNames })}\n\n`);

    // 标记工具执行中，心跳展示“运行中…（已 Xs）”
    toolRunning = true;
    toolRunningName = toolNames.join(', ');
    toolRunStart = Date.now();

    // Execute each tool — isolated so one failure doesn't break the chain
    const toolResultBlocks = [];
    for (const tc of toolCalls) {
      let args = {};
      try { args = tc.input || {}; } catch { /* use empty */ }
      const tcStart = Date.now();
      let result, tcError;
      try {
        result = await executeToolCall(tc.name, args, broadcastFn, requestId);
      } catch (unexpectedErr) {
        result = `[Tool Error] ${unexpectedErr.message}`;
        tcError = unexpectedErr.message;
      }
      totalToolCalls++; // 累计工具执行次数（含失败），用于硬上限防失控
      const tcDur = Date.now() - tcStart;

      res.write(`data: ${JSON.stringify({
        type: 'tool_call_end',
        name: tc.name,
        durMs: tcDur,
        truncated: result && result.length > 500,
        error: tcError || undefined,
        result: capToolResultPreview(result),
      })}\n\n`);

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: result || '[No result]',
      });
    }

    toolRunning = false; // 工具执行结束

    // Anthropic: tool results go in a user-role message with tool_result content blocks
    currentMessages.push({
      role: 'user',
      content: toolResultBlocks,
    });

    res.write(`data: ${JSON.stringify({ type: 'status', message: '正在生成回答...' })}\n\n`);

    toolRateLimiter.reset(requestId);
    currentMessages = pruneToolContext(currentMessages);
    currentMessages = trimHistory(currentMessages);
    // ── A 方案：封顶旧工具轮上下文，破「上下文雪球」几何增长（治本 429）──
    currentMessages = capToolRounds(currentMessages);
  }

  // 仅当真正达到轮次硬上限才提示；被中断(_aborted)时由 finally 静默补 [DONE]，
  // 避免把「用户停止/断连」误报成「已达到最大工具调用次数」。
  if (!_aborted) {
    res.write(`data: ${JSON.stringify({ type: 'token', content: '\n\n[已达到最大工具调用次数(50轮)，部分结果可能不完整]' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
  } finally {
    if (_aborted) {
      try {
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch { /* ignore */ }
      try { killDelegatePTY(); } catch { /* ignore */ }
    }
    if (res && typeof res.removeListener === 'function') {
      res.removeListener('close', onClientClose);
    }
    _finish();
  }
}

module.exports = {
  streamAnthropicWithTools,
  parseAnthropicStream,
  streamAnthropicCore,
  buildAnthropicConversation,
};
