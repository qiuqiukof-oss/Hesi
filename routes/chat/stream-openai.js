/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

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
const { ContextWindowManager } = require('../../lib/context-window');
const cwManager = new ContextWindowManager();
const { QCLI_TOOLS, executeToolCall, toolRateLimiter } = require('./tools');
const { pruneToolContext } = require('./token-budget');
const { describeTools } = require('./tool-labels');
const { killDelegatePTY, abortDelegate } = require('../ai-tools/builtin/agent');
const { CircuitBreaker } = require('./circuit-breaker');
const { buildReasoningParams } = require('./reasoning-config'); // L3 (v0.7.5): 推理强度控制

/**
 * M5 (v0.3.1): 轮末结算广播「agent_metrics」。
 * 在 SSE 流结束（[DONE]）之前调用，确保前端 chat-api.js 的 SSE 解析能收到。
 * 仅当本回合金有节省项（缓存命中/工具复用/经验/技能注入任一 >0）才发，避免无收益刷噪声。
 * 幂等：用 res._hesiMetricsSent 标记，同一请求只发一次。broadcastFn 可空（parser 环境无 WS 句柄）。
 * @param {import('express').Response} res
 * @param {Function} [broadcastFn]
 */
function emitAgentMetrics(res, broadcastFn) {
  if (!res || res._hesiMetricsSent || !res._hesiMetrics) return;
  const m = res._hesiMetrics;
  const anySaving = (m.cacheReadTokens || 0) + (m.cacheCreationTokens || 0)
    + (m.toolCacheHits || 0) + (m.experienceHits || 0) + (m.skillsInjected || 0);
  if (anySaving <= 0) return;
  const payload = { type: 'agent_metrics', data: m };
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {}
  if (typeof broadcastFn === 'function') { try { broadcastFn(payload); } catch {} }
  res._hesiMetricsSent = true;
}

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
async function streamOpenAIWithTools(res, messages, apiKey, model, baseUrl, tools, broadcastFn, req, maxRounds, reasoningEffort) {
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
  // v0.5.3: 降级继续机制——安全熔断首次触发时仅注入警告并给 LLM 一次补救机会，
  // 而非立即硬停。若警告后再次触发，则触发真正硬停。
  // 状态机已抽至 routes/chat/circuit-breaker.js（与 stream-anthropic.js 共用），
  // OpenAI 路径警告消息 role 用 'system'（system 合并后行为不变）。
  // relaxed 档：本地 LLM（baseUrl 为 localhost / 127.0.0.1，或 model==='local-model'）
  // 工具调用弱、易重复，放宽循环守卫阈值避免正常探索被误杀而“回复中断”。
  // 可用 env HESI_LLM_RELAXED=1 强制开启；云模型（OpenAI/Anthropic 官方）保持严格。
  const isLocal = /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|$)/.test(baseUrl || '')
    || model === 'local-model'
    || !!process.env.HESI_LLM_RELAXED;
  const breaker = new CircuitBreaker({ warnRole: 'system', maxTotalDurationMs: MAX_TOTAL_DURATION_MS, relaxed: isLocal });

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
    // 按 requestId 精准 kill 本请求的游离 PTY，避免误杀其他并发请求的 Agent（审查 C2）
    try { abortDelegate(requestId); } catch { /* ignore */ }
  };
  if (res && typeof res.on === 'function') {
    res.on('close', onClientClose);
  }

  // ── 单次模型调用封装：fetch + 流式解析，
  // 内部对「中途断流」按 STREAM_MAX_RETRIES 重试（相同 messages 重发）。
  // 返回 parseStreamAndCollectTools 的结果（truncated 标记交由外层决定重试或断点续传）。
  let rateLimited = false; // 命中 429 限流后置位，阻止后续重试/续传挥霍额度
  async function doModelCall(messages, noTools) {
    const body = {
      model: modelName,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: cwManager.maxOutputTokens(modelName),
    };
    if (tools && !noTools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    // L3 (v0.7.5): 推理强度控制 —— 按 provider+model+档位注入原生参数。
    // 不支持的模型 / standard 档：buildReasoningParams 返回 null，不注入（避免 400）。
    const _rp = buildReasoningParams('openai', modelName, reasoningEffort, cwManager.maxOutputTokens(modelName));
    if (_rp) Object.assign(body, _rp);
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
    if (Date.now() - breaker.toolChainStart > breaker.maxTotalDurationMs) {
      if (breaker.guard(res, currentMessages, '工具调用总超时（15 分钟）', '请总结当前已完成的工作并输出最终回答。', '工具调用总超时（15 分钟），已给过警告，强制停止') === 'stop') return;
      continue;
    }

    // ── 累计工具执行次数硬上限（防失控循环瞬间打满 50 轮）──
    if (breaker.totalToolCalls >= breaker.maxTotalToolCalls) {
      if (breaker.guard(res, currentMessages, '已达单次请求工具调用安全上限', '请总结当前已完成的工作并输出最终回答。', '已达单次请求工具调用安全上限，强制停止') === 'stop') return;
      continue;
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

    // ── Cycle detection: same tool+args as last round → warn instead of stop ──
    const sig = toolCalls.map(t => `${t.name}:${t.arguments}`).join('|');
    const cycleR = breaker.cycle(res, currentMessages, sig, toolCallCount);
    if (cycleR === 'stop') return;
    if (cycleR === 'continue') continue;
    // 近期签名窗口：捕获「参数略有变化但调用模式重复」的循环（原仅查连续完全相同）
    const dupR = breaker.dup(res, currentMessages, sig);
    if (dupR === 'stop') return;
    if (dupR === 'continue') continue;

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
    // 工具循环失控防护：同一组工具名连续重复调用 → 提前停止，避免烧到 50 轮硬上限
    const nameSet = toolNames.slice().sort().join('|');
    const consecR = breaker.consecutive(res, currentMessages, nameSet);
    if (consecR === 'stop') return;
    if (consecR === 'continue') continue;
    res.write(`data: ${JSON.stringify({ type: 'status', message: `使用${describeTools(toolNames)}…` })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'tool_call_start', names: toolNames })}\n\n`);

    // 标记工具执行中，心跳会据此向前端展示“运行中…（已 Xs）”以减少“卡住”错觉
    toolRunning = true;
    toolRunningName = describeTools(toolNames);
    toolRunStart = Date.now();

    // Execute each tool — isolated so one failure doesn't break the chain
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.arguments); } catch { /* use empty */ }
      const tcStart = Date.now();
      let result, tcError;
      try {
        // M5 (v0.3.1): 传入本请求 metrics（与 cacheReadTokens/skillsInjected 共享同一对象）。
        const _metrics = (res._hesiMetrics = res._hesiMetrics || { cacheReadTokens: 0, cacheCreationTokens: 0, toolCacheHits: 0, experienceHits: 0, skillsInjected: 0 });
        result = await executeToolCall(tc.name, args, broadcastFn, requestId, _metrics, req && req._hesiSessionId);
      } catch (unexpectedErr) {
        result = `[Tool Error] ${unexpectedErr.message}`;
        tcError = unexpectedErr.message;
      }
      breaker.tickTotal(); // 累计工具执行次数（含失败），用于硬上限防失控
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
  // ② 被客户端中断(_aborted break)。
  //
  // v0.5.3: 降级继续——不再直接硬停。首次达到上限时注入警告，给 LLM 一次
  // 无工具调用的「最终回答」机会（参考 WorkBuddy 上下文压缩不中断模式）。
  // 仅当已给过警告或客户端断开时才真正结束。
  if (!_aborted) {
    const roundLimitR = breaker.degradeAtRoundLimit(
      res, currentMessages,
      '已达到最大工具调用轮次',
      '请基于已完成的工具调用结果直接输出任务总结。不要再调用任何工具。'
    );
    if (roundLimitR === 'first') {
      // 首次触发上限：降级继续，给一次无工具调用的最终回答机会
      res.write(`data: ${JSON.stringify({ type: 'status', message: `⚠️ 已达 ${MAX_TOOL_ROUNDS} 轮工具调用上限，降级继续：请模型输出最终回答` })}\n\n`);
      try {
        // 最终轮：不带工具，强制 LLM 输出纯文本总结
        const finalResult = await doModelCall(currentMessages, true /* noTools */);
        // 如果有文本输出，流式输出已在 doModelCall 内部完成
        // 发送最终事件
        emitAgentMetrics(res, broadcastFn);
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch {
        // 最终轮失败，兜底硬停
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'token', content: `\n\n[已达到最大工具调用次数(${MAX_TOOL_ROUNDS}轮)，最终总结生成失败]` })}\n\n`);
          emitAgentMetrics(res, broadcastFn);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
    } else {
      // 已经给过警告，真正硬停
      res.write(`data: ${JSON.stringify({ type: 'token', content: `\n\n[已达到最大工具调用次数(${MAX_TOOL_ROUNDS}轮)，已给过补救机会，部分结果可能不完整]` })}\n\n`);
      emitAgentMetrics(res, broadcastFn);
      res.write('data: [DONE]\n\n');
      res.end();
    }
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
    // 清理可能仍在跑的 agent_delegate 游离 PTY，防止孤儿进程（按 requestId 精准清理）
    if (_aborted) {
      try { killDelegatePTY(requestId); } catch { /* ignore */ }
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
  // L1 (v0.7.4): 推理模型（DeepSeek-R1 / Qwen3 / o-series）的 reasoning_content 透传。
  // 按 chunk 推，不攒完；sink 场景（讨论模式）经 onReasoning 外抛，主聊直写 res。
  const writeReasoning = (c) => {
    if (sink?.onReasoning) { sink.onReasoning(c); return; }
    if (res) { try { res.write(`data: ${JSON.stringify({ type: 'reasoning', content: c })}\n\n`); } catch {} }
  };
  const writeUsage = (u) => {
    if (sinkOnUsage) { sinkOnUsage(u); return; }
    if (res) {
      try {
          res.write(`data: ${JSON.stringify({ type: 'usage', usage: u })}\n\n`);
          // M1③ (v0.3.1): 累加缓存命中/创建 token 到 request-scoped metrics（M5 统一广播）。
          if (u) {
            res._hesiMetrics = res._hesiMetrics || { cacheReadTokens: 0, cacheCreationTokens: 0, toolCacheHits: 0, experienceHits: 0, skillsInjected: 0, actualUsed: 0 };
            // OpenAI 仅在 prompt_tokens_details.cached_tokens 返回「读取命中」量；
            // 其 API 不暴露「缓存写入」量，故 cacheCreationTokens 在 OpenAI 下恒为 0（provider 限制）。
            if (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) {
              res._hesiMetrics.cacheReadTokens += u.prompt_tokens_details.cached_tokens;
            }
            // 实际消耗累计（OpenAI usage: prompt_tokens + completion_tokens），用于服务端汇总日志 actualUsed。
            const _p = u.prompt_tokens ?? 0;
            const _c = u.completion_tokens ?? 0;
            if (_p || _c) res._hesiMetrics.actualUsed += _p + _c;
          }
      } catch {}
    }
  };
  const writeDone = () => {
    if (sinkOnDone) { sinkOnDone(); return; }
    if (res) {
      emitAgentMetrics(res, undefined); // M5 (v0.3.1): 结算广播须早于 [DONE]
      try { res.write('data: [DONE]\n\n'); res.end(); } catch {}
    }
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

          // ── L1 (v0.7.4): 推理流透传 ──
          if (delta.reasoning_content) {
            writeReasoning(delta.reasoning_content);
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
    max_tokens: cwManager.maxOutputTokens(modelName),
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
