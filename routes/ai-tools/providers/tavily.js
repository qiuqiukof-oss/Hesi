/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Tavily Search Provider (Keyless Mode)
//
// Tavily 提供 keyless 模式（无需 API Key），但可能有频率限制。
// 也支持使用 TAVILY_API_KEY 环境变量获得更高配额。
// 文档: https://docs.tavily.com
// ============================================================

const PROVIDER_NAME = 'tavily';
const API_URL = 'https://api.tavily.com/search';

function isAvailable() {
  return true; // keyless mode 无需 key
}

/**
 * @param {string} query
 * @param {number} count (1-20)
 * @returns {Promise<{results:Array}>}
 */
async function search(query, count) {
  const apiKey = process.env.TAVILY_API_KEY || '';

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? {} : { 'X-API-Key': 'keyless' }),
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(count, 20),
      ...(apiKey ? { api_key: apiKey } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Tavily returned HTTP ${resp.status}: ${errText.slice(0, 100)}`);
  }

  const data = await resp.json();
  const results = (data.results || []).map((r, i) => ({
    index: i + 1,
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || r.snippet || '',
  }));

  // 如果有 AI 生成的答案，作为首个结果包含
  if (data.answer) {
    results.unshift({
      index: 0,
      title: 'AI 摘要',
      url: '',
      snippet: data.answer,
    });
  }

  return {
    provider: PROVIDER_NAME,
    results,
    total: results.length,
  };
}

module.exports = { name: PROVIDER_NAME, isAvailable, search };
