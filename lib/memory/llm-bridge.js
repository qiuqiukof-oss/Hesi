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

// Minimal URL joiner (avoids importing routes/chat/utils — keeps lib isolated).
function buildApiUrl(baseUrl, defaultBase, path) {
  const base = (baseUrl || defaultBase || '').replace(/\/+$/, '');
  return base + path;
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
  '从对话内容中抽取值得长期记住的事实，每条一行，以“- ”开头。'
  + '只抽取稳定、跨会话有用的信息（用户偏好、项目事实、决策、身份），不要抽取临时闲聊。'
  + '最多 20 条。只输出事实列表，不要附加解释。';

async function _realComplete(system, user, { apiKey, provider, model, baseUrl } = {}) {
  const key = apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  if (!key) return null; // no key → caller degrades gracefully
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
      if (!resp.ok) return null;
      const data = await resp.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return text || null;
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
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch {
    return null; // network/parse error → degrade
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

module.exports = { setLLMCaller, complete, summarize, extractFacts };
