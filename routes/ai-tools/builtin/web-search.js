/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tool: web_search
//
// 搜索互联网，支持多 provider 链式回退。
// 使用 LRU 缓存去重，TokenBucket 限流。
// ============================================================

const { search } = require('../providers');

/**
 * 在当前 registry 上注册 web_search 工具。
 * @param {import('../registry').ToolRegistry} registry
 * @param {object} deps
 * @param {import('../cache').LRUCache} deps.cache
 * @param {import('../rate-limit').TokenBucket} deps.rateLimiter
 */
function register(registry, deps) {
  const { cache, rateLimiter } = deps;

  registry.register({
    name: 'web_search',
    description: '搜索互联网。返回搜索结果列表（标题+链接+摘要）。支持 Bing API（优先）、Tavily、DuckDuckGo 多引擎自动回退。中文：搜索网页',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，支持中文',
        },
        count: {
          type: 'number',
          description: '返回结果数量，默认 8，最大 20',
          default: 8,
        },
        provider: {
          type: 'string',
          enum: ['auto', 'bing', 'duckduckgo', 'tavily'],
          description: '指定搜索提供商，默认 auto（自动选择）',
          default: 'auto',
        },
      },
      required: ['query'],
    },
    execute: async (args, broadcastFn, requestId) => {
      const query = (args.query || '').trim();
      const count = Math.min(args.count || 8, 20);
      if (!query) return 'Error: query is required';

      // 限流检查：web_search 消耗 2 个 token（按 requestId 隔离）
      // 注意 TokenBucketMap.tryConsume(key, cost) 的参数顺序：key 在前、cost 在后
      if (!rateLimiter.tryConsume(requestId, 2)) {
        return 'Error: 请求过于频繁，请稍后再试（已触发防失控安全阀，通常意味着短时间内调用了异常多次）';
      }

      // 缓存键
      const cacheKey = `web_search:${query}:${count}:${args.provider || 'auto'}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      try {
        const options = {};
        if (args.provider && args.provider !== 'auto') {
          options.prefer = [args.provider];
        }

        const result = await search(query, count, options);

        if (result.error) {
          return `Search error: ${result.error}`;
        }

        const providerLabel = result.provider === 'duckduckgo' ? 'DuckDuckGo' :
          result.provider === 'bing' ? 'Bing' :
          result.provider === 'tavily' ? 'Tavily' : result.provider;

        let output = `Web Search Results for "${query}" (${providerLabel}, 约 ${result.total} 条结果):\n\n`;
        for (const r of result.results) {
          if (r.index === 0) {
            // AI 摘要（来自 Tavily）
            output += `📝 ${r.snippet}\n\n`;
            continue;
          }
          output += `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}\n\n`;
        }
        if (result.results.length === 0) {
          output += '(无结果)';
        }

        // 写入缓存（TTL 5 分钟）
        cache.set(cacheKey, output);
        return output;
      } catch (err) {
        return `Search error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
