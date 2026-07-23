// @ts-check
// ============================================================
// OpenAI Stream — SSE streaming with tool support
//
// Handles OpenAI API streaming chat completions with:
// - Multi-round tool calling (up to 50 rounds)
// - Native and XML-based tool call detection
// - SSE stream parsing and token forwarding
// - Cycle detection for repeated tool calls
// - 120s total execution timeout
// - 60s stream inactivity timeout
// ============================================================

const {
  safeApiError,
  parseTextToolCall,
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
const { QCLI_TOOLS, executeToolCall, toolRateLimiter } = require('./tools');
const { pruneToolContext } = require('./token-budget');
const { killDelegatePTY, abortDelegate } = require('../ai-tools/builtin/agent');

/**
 * Stream OpenAI completion with optional Q-CLI tool use.
 * When the model calls a tool, the function executes it,
 * sends a status event, then loops back with tools still
 * enabled for chained tool calls.
 *
 * @param {import('express').Response} res - SSE response stream
 * @param {Array<{role:string, content?:string}>} messages - Chat messages
 * @param {string} apiKey - OpenAI API key
 * @param {string} [model] - Model name (default: gpt-4o-mini)
 * @param {string} [baseUrl] - Custom API base URL
 * @param {Array} [tools] - Tool definitions
 * @param {Function} [broadcastFn] - WebSocket broadcast for metrics
 * @param {import('express').Request} [req] - Incoming request (for client-disconnect detection)
 */
async function streamOpenAIWithTools(res, messages, apiKey, model, baseUrl, tools, broadcastFn, req, maxRounds) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');
  // 每请求隔离标识：用于限流桶归属（P2-3），避免多会话共享全局单例相互饿死
  const requestId = `chat-${  Date.now().toString(36)  }-${  Math.random().toString(36).slice(2, 8)}`;

  let currentMessages = [...messages];
  let toolCallCount = 0;
  // 工具轮次上限：默认 50；自检等场景可由调用方收紧（如 6 轮）以砍 LLM 调用数；
  // 亦可用环境变量 HESI_LLM_MAX_TOOL_ROUNDS 覆盖。
  const MAX_TOOL_ROUNDS = Number(process.env.HESI_LLM_MAX_TOOL_ROUNDS) || maxRounds || 50;
  // 单次请求「累计工具执行次数」硬上限：防止失控循环在瞬间打满 50 轮（即用户反馈的
  // "一瞬间达到最大工具调用次数"）。与 MAX_TOOL_ROUNDS（LLM 轮次上限）互为补充。
  const MAX_TOTAL_TOOL_CALLS = 120;
  let totalToolCalls = 0;
  const MAX_TOTAL_DURATION = MAX_TOTAL_DURATION_MS; // 放宽到 15 分钟，允许长任务 Agent（如 agent_delegate 最多 300s）完整跑完
  const _toolChainStart = Date.now();
  let lastToolSignature = '';
  // 近期工具签名窗口：捕获「参数略有变化但调用模式重复」的循环（原仅查连续完全相同）
  const recentSigs = [];

  // ── SSE 保活心跳：长工具/Agent 执行期间 SSE 可能数分钟无数据，
  //    必须周期性写入，否则 socket 空闲超时会杀掉连接（前端“调用工具被断开”）。──
  let toolRunning = false;
  let toolRunningName = '';
  let toolRunStart = 0;
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n'); // SSE 注释行，对前端不可见，仅用于保活
      if (toolRunning) {
        const secs = Math.floor((Date.now() - toolRunStart) / 1000);
        res.write(`data: ${JSON.stringify({ type: 'status', message: `⏳ ${toolRunningName} 运行中…（已 ${secs}s）` })}\n\n`);
      }
    } catch { /* connection already closed */ }
  }, 15_000);
  const _finish = () => { try { clearInterval(heartbeat); } catch { /* ignore */ } };

  // ── 客户端断开（停止生成）检测 ──
  // 前端点击「停止」会 abort fetch，浏览器侧 socket 关闭。后端若不感知，
  // 仍会继续跑 LLM 流 + 工具循环（含 agent PTY 子进程），既浪费资源又让
  // 前端卡在「生成中」无法恢复。
  //
  // ⚠️ 关键坑（实测复现）：绝不能监听 **req**('close')。POST /chat 的请求体在
  // body-parser 阶段就被完整读取，readable 侧随即关闭 → Node 会在**响应刚开始
  // 流式输出时**（writableEnded=false）立刻触发 req 'close'，即使客户端仍在正常
  // 接收。旧实现据此置 _aborted=true，导致「首轮工具跑完 → 下一轮开头 break →
  // 落到『已达到最大工具调用次数(50轮)』」的误报（用户反馈的“一瞬间打满上限”）。
  // 正确做法：监听 **res**('close')，且仅当响应尚未正常结束（!res.writableEnded）
  // 时才视为真正的客户端断开——res 'close' 在正常收尾时 writableEnded 已为 true，
  // 会被下面的守卫忽略，只有真实断连才会 writableEnded=false。
  let _aborted = false;
  const onClientClose = () => {
    if (res.writableEnded) return; // 响应已正常结束的 close，非中断，忽略
    _aborted = true;
    // 立即中断正在执行的 agent_delegate（其 executeAgent 在 await PTY，不会自然返回）
    try { abortDelegate(); } catch { /* ignore */ }
  };
  if (res && typeof res.on === 'function') {
    res.on('close', onClientClose);
  }

  // ── 单次模型调用封装：fetch + 流式解析，
  // 内部对「中途断流」按 STREAM_MAX_RETRIES 重试（相同 messages 重发）。
  // 返回 parseStreamAndCollectTools 的结果（truncated 标记交由外层决定重试或断点续传）。
  let rateLimited = false; // 命中 429 限流后置位，阻止后续重试/续传挥霍额度
  async function doModelCall(messages) {
    const body = {
      model: modelName,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 32768,
    };
    if (tools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    let pr;
    let streamAttempt = 0;
    while (true) {
      if (_aborted) break; // 用户已停止，不再发起新的模型调用
      let response;
      try {
        response = await fetchLlmWithRetry(url, {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }, body, { res, retryReasonLabel: 'OpenAI', isAborted: () => _aborted });
      } catch (fetchErr) {
        // 限流（429）：标记并立即上抛，禁止后续重试/续传挥霍额度
        if (fetchErr && fetchErr.message && fetchErr.message.startsWith('RATE_LIMIT:')) {
          rateLimited = true;
        }
        throw fetchErr;
      }

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(safeApiError(response, errBody, 'OpenAI API'));
      }

      const parsed = await parseStreamAndCollectTools(response, res);
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
    // 客户端已断开（用户点停止或刷新/关闭）→ 立即中断整条流，避免孤儿进程与卡死
    if (_aborted) {
      console.log('[chat] client disconnected (stop), aborting stream');
      break;
    }

    // ── Total timeout check ──
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

    // ── 本轮：fetch + 流式解析（内部对中途断流按 STREAM_MAX_RETRIES 重试）──
    let parseResult = await doModelCall(currentMessages);

    if (_aborted) {
      console.log('[chat] client disconnected (stop), aborting stream');
      break;
    }

    // 最终回答（无工具调用）在传输途中被截断 → 「断点续传」：
    // 把已收到的半截内容回灌为 assistant 消息 + 一条「请从中断处继续」的 user 消息，
    // 重新请求模型，多段拼成完整回答。专门破解上游(apihub 等代理)对单次响应
    // 的长度/时长上限——这种确定性截断靠「相同请求重试」永远在同一处失败，必须续传。
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
        parseResult = await doModelCall(currentMessages);
        if (_aborted) break;
      }
      if (parseResult.truncated && parseResult.toolCalls.length === 0) {
        throw new Error(`回复在续传 ${CONTINUE_ROUNDS} 次后仍被上游截断。可能是上游对单次响应有长度/时长上限（或免费额度限流），建议把任务拆小或分段提问，稍后重试。`);
      }
    } else if (parseResult.truncated && parseResult.toolCalls.length > 0) {
      // 工具轮次被截断（罕见）→ 保持原行为：相同请求重试已耗尽，抛可见错误
      throw new Error(`模型流式响应在重试用尽后仍被中断（已重试 ${STREAM_MAX_RETRIES} 次）。可能是网络不稳定、上游服务中断，或免费额度限流（429）。`);
    }

    const { toolCalls, assistantContent, usage } = parseResult;

    if (toolCalls.length === 0) {
      // No tool calls — already sent [DONE] + res.end() in parser
      return;
    }

    // ── Cycle detection: same tool+args as last round → break ──
    const sig = toolCalls.map(t => `${t.name}:${t.arguments}`).join('|');
    if (sig === lastToolSignature && toolCallCount > 0) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '检测到重复工具调用，停止' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    // 近期签名窗口：捕获「参数略有变化但调用模式重复」的循环（原仅查连续完全相同）
    if (recentSigs.includes(sig)) {
      res.write(`data: ${JSON.stringify({ type: 'status', message: '检测到重复工具调用模式，停止' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    recentSigs.push(sig);
    if (recentSigs.length > 8) recentSigs.shift();
    lastToolSignature = sig;

    // ── Tool calls detected — execute them ──
    toolCallCount++;

    // Build assistant message
    const assistantMsg = { role: 'assistant', content: assistantContent || null };
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    currentMessages.push(assistantMsg);

    // Send status + tool_call_start event to client
    const toolNames = [...new Set(toolCalls.map(t => t.name))];
    res.write(`data: ${JSON.stringify({ type: 'status', message: `正在查询 ${toolNames.join(', ')}...` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'tool_call_start', names: toolNames })}\n\n`);

    // 标记工具执行中，心跳会据此向前端展示“运行中…（已 Xs）”以减少“卡住”错觉
    toolRunning = true;
    toolRunningName = toolNames.join(', ');
    toolRunStart = Date.now();

    // Execute each tool — isolated so one failure doesn't break the chain
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.arguments); } catch { /* use empty */ }
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

      currentMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result || '[No result]',
      });
    }

    toolRunning = false; // 工具执行结束，停止“运行中”心跳提示

    // Send "continuing" status
    res.write(`data: ${JSON.stringify({ type: 'status', message: '正在生成回答...' })}\n\n`);

    // ── Reset token bucket for next round (per-request 隔离) ──
    toolRateLimiter.reset(requestId);
    // ── 跨轮工具结果压缩：合并重复 agent_poll 增量、压低 token（不影响功能）──
    currentMessages = pruneToolContext(currentMessages);
    // ── Trim history to prevent context overflow ──
    currentMessages = trimHistory(currentMessages);
    // ── A 方案：封顶旧工具轮上下文，破「上下文雪球」几何增长（治本 429）──
    //    保留最近 6 轮完整 + 更早 tool 结果压缩为短占位；单条超 6000 字符硬截断。
    currentMessages = capToolRounds(currentMessages);
  }

  // 走到这里只有两种可能：① 真正达到轮次硬上限(toolCallCount>=MAX_TOOL_ROUNDS)；
  // ② 被客户端中断(_aborted break)。只有 ① 才提示「已达上限」，② 交由 finally 静默
  // 补发 [DONE]，避免把「用户主动停止/断连」误报成「已达到最大工具调用次数」。
  if (!_aborted) {
    res.write(`data: ${JSON.stringify({ type: 'token', content: '\n\n[已达到最大工具调用次数(50轮)，部分结果可能不完整]' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
  } finally {
    // 客户端中断时，确保流能正常结束（发 [DONE]），让前端 onDone 触发、UI 恢复可交互
    if (_aborted) {
      try {
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch { /* ignore */ }
    }
    // 清理可能仍在跑的 agent_delegate 游离 PTY，防止孤儿进程
    if (_aborted) {
      try { killDelegatePTY(); } catch { /* ignore */ }
    }
    if (res && typeof res.removeListener === 'function') {
      res.removeListener('close', onClientClose);
    }
    _finish();
  }
}

/**
 * Parse an OpenAI SSE stream, sending text tokens to the client
 * and collecting tool_calls. Returns when the stream ends or
 * when finish_reason is 'tool_calls'.
 *
 * @param {Response} response - Fetch Response object with SSE body
 * @param {import('express').Response} res - Express response for forwarding tokens
 * @returns {Promise<{ toolCalls: Array<{id:string, name:string, arguments:string}>, assistantContent: string, usage: object|null }>}
 */
async function parseStreamAndCollectTools(response, res, sink = null) {
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

  let assistantContent = '';
  /** @type {Array<{id:string, name:string, arguments:string}>} */
  const toolCalls = [];
  let finishReason = null;
  let streamEnded = false;
  /** @type {boolean} 是否收到 OpenAI SSE 权威结束信号 data: [DONE]（流正常完成的标志） */
  let sawDone = false;
  /** @type {boolean} 上游是否在未发送正常 finish_reason 前就结束了流（中途断流） */
  let truncated = false;
  /** @type {{prompt_tokens?:number, completion_tokens?:number, total_tokens?:number}|null} */
  let usage = null;

  // Text tool call state (for <tool_call> XML filtering across chunks)
  let tcBuffer = '';

  // ── Stream timeout protection ──
  let lastDataTime = Date.now();

  while (true) {
    let done, value;
    try {
      ({ done, value } = await reader.read());
    } catch (readErr) {
      // 读取途中抛错（网络抖动 / 上游连接被重置）→ 视为中途断流，交由外层重试
      truncated = true;
      streamEnded = true;
      break;
    }
    if (done) { streamEnded = true; break; }
    if (value) lastDataTime = Date.now();

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') { streamEnded = true; sawDone = true; break; }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        finishReason = parsed.choices?.[0]?.finish_reason;

        if (parsed.usage) {
          usage = parsed.usage;
        }

        if (delta) {
          // ── Content streaming with <tool_call> XML filtering ──
          if (delta.content) {
            tcBuffer += delta.content;
            let cleanPart = '';

            while (tcBuffer.length > 0) {
              const tcStart = tcBuffer.indexOf('<tool_call>');
              if (tcStart === -1) {
                cleanPart += tcBuffer;
                tcBuffer = '';
                break;
              }
              cleanPart += tcBuffer.slice(0, tcStart);
              const tcEnd = tcBuffer.indexOf('</tool_call>', tcStart);
              if (tcEnd === -1) {
                tcBuffer = tcBuffer.slice(tcStart);
                break;
              }
              const tcXml = tcBuffer.slice(tcStart, tcEnd + '</tool_call>'.length);
              const parsedTc = parseTextToolCall(tcXml);
              if (parsedTc) toolCalls.push(parsedTc);
              tcBuffer = tcBuffer.slice(tcEnd + '</tool_call>'.length);
            }

            if (cleanPart) {
              assistantContent += cleanPart;
              writeToken(cleanPart);
            }
          }

          // ── Native tool_calls ──
          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tcDelta.id || '', name: '', arguments: '' };
              }
              if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
              if (tcDelta.function?.name) toolCalls[idx].name += tcDelta.function.name;
              if (tcDelta.function?.arguments) toolCalls[idx].arguments += tcDelta.function.arguments;
            }
          }
        }

        if (finishReason === 'tool_calls') {
          streamEnded = true;
          break;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    if (Date.now() - lastDataTime > STREAM_IDLE_TIMEOUT_MS) {
      // 空闲超时：视为「上游卡死 / 断流」，标记截断交由外层重试（而非直接腰斩）
      truncated = true;
      return { toolCalls: [], assistantContent: '', usage: null, truncated: true };
    }

    if (streamEnded) break;
  }

  // Flush any remaining clean text in tcBuffer
  if (tcBuffer && !tcBuffer.startsWith('<tool_call>')) {
    assistantContent += tcBuffer;
    writeToken(tcBuffer);
  }

  // ── 截断检测：流结束但未收到正常结束信号 → 上游中途断流 ──
  // 关键修正：OpenAI SSE 以 data: [DONE] 作为「流正常完成」的权威信号；
  // finish_reason 只是「为何结束」的元数据，部分本地模型(llama.cpp/LM Studio/
  // 自定义 qwen build)不发 finish_reason、仅以 [DONE] 收尾。此类场景下若仅因
  // 缺 finish_reason 就判截断，会导致「模型已完整出完却被误判中断、续传空转」。
  // 因此：收到 [DONE] 即视为正常完成（除非 finish_reason==='length' 确为上限截断）；
  // 仅在「流结束且既无 [DONE] 也无 finish_reason」时才判为中途断流。
  if (finishReason === 'length') {
    truncated = true; // 确命中 max_tokens，内容被截断
  } else if (streamEnded && !finishReason && !sawDone) {
    truncated = true; // 无 [DONE]、无 finish_reason → 上游中途断流
  }

  const allToolCalls = toolCalls.filter(Boolean);

  if (finishReason === 'tool_calls' || allToolCalls.length > 0) {
    return { toolCalls: allToolCalls, assistantContent, usage, truncated: false };
  }

  // No tool calls — done; send usage before [DONE]
  if (usage) {
    writeUsage(usage);
  }
  // 截断：不结束流，交由外层重试（用相同 messages 重新请求模型）
  if (truncated) {
    return { toolCalls: [], assistantContent, usage, truncated: true };
  }
  writeDone();
  return { toolCalls: [], assistantContent, usage, truncated: false };
}

/**
 * 回调版 OpenAI 流式核心（讨论模式等非工具纯文本场景共用）。
 *
 * 与主聊 streamOpenAIWithTools 共用同一套请求体构造 + 解析（parseStreamAndCollectTools），
 * 因此对本地/代理模型（qwen3.6 / LM Studio 等）的解析兼容性完全一致——
 * 根除 discuss.js 旧自写解析器「AI 助手回合空白」的根因。
 * token 通过 onToken 回调外抛（不直写 res），便于讨论模式把内容路由到「当前发言方气泡」。
 *
 * @param {string} baseUrl - API base（/v1 由 buildApiUrl 自动补全）
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{role:string, content:string}>} messages
 * @param {{onToken?:Function, onUsage?:Function, isAborted?:()=>boolean}} [cbs]
 * @returns {Promise<string>} 完整助手文本
 */
async function streamOpenAICore(baseUrl, apiKey, model, messages, cbs = {}) {
  const { onToken, onUsage, isAborted } = cbs;
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');
  // 请求体与主聊 doModelCall 完全一致：stream + stream_options(usage) + max_tokens；
  // 不传 tools → 纯文本生成，契合讨论模式「AI 助手回合 / 结论汇总」不需要工具调用。
  const body = {
    model: modelName,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 32768,
  };
  const response = await fetchLlmWithRetry(url, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }, body, { retryReasonLabel: 'OpenAI', isAborted });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(safeApiError(response, errBody, 'OpenAI API'));
  }
  const result = await parseStreamAndCollectTools(response, null, {
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

module.exports = {
  streamOpenAIWithTools,
  parseStreamAndCollectTools,
  streamOpenAICore,
};
