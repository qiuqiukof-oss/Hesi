/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Bing Search Provider
// 需要环境变量 BING_SEARCH_API_KEY
// ============================================================

const PROVIDER_NAME = 'bing';

function isAvailable() {
  return !!process.env.BING_SEARCH_API_KEY;
}

/**
 * @param {string} query
 * @param {number} count (1-20)
 * @returns {Promise<{results:Array, total:string}>}
 */
async function search(query, count) {
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}&mkt=zh-CN`;
  const resp = await fetch(url, {
    headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SEARCH_API_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`Bing API returned HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const results = (data.webPages?.value || []).map((r, i) => ({
    index: i + 1,
    title: r.name,
    url: r.url,
    snippet: r.snippet || '',
  }));
  return {
    provider: PROVIDER_NAME,
    results,
    total: data.webPages?.totalEstimatedMatches || results.length,
  };
}

module.exports = { name: PROVIDER_NAME, isAvailable, search };
