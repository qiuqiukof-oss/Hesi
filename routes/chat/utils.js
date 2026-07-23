// @ts-check
// ============================================================
// Chat Utilities — shared helpers extracted from routes/chat.js
//
// Contains: token estimation, message trimming, URL helpers,
// safe error parsing, and XML tool call parsing.
// ============================================================

// ── LLM 调用容错配置（均可用环境变量覆盖，便于慢模型 / 不稳定网络调优）──
// 单轮模型 HTTP 调用超时（毫秒）：默认 3 分钟。超时即触发重试（见 fetchLlmWithRetry）。
const API_FETCH_TIMEOUT_MS = Number(process.env.HESI_LLM_API_TIMEOUT_MS) || 180_000;
// 流式响应空闲超时（毫秒）：流式读取时若超过该时长无任何新字节，判定断流。
// 默认 300s (5分钟) —— 远端 / 慢模型（如 apihub）在生成途中可能停顿较久，120s 过于激进易误杀。
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.HESI_LLM_STREAM_IDLE_MS) || 300_000;
// 单轮调用失败后的最大重试次数（网络错误 / 5xx / 429 触发），默认 3 次。
const LLM_MAX_RETRIES = Math.max(0, Number(process.env.HESI_LLM_MAX_RETRIES) || 3);
// 重试退避基数（毫秒），指数退避 = base * 2^(attempt-1)。默认 1000ms。
const LLM_RETRY_BASE_MS = Number(process.env.HESI_LLM_RETRY_BASE_MS) || 1_000;
// 流式传输「中途断流」后的最大重试次数（与 fetch 连接重试相互独立）：
// 解决「上游 SSE 在生成途中关闭连接 → 回复被静默腰斩」。默认 5 次（原 3 次偏少，免费 API 常需多次重试）。
const STREAM_MAX_RETRIES = Math.max(0, Number(process.env.HESI_LLM_STREAM_RETRIES) || 5);
// 最终回答（无工具调用）被截断后「断点续传」的最大次数：
// 把已收到的半截内容回灌模型让其「从中断处继续」，多段拼成完整回答。
// 专门破解上游(apihub 等代理)对单次响应的长度/时长上限（单次长文本必被掐断、重试无效时）。默认 8 次（原 5 次不够）。
const CONTINUE_ROUNDS = Math.max(0, Number(process.env.HESI_LLM_CONTINUE_ROUNDS) || 8);
// 单次请求「工具链总时长」硬上限（毫秒）：默认 15 分钟，允许长任务 Agent（如 agent_delegate 最多 300s / "全面自检"类多工具任务）完整跑完并生成总结。可用 HESI_LLM_MAX_DURATION_MS 覆盖。
const MAX_TOTAL_DURATION_MS = Number(process.env.HESI_LLM_MAX_DURATION_MS) || 900_000;

/**
 * 带有限重试的 LLM Fetch 封装 —— 直接解决「网络 / 远程瞬时抖动导致对话被中断」。
 *
 * 重试范围严格限定在「取得响应之前」：即 fetch 失败、或响应非 2xx（仅 429/5xx）。
 * 一旦 response.ok 进入流式解析（parseStreamAndCollectTools），不再整体重来，
 * 以免前端已收到的 token 重复 / 乱序。
 *
 * 触发重试：网络错误（fetch 抛 TypeError，如 ECONNRESET / DNS / 连接被重置）、
 *          调用超时（AbortSignal.timeout → AbortError）、HTTP 429 或 5xx。
 * 不重试（直接抛错）：4xx（非 429，如密钥 / 参数错误），重试无意义。
 *
 * @param {string} url - 目标端点
 * @param {Record<string,string>} headers - 请求头（含鉴权）
 * @param {object} bodyObj - 请求体对象（内部 JSON.stringify）
 * @param {{res?:import('express').Response, retryReasonLabel?:string, isAborted?:()=>boolean}} [opts]
 * @returns {Promise<Response>} 仅在 ok 时返回，由调用方继续流式解析
 */
