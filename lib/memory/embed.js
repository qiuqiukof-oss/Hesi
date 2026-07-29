/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// v0.3.1 B1 — 真向量启用（云端 embedding，默认关）。
// 当 HESI_MEMORY_EMBED=1 时，通过 HESI_EMBED_URL 调用 OpenAI 兼容的
// /v1/embeddings 端点生成向量；任何失败静默返回 null 降级 BM25。
// 无需额外依赖（fetch 原生），零新增体积。
'use strict';

const config = require('./config');

const EMBED_URL = (function () {
  if (process.env.HESI_EMBED_URL) return process.env.HESI_EMBED_URL.replace(/\/+$/, '');
  // 未设则尝试从环境推断（默认 OpenAI）
  if (process.env.OPENAI_API_KEY) return 'https://api.openai.com/v1/embeddings';
  return '';
})();

const EMBED_MODEL = process.env.HESI_EMBED_MODEL || 'text-embedding-3-small';

const API_KEY = process.env.OPENAI_API_KEY || '';

function enabled() {
  return config.EMBED_ENABLED === true;
}

// Returns a numeric vector for text, or null when embedding is disabled / no
// endpoint configured / API fails. Defensive by design — always degrades.
async function embed(text) {
  if (!enabled()) return null;
  if (!EMBED_URL || !API_KEY) return null;
  const input = String(text || '').trim();
  if (!input) return null;
  try {
    const resp = await fetch(EMBED_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return vec;
  } catch {
    return null;
  }
}

// Cosine similarity; returns 0 on length mismatch / zero vectors.
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { enabled, embed, cosine };
