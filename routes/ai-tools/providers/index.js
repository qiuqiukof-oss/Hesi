/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Search Provider Chain — 链式搜索
//
// 按优先级依次尝试所有可用的搜索 provider。
// 第一个成功返回结果，所有失败则返回错误汇总。
// ============================================================

const bing = require('./bing');
const ddg = require('./ddg');
const tavily = require('./tavily');

// 优先级链：Bing (有 key) → Tavily keyless → DuckDuckGo (fallback)
const PROVIDER_CHAIN = [
  bing,
  tavily,
  ddg,
];

/**
 * 按优先级链搜索，返回第一个成功的结果。
 * @param {string} query
 * @param {number} count
 * @param {object} [options]
 * @param {string[]} [options.prefer] - 优先使用的 provider 名称列表
 * @returns {Promise<{provider:string, results:Array, total:number, error?:string}>}
 */
async function search(query, count = 8, options = {}) {
  const errors = [];

  // 如果指定了优先 provider，先尝试它们
  if (options.prefer && options.prefer.length > 0) {
    const preferChain = options.prefer
      .map(name => PROVIDER_CHAIN.find(p => p.name === name))
      .filter(Boolean);
    for (const provider of preferChain) {
      if (!provider.isAvailable()) continue;
      try {
        return await provider.search(query, count);
      } catch (e) {
        errors.push({ provider: provider.name, error: e.message });
      }
    }
  }

  // 按默认优先级尝试
  for (const provider of PROVIDER_CHAIN) {
    if (!provider.isAvailable()) continue;
    // 如果在 prefer 中已尝试过，跳过
    if (options.prefer?.includes(provider.name)) continue;
    try {
      return await provider.search(query, count);
    } catch (e) {
      errors.push({ provider: provider.name, error: e.message });
    }
  }

  // 所有 provider 都失败
  return {
    provider: 'none',
    results: [],
    total: 0,
    error: `All search providers failed: ${errors.map(e => `${e.provider} (${e.error})`).join('; ')}`,
  };
}

/** 返回所有可用 provider 的名称列表 */
function getAvailableProviders() {
  return PROVIDER_CHAIN.filter(p => p.isAvailable()).map(p => p.name);
}

module.exports = { search, getAvailableProviders, PROVIDER_CHAIN };