async function fetchLlmWithRetry(url, headers, bodyObj, opts = {}) {
  const { res, retryReasonLabel = '模型接口', isAborted } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    if (isAborted && isAborted()) {
      throw new Error('client aborted');
    }
    if (attempt > 0) {
      const delay = LLM_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      if (res && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'status', message: `⚠️ ${retryReasonLabel}暂时不可用，第 ${attempt} 次重试（${Math.round(delay)}ms 后）…` })}\n\n`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
    const signal = AbortSignal.timeout(API_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal,
      });
      if (!response.ok) {
        const errBody = await response.text();
        const status = response.status;
        // 429 限流：免费额度耗尽 / 请求过频 —— 非瞬时故障，重试只会挥霍本就有限的额度，
        // 故**不重试**，立即抛出清晰错误，交由上层直接中断并提示用户。
        if (status === 429) {
          throw new Error(`RATE_LIMIT: ${safeApiError(response, errBody, retryReasonLabel)}`);
        }
        // 5xx 瞬时故障 → 重试
        if (status >= 500) {
          lastErr = new Error(safeApiError(response, errBody, retryReasonLabel));
          continue;
        }
        // 其它 4xx（密钥 / 参数错）不重试，直接抛结构化错误
        throw new Error(safeApiError(response, errBody, retryReasonLabel));
      }
      return response;
    } catch (err) {
      // 调用超时（AbortError）→ 重试
      if (err.name === 'AbortError') {
        lastErr = new Error(`${retryReasonLabel} 调用超时（>${API_FETCH_TIMEOUT_MS}ms）`);
        continue;
      }
      // 网络层错误（ECONNRESET / DNS / fetch failed）→ 重试
      if (err instanceof TypeError) {
        lastErr = err;
        continue;
      }
      // 其余（含上面 4xx 抛出的结构化错误）直接上抛，不重试
      throw err;
    }
  }
  throw lastErr || new Error(`${retryReasonLabel} 调用在重试后仍然失败`);
}

/**
 * Estimate token count from message array.
 * 更接近真实：中文 ~1.5 token/字、英文 ~0.3 token/词，统一用 len/1.6 近似。
 * 比旧版 len/2 更贴近中文实际，避免「阈值虚高导致永远不裁剪」。
 * Handles both string content (OpenAI) and content block arrays (Anthropic tool rounds).
 * @param {Array<{role?:string, content?:string|Array<{type:string, text?:string}>}>} msgs
 * @returns {number}
 */
function estimateTokenCount(msgs) {
  const lenOf = (c) => {
    if (typeof c === 'string') return c.length;
    if (Array.isArray(c)) return c.reduce((a, b) => a + (b?.text?.length || 0), 0);
    return 0;
  };
  const totalChars = msgs.reduce((a, m) => a + lenOf(m.content), 0);
  return Math.ceil(totalChars / 1.6);
}

/**
 * Trim conversation history to prevent context overflow.
 * Keeps the system prompt (if present) and the 20 most recent messages.
 * @param {Array<{role?:string, content?:any}>} msgs
 * @returns {Array<{role?:string, content?:any}>}
 */
function trimHistory(msgs) {
  const MAX_HISTORY_TOKENS = 100000;
  if (estimateTokenCount(msgs) <= MAX_HISTORY_TOKENS) return msgs;
  const systemMsg = msgs[0]?.role === 'system' ? msgs[0] : null;
  const tail = msgs.slice(-20);
  return systemMsg ? [systemMsg, ...tail] : tail;
}

/**
 * 封顶 agentic 循环的历史体量，防止「上下文雪球」几何增长撞限流（429）。
 *
 * 根因：stream 循环每轮把完整 currentMessages（含之前所有 tool 结果）原样重发给模型，
 *      多轮后单轮 prompt 体量几何膨胀，免费档 token/分钟上限必被冲爆。
 *
 * 策略（纯字符串操作，零额外 LLM 调用，不破坏 assistant(tool_calls)→tool 消息结构）：
 *   1. 单条 tool 结果超过 maxToolResultChars → 截断为「头+尾+省略说明」（防单条爆量）。
 *   2. 总 token 超 maxTokens 且工具轮数 > keepRecentRounds → 把更早的 tool 结果
 *      压缩为短占位（保留「调过 + 成功」信号），仅保留最近 keepRecentRounds 轮完整。
 *
 * @param {Array<{role?:string, content?:any, tool_calls?:Array, tool_call_id?:string, name?:string}>} messages
 * @param {{keepRecentRounds?:number, maxTokens?:number, maxToolResultChars?:number}} [opts]
 * @returns {Array} 原地修改 messages（tool 结果 content 被压缩/截断）后返回同一引用
 */
function capToolRounds(messages, opts = {}) {
  const keepRecentRounds = opts.keepRecentRounds ?? 6;
  const maxTokens = opts.maxTokens ?? 60000;
  const maxToolResultChars = opts.maxToolResultChars ?? 6000;

  // ── 1) 单条 tool 结果硬截断（无论新旧，防单条爆量）──
  for (const m of messages) {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxToolResultChars) {
      const head = m.content.slice(0, Math.floor(maxToolResultChars * 0.7));
      const tail = m.content.slice(-Math.floor(maxToolResultChars * 0.2));
      m.content = `${head}\n…[中间已省略 ${m.content.length - maxToolResultChars} 字符]…\n${tail}\n[注：单条工具结果超过 ${maxToolResultChars} 字符，已截断以节约上下文]`;
    }
  }

  // ── 2) 总 token 超预算 → 压缩更早的 tool 轮 ──
  if (estimateTokenCount(messages) <= maxTokens) return messages;

  // 用 tool_call_id → 工具名 映射，给压缩占位带上工具名
  const nameByToolId = {};
  const rounds = []; // 每个工具轮 = { assistantIdx, toolIdxs: [] }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      rounds.push({ assistantIdx: i, toolIdxs: [] });
      for (const tc of m.tool_calls) nameByToolId[tc.id] = tc?.function?.name || '';
    } else if (m.role === 'tool' && rounds.length) {
      rounds[rounds.length - 1].toolIdxs.push(i);
    }
  }

  if (rounds.length <= keepRecentRounds) return messages; // 轮数不多，无需压缩旧轮

  const compressCount = rounds.length - keepRecentRounds;
  for (let r = 0; r < compressCount; r++) {
    const round = rounds[r];
    for (const ti of round.toolIdxs) {
      const tm = messages[ti];
      if (tm.role !== 'tool') continue;
      const name = tm.name || nameByToolId[tm.tool_call_id] || 'unknown';
      const origLen = typeof tm.content === 'string' ? tm.content.length : JSON.stringify(tm.content || '').length;
      tm.content = `[工具结果已压缩省略 — ${name} 已成功执行，原返回约 ${origLen} 字符，此处不重发以节约上下文]`;
    }
  }
  return messages;
}

/**
 * 截断工具结果用于前端预览（与上下文裁剪无关）。
 * 仅用于 SSE 广播 tool_call_end 给浏览器渲染卡片预览，
 * 不影响推给模型的 currentMessages 内容（那一份在 stream 循环里由 capToolRounds 独立处理）。
 * @param {string|undefined} s
 * @param {number} [maxChars=1000]
 * @returns {string|undefined}
 */
function capToolResultPreview(s, maxChars = 1000) {
  if (typeof s !== 'string') return undefined;
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)  }\n…[结果预览已截断，原长 ${s.length} 字符]`;
}

