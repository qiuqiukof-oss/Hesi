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
    // 路径 2：content 是内容块数组（部分本地 LLM / 某些多模态模型）
    if (Array.isArray(msg.content)) {
      const parts = msg.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text);
      if (parts.length > 0) return parts.join('').trim();
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

async function _realComplete(system, user, { apiKey, provider, model, baseUrl } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  if (!key) throw new LLMError('未提供 API Key（前端未填写或存储读取失败）', 'NO_API_KEY');
  const prov = provider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
  const modelName = model || (prov === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');
  try {
    if (prov === 'anthropic') {
      const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: modelName, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(120000),
      });
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
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(120000),
    });
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
      console.warn('[LLMBridge] OpenAI 兼容 API 返回空内容，原始响应:', JSON.stringify(data).slice(0, 500));
      throw new LLMError(
        '模型返回空响应（可能原因：模型名称不正确、模型不支持当前参数、或响应格式非标准）。'
          + '请检查：①模型名称是否与本地 LLM 列表一致 ②AI 助手聊天是否能正常回复同一模型',
        'API_ERROR',
        { status: resp.status, url, body: JSON.stringify(data).slice(0, 300) }
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
