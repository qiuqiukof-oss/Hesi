/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unified LLM bridge for memory tasks (summarization, fact extraction).
// Defaults to a real OpenAI-compatible (and Anthropic) fetch call. Tests inject
// a fake caller via setLLMCaller so compaction/profile can be verified offline.
// Kept dependency-free from routes/* to preserve the subsystem's isolation.
'use strict';

let _fake = null;
function setLLMCaller(fn) { _fake = fn; }

// 复用共享 URL 构建器（自动补 /v1、归一化 baseUrl），与 chat 子系统保持一致，
// 避免本地 LLM 打到错误端点（/chat/completions 而非 /v1/chat/completions）。
const { buildApiUrl } = require('../llm/url');

// ── LLM 调用超时与重试配置（与 routes/chat/utils.js 对齐，可用同一环境变量调优）──
// 单轮模型 HTTP 调用超时（毫秒）：默认 5 分钟（本地模型生成 Plan 等长输出常需 2-5 分钟）。
// 可用 HESI_LLM_API_TIMEOUT_MS 覆盖（与聊天通道一致）。
const LLM_BRIDGE_TIMEOUT_MS = Number(process.env.HESI_LLM_API_TIMEOUT_MS) || 300_000;
// 调用层（fetch 超时 / 网络抖动）最大重试次数，默认 2 次 + 指数退避（1s→2s）。
const LLM_BRIDGE_MAX_RETRIES = Math.max(0, Number(process.env.HESI_LLM_BRIDGE_RETRIES) || 2);
const LLM_BRIDGE_RETRY_BASE_MS = 1000;

/**
 * 结构化 LLM 调用错误（区分"没 key"、"API 报错"、"网络异常"）。
 * code: 'NO_API_KEY' | 'API_ERROR' | 'NETWORK_ERROR'
 */
class LLMError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details; // { status?, statusText?, url?, body?, original? }
    Error.captureStackTrace?.(this, LLMError);
  }
}

const SUMMARY_SYSTEM =
  '你是一个对话压缩器。请将用户提供的对话内容压缩成一段紧凑的结构化摘要，'
  + '必须保留：做出的决策、关键事实、用户偏好、未决事项、关键代码路径/文件。'
  // v0.3.1 A4：编码/办公上下文保留规则
  + '涉及文件操作时保留：确切路径与行号范围、已做修改的性质（增/删/改/重命名）。'
  + '涉及终端命令时保留：命令与成功/失败结论。'
  + '涉及文档/数据时保留：文档路径、章节/表格结构与核心结论。'
  + '使用与用户相同的语言。只输出摘要本身，不要附加解释。';

const FACT_SYSTEM =
  '从对话内容中抽取值得长期记住的事实，每条一行，以"- "开头。'
  + '只抽取稳定、跨会话有用的信息（用户偏好、项目事实、决策、身份），不要抽取临时闲聊。'
  + '最多 20 条。只输出事实列表，不要附加解释。';

/**
 * 从 OpenAI 兼容 API 响应中提取文本内容。
 * 兼容多种本地 LLM 服务端返回格式：
 * - 标准格式：choices[0].message.content (string)
 * - 内容块数组格式：choices[0].message.content (array of {type, text})
 * - 推理/思考模型：content 数组含 {type:"thinking", content:"..."} 或类似非标准块
 * - 旧版/简化格式：choices[0].text
 * - Anthropic-in-OpenAI-wrap：content[].text
 *
 * @param {object} data 解析后的 JSON 响应体
 * @returns {string|null} 提取到的文本，无法提取返回 null
 */