/**
 * Safely parse an API error response, redacting any sensitive data.
 * Returns a safe error message without exposing API keys or request bodies.
 * @param {import('express').Response} resp - The fetch Response object
 * @param {string} body - Raw response body text
 * @param {string} label - Provider label (e.g. 'OpenAI API')
 * @returns {string}
 */
function safeApiError(resp, body, label) {
  try {
    const parsed = JSON.parse(body);
    // OpenAI format: { error: { message: "..." } }
    if (parsed.error?.message) return `${label} error: ${parsed.error.message}`;
    // Anthropic format: { error: { message: "..." } }
    // Generic format: { message: "..." }
    if (parsed.message) return `${label} error: ${parsed.message}`;
  } catch { /* non-JSON body */ }
  return `${label} error (HTTP ${resp.status})`;
}

/**
 * Parse a <tool_call> XML string into a tool call object.
 * Supports formats:
 *    <tool_call><function=NAME><parameter=KEY>VAL</parameter></function></tool_call>
 *    <tool_call><function>NAME</function><parameter name="KEY">VAL</parameter></tool_call>
 * @param {string} xml
 * @returns {{ id: string, name: string, arguments: string } | null}
 */
function parseTextToolCall(xml) {
  // Extract function name: <function=NAME> or <function>NAME</function>
  let name = '';
  const funcAttrMatch = xml.match(/<function\s*=\s*([^\s>\/]+)/);
  const funcTagMatch = xml.match(/<function>([^<]+)<\/function>/);
  if (funcAttrMatch) name = funcAttrMatch[1].trim();
  else if (funcTagMatch) name = funcTagMatch[1].trim();
  if (!name) return null;

  // Extract parameters: <parameter=KEY>VAL</parameter> or <parameter name="KEY">VAL</parameter>
  const params = {};
  const paramAttrRe = /<parameter\s*=\s*([^>]+?)>(.*?)<\/parameter\s*>/g;
  const paramNameRe = /<parameter\s+name\s*=\s*["']([^"']+)["']>(.*?)<\/parameter\s*>/g;
  let m;
  while ((m = paramAttrRe.exec(xml)) !== null) params[m[1].trim()] = m[2].trim();
  while ((m = paramNameRe.exec(xml)) !== null) params[m[1].trim()] = m[2].trim();

  return { id: `txtc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, arguments: JSON.stringify(params) };
}

/**
 * Normalize a base URL for API calls.
 * Supports hostnames, IP addresses, localhost, and path-only inputs.
 * @param {string} url
 * @returns {string}
 */
function normalizeBaseUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    return `http://localhost:11434${  url}`;
  }
  const isHostname = (
    /^localhost(?::\d+)?(\/|$)/i.test(url) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(\/|$)/.test(url) ||
    /^[\w-]+(?:\.\w{2,})+(?::\d+)?(\/|$)/.test(url) ||
    /^[\w.-]+:\d+(\/|$)/.test(url)
  );
  if (isHostname) {
    return `http://${  url}`;
  }
  return `http://localhost:11434/${  url}`;
}

