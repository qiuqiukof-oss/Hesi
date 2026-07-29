/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// DuckDuckGo Search Provider
// 无需 API Key，通过解析 HTML 获取结果。
// 注意：不保证稳定性，大量请求可能触发验证码。
// ============================================================

const PROVIDER_NAME = 'duckduckgo';

function isAvailable() {
  return true; // 无需 key，始终可用
}

/**
 * @param {string} query
 * @param {number} count (1-20)
 * @returns {Promise<{results:Array}>}
 */
async function search(query, count) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${resp.status}`);
  }

  const html = await resp.text();

  // 解析 DuckDuckGo HTML 结果
  const resultRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const titles = [];
  let match;
  while ((match = resultRe.exec(html)) !== null) {
    titles.push({
      url: match[1],
      title: match[2].replace(/<[^>]+>/g, '').trim(),
    });
  }

  const snippets = [];
  while ((match = snippetRe.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  const results = [];
  for (let i = 0; i < Math.min(count, titles.length); i++) {
    const t = titles[i];
    let url = t.url;
    // DuckDuckGo redirect URL 解码
    if (url.includes('uddg=')) {
      try {
        url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
      } catch { /* keep original */ }
    }
    results.push({
      index: i + 1,
      title: t.title,
      url,
      snippet: snippets[i] || '',
    });
  }

  return {
    provider: PROVIDER_NAME,
    results,
    total: results.length,
  };
}

module.exports = { name: PROVIDER_NAME, isAvailable, search };