function _extractOpenAIContent(data) {
  if (!data) return null;
  // 路径 1：标准 OpenAI 格式 choices[0].message.content (string)
  const msg = data.choices?.[0]?.message;
  if (msg) {
    if (typeof msg.content === 'string' && msg.content.trim()) return msg.content.trim();

    // 路径 1b：推理模型的 reasoning_content 字段（部分 OpenAI 兼容服务端将完整回答放在此处）
    // 常见于：Qwen3 / DeepSeek-R1 通过 vLLM / llama.cpp 等服务端转发时
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim()) {
      console.log('[LLMBridge] 从 reasoning_content 提取内容（content 为空/非字符串）');
      return msg.reasoning_content.trim();
    }

    // 路径 2：content 是内容块数组（部分本地 LLM / 多模态 / 推理模型）
    if (Array.isArray(msg.content)) {
      // 2a：标准 text 块
      const textParts = msg.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text);
      if (textParts.length > 0) return textParts.join('').trim();

      // 2b：推理/思考块（Qwen3 / DeepSeek-R1 等本地服务端常把回答放在 thinking/reasoning 块中）
      // 常见字段名组合：{type:"thinking", content:"..."} | {type:"reasoning", content:"..."} | {type:"thought", text:"..."}
      const thinkingParts = msg.content
        .filter((b) => {
          const t = (b.type || '').toLowerCase();
          return ['thinking', 'reasoning', 'thought', 'reasoning_content'].includes(t);
        })
        .map((b) => b.content || b.text || b.reasoning_content || '');
      if (thinkingParts.length > 0) return thinkingParts.join('').trim();

      // 2c：兜底——数组中有任何带文本值的块都尝试拼接（处理未知 type）
      const anyParts = msg.content
        .filter((b) => typeof b === 'object' && b !== null)
        .map((b) => b.text || b.content || b.reasoning_content || Object.values(b).find(v => typeof v === 'string' && v.trim()) || '')
        .filter(Boolean);
      if (anyParts.length > 0) return anyParts.join('').trim();

      // 全部路径失败 → 记录诊断信息
      console.warn('[LLMBridge] content 数组无法提取文本，块结构:', JSON.stringify(msg.content).slice(0, 500));
    } else if (msg.content == null) {
      console.warn('[LLMBridge] msg.content 为 null/undefined，message 键:', Object.keys(msg).join(','));
    } else {
      console.warn('[LLMBridge] msg.content 类型异常:', typeof msg.content, '值:', String(msg.content).slice(0, 200));
    }
  }

  // 路径 3：旧版 / 简化格式 choices[0].text（Ollama 早期版本、某些兼容层）
  if (typeof data.choices?.[0]?.text === 'string' && data.choices[0].text.trim()) {
    return data.choices[0].text.trim();
  }

  // 路径 4：顶层 content 数组（Anthropic 格式被套在 OpenAI 外壳）
  if (Array.isArray(data.content)) {
    const parts = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    if (parts.length > 0) return parts.join('').trim();
  }

  // 路径 5：output / response 字段（某些非标准兼容实现）
  if (typeof data.output === 'string' && data.output.trim()) return data.output.trim();
  if (typeof data.response === 'string' && data.response.trim()) return data.response.trim();

  // ── 最终诊断：所有路径均失败时记录完整响应结构（截断防日志爆炸）──
  console.warn('[LLMBridge] _extractOpenAIContent 所有路径失败。响应顶层键:', Object.keys(data || {}).join(','));
  if (data.choices?.[0]) {
    const c0 = data.choices[0];
    console.warn('[LLMBridge] choices[0] 键:', Object.keys(c0).join(','));
    if (c0.message) {
      console.warn('[LLMBridge] message 键:', Object.keys(c0.message).join(','),
        '| content 类型:', typeof c0.message.content,
        '| content 值(前300):', JSON.stringify(c0.message.content).slice(0, 300));
    }
  }
  return null;
}

/**
 * 从 Anthropic API 响应中提取文本内容。
 * @param {object} data
 * @returns {string|null}
 */
function _extractAnthropicContent(data) {
  if (!data) return null;
  if (Array.isArray(data.content)) {
    const parts = data.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text);
    if (parts.length > 0) return parts.join('').trim();
  }
  return null;
}

/**
 * 带有限重试的 LLM fetch 封装（llm-bridge 内部专用）。
 * 仅在「取得响应之前」重试：fetch 超时（AbortError）、网络层错误（TypeError，如 ECONNRESET / DNS）。
 * 一旦拿到响应（无论 2xx / 4xx / 5xx），由调用方按状态码处理，不再重试。
 * 设计对齐 routes/chat/utils.js#fetchLlmWithRetry，但保持 llm-bridge 子系统零依赖。
 *
 * @param {string} url
 * @param {object} init fetch 选项（不含 signal）
 * @param {number} timeoutMs 单次超时毫秒
 * @returns {Promise<Response>}
 */