/**
 * Build a full API URL from a base URL, default URL, and endpoint path.
 * @param {string} baseUrl - User-provided base URL (may be null/undefined)
 * @param {string} defaultUrl - Default API base (e.g. 'https://api.openai.com/v1')
 * @param {string} endpoint - Endpoint path (e.g. '/chat/completions')
 * @returns {string}
 */
function buildApiUrl(baseUrl, defaultUrl, endpoint) {
  const normalized = normalizeBaseUrl(baseUrl) || defaultUrl;
  const clean = normalized.replace(/\/+$/, '');
  if (/\/v1(\/|$)/i.test(clean)) {
    return clean + endpoint;
  }
  return `${clean  }/v1${  endpoint}`;
}

/**
 * Get the internal API base URL for Hesi.
 * @returns {string}
 */
function getApiBase() {
  return `http://127.0.0.1:${process.env.PORT || 3001}/api`;
}

module.exports = {
  estimateTokenCount,
  trimHistory,
  capToolRounds,
  capToolResultPreview,
  safeApiError,
  parseTextToolCall,
  normalizeBaseUrl,
  buildApiUrl,
  getApiBase,
  API_FETCH_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  LLM_MAX_RETRIES,
  LLM_RETRY_BASE_MS,
  STREAM_MAX_RETRIES,
  CONTINUE_ROUNDS,
  MAX_TOTAL_DURATION_MS,
  fetchLlmWithRetry,
};
