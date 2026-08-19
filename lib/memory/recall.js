/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Cross-session recall: produce the <memory> block injected into the system
// prompt, and the <session_summary> block for the current session. BM25 over
// index-store; optional vector rerank (M7) when embeddings are enabled.
'use strict';

const config = require('./config');
const session = require('./session');
const indexStore = require('./index-store');
const embed = require('./embed');

// Returns { role:'system', content:'<session_summary>…' } or null.
function getSummaryBlock(id) {
  const s = session.load(id);
  if (s && s.summary) {
    return {
      role: 'system',
      content: `<session_summary>\n（本会话早期内容的压缩摘要，仅作背景参考）\n${s.summary}\n</session_summary>`,
    };
  }
  return null;
}

// Returns { role:'system', content:'<memory>…' } or null when nothing matches.
function relevant(query, { topK = config.TOPK_RECALL } = {}) {
  const idx = indexStore.load();
  let docs = indexStore.query(idx, query, { topK });
  // Optional vector rerank (M7): when embeddings are enabled and a query
  // vector is available, sort docs carrying a `vec` by cosine similarity;
  // docs without a vector keep their BM25 order and trail behind.
  if (embed.enabled() && docs.length) {
    const qv = embed.embed(query);
    if (qv) {
      docs = docs.slice().sort((a, b) => {
        const sa = a.vec ? embed.cosine(qv, a.vec) : -1;
        const sb = b.vec ? embed.cosine(qv, b.vec) : -1;
        return sb - sa;
      });
    }
  }
  if (!docs.length) return null;
  const facts = docs.filter((d) => d.type === 'fact');
  const sessions = docs.filter((d) => d.type === 'session');
  const plans = docs.filter((d) => d.type === 'plan');
  const lines = [];
  if (facts.length) {
    lines.push('【长期事实】');
    for (const f of facts) lines.push(`- ${f.text}`);
  }
  if (sessions.length) {
    lines.push('【相关历史会话】');
    for (const s of sessions) lines.push(`- 《${s.title}》: ${s.text}`);
  }
  if (plans.length) {
    lines.push('【已完成 Plan】');
    for (const p of plans) lines.push(`- 《${p.title}》: ${p.text}`);
  }
  if (!lines.length) return null;
  let block = `<memory>\n${  lines.join('\n')  }\n</memory>`;
  if (block.length > config.MAX_MEMORY_BLOCK_CHARS) {
    block = `${block.slice(0, config.MAX_MEMORY_BLOCK_CHARS)  }\n...</memory>`;
  }
  return { role: 'system', content: block };
}

module.exports = { relevant, getSummaryBlock };
