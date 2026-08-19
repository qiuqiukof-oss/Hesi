/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Lightweight retrieval index with a zero-dependency BM25 scorer.
// Documents are sessions (title + summary) and long-term facts. Chinese text
// is tokenized into unigrams + bigrams so retrieval works without a word
// segmenter. Optional vector reranking (embed.js) slots in at query time (M7).
'use strict';

const config = require('./config');
const storage = require('./storage');

// Tokenize: latin words + CJK unigrams/bigrams. Keeps Chinese retrieval usable.
function tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const tokens = [];
  const latin = lower.match(/[a-z0-9]+/g);
  if (latin) tokens.push(...latin);
  const cjk = lower.match(/[一-鿿]/g);
  if (cjk) {
    tokens.push(...cjk);
    for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

function buildDoc({ ref, type, title, text, vec }) {
  const full = `${title || ''}\n${text || ''}`;
  const toks = tokenize(full);
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  const doc = { ref, type, title: title || '', text: text || '', tokens: toks.length, tf: Object.fromEntries(tf) };
  if (Array.isArray(vec)) doc.vec = vec; // optional; present only when embedding is enabled
  return doc;
}

function load() {
  return storage.readJSON(config.INDEX_FILE, { docs: [] });
}

function save(idx) {
  storage.writeJSON(config.INDEX_FILE, idx);
}

// Merge or insert one document by ref.
function upsert(doc) {
  const idx = load();
  const i = idx.docs.findIndex((d) => d.ref === doc.ref);
  if (i >= 0) idx.docs[i] = doc; else idx.docs.push(doc);
  save(idx);
  return idx;
}

function remove(ref) {
  const idx = load();
  idx.docs = idx.docs.filter((d) => d.ref !== ref);
  save(idx);
  return idx;
}

// BM25 over the token-frequency map of each doc.
function query(index, q, { topK = config.TOPK_RECALL } = {}) {
  const docs = index.docs || [];
  if (!docs.length) return [];
  const qTokens = tokenize(q);
  if (!qTokens.length) return [];
  const N = docs.length;
  const df = new Map();
  for (const d of docs) {
    for (const t of Object.keys(d.tf)) {
      if (qTokens.includes(t)) df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const avgdl = N ? docs.reduce((s, d) => s + (d.tokens || 0), 0) / N : 1;
  const k1 = 1.5;
  const b = 0.75;
  const scored = docs.map((d) => {
    let score = 0;
    const dl = d.tokens || 0;
    for (const t of qTokens) {
      const f = d.tf[t];
      if (!f) continue;
      const n_t = df.get(t) || 0;
      const idf = Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl)));
    }
    return { doc: d, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map((x) => x.doc);
}

module.exports = { tokenize, buildDoc, load, save, upsert, remove, query };