async function _fetchWithRetry(url, init, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt <= LLM_BRIDGE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = LLM_BRIDGE_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(`[LLMBridge] 第 ${attempt} 次重试（${Math.round(delay)}ms 后）— ${url.slice(0, 60)}`);
      await new Promise((r) => { setTimeout(r, delay); });
    }
    try {
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      return resp; // 拿到响应即返回，状态码由调用方判定
    } catch (err) {
      if (err.name === 'AbortError') {
        lastErr = new Error(`LLM 调用超时（>${timeoutMs}ms），已重试 ${attempt} 次`);
        continue;
      }
      if (err instanceof TypeError) {
        // 网络层错误（连接被重置 / DNS / 解析失败）
        lastErr = err;
        continue;
      }
      // 其它异常（含调用方在 init 内抛出的）直接上抛，不重试
      throw err;
    }
  }
  throw lastErr || new Error('LLM 调用在重试后仍失败');
}

async function _realComplete(system, user, { apiKey, provider, model, baseUrl } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  if (!key) throw new LLMError('未提供 API Key（前端未填写或存储读取失败）', 'NO_API_KEY');
  const prov = provider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
  const modelName = model || (prov === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');
  try {
    if (prov === 'anthropic') {
      const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');
      const resp = await _fetchWithRetry(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelName, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
      }, LLM_BRIDGE_TIMEOUT_MS);
      if (!resp.ok) {
        let errBody = '';
        try { errBody = await resp.text(); } catch { /* ignore */ }
        throw new LLMError(
          `Anthropic API 请求失败 (HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''})`,
          'API_ERROR',
          { status: resp.status, statusText: resp.statusText, url, body: errBody.slice(0, 300) }
        );
      }
      const data = await resp.json();
      const text = _extractAnthropicContent(data);
      if (!text) {
        console.warn('[LLMBridge] Anthropic API 返回空内容，原始响应:', JSON.stringify(data).slice(0, 500));
        throw new LLMError(
          '模型返回空响应。请检查模型名称是否正确，或尝试切换模型。',
          'API_ERROR',
          { status: resp.status, url, body: JSON.stringify(data).slice(0, 300) }
        );
      }
      return text;
    }
    const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');
    const resp = await _fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    }, LLM_BRIDGE_TIMEOUT_MS);
    if (!resp.ok) {
      let errBody = '';
      try { errBody = await resp.text(); } catch { /* ignore */ }
        throw new LLMError(
          `OpenAI API 请求失败 (HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''})`,
        'API_ERROR',
        { status: resp.status, statusText: resp.statusText, url, body: errBody.slice(0, 300) }
      );
    }
    const data = await resp.json();
    const text = _extractOpenAIContent(data);
    if (!text) {
      // 诊断：打印原始响应（帮助定位本地 LLM 返回格式问题）
      const msg = data.choices?.[0]?.message;
      const contentType = msg?.content == null ? 'null'
        : typeof msg?.content === 'string' ? `string(${msg.content.length}字符)`
        : Array.isArray(msg?.content) ? `array[${msg.content.length}块]${msg.content.length > 0 ? ` type=${msg.content[0].type}` : ''}`
        : typeof msg?.content;
      console.warn('[LLMBridge] OpenAI 兼容 API 返回空内容，原始响应:', JSON.stringify(data).slice(0, 800));
      throw new LLMError(
        `模型返回空响应（可能原因：模型名称不正确、模型不支持当前参数、或响应格式非标准）。服务端返回 content 类型: ${contentType}。请检查：①模型名称是否与本地 LLM 列表一致 ②AI 助手聊天是否能正常回复同一模型`,
        'API_ERROR',
        { status: resp.status, url, body: JSON.stringify(data).slice(0, 500), contentType }
      );
    }
    return text;
  } catch (e) {
    if (e instanceof LLMError) throw e; // re-throw our own structured errors
    throw new LLMError(`LLM 网络或解析异常: ${e.message}`, 'NETWORK_ERROR', { original: e.message });
  }
}

// Single entry used by compaction/profile. Honors the injected fake for tests.
async function complete(system, user, opts) {
  if (_fake) return _fake(system, user, opts);
  return _realComplete(system, user, opts);
}

async function summarize(oldSegText, prevSummary, opts) {
  const user = prevSummary
    ? `已有摘要：\n${prevSummary}\n\n需要合并压缩的新内容：\n${oldSegText}\n\n请输出合并后的单一紧凑摘要。`
    : `请将以下对话内容压缩为单一紧凑摘要：\n${oldSegText}`;
  return complete(SUMMARY_SYSTEM, user, opts);
}

async function extractFacts(text, opts) {
  const out = await complete(FACT_SYSTEM, text, opts);
  if (!out) return [];
  return out
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

module.exports = { setLLMCaller, complete, summarize, extractFacts, LLMError };
