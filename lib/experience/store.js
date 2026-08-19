/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// M3 (v0.3.1): 经验知识库（Reflexion-lite）。
// 记录工具失败 + 对应修复，下次同类失败时把历史经验注入给 LLM，减少重试、提成功率。
// 落盘 data/memory/experience.json；纯本地、零额外 LLM 调用、零新依赖。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../memory/config');
const embed = require('../memory/embed');

const EXP_FILE = path.join(path.dirname(config.SESSIONS_DIR), 'experience.json');
// Cap is tunable (HESI_EXP_MAX) so a coding-heavy agent that generates many
// experiences doesn't grow unbounded; eviction prefers low-hitCount entries.
const MAX_ENTRIES = parseInt(process.env.HESI_EXP_MAX, 10) || 2000;

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(EXP_FILE, 'utf8'));
  } catch {
    _cache = { entries: [] };
  }
  if (!Array.isArray(_cache.entries)) _cache.entries = [];
  return _cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(EXP_FILE), { recursive: true });
    fs.writeFileSync(EXP_FILE, JSON.stringify(_cache));
  } catch (e) {
    // 降级静默：经验库是可选增强，绝不影响主流程
    console.warn('[experience] persist skipped:', e && e.message);
  }
}

function digest(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, 12);
}

function tokenize(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9一-龥]+/).filter(Boolean);
}

function recordFailure(tool, args, error) {
  if (process.env.HESI_EXPERIENCE === '0') return;
  const data = load();
  const entry = {
    tool,
    argsDigest: digest(JSON.stringify(args || {})),
    error: String(error || '').slice(0, 300),
    ts: Date.now(),
    hitCount: 0,
  };
  // v0.3.1 B1：embed 启用时记录错误向量（供 findSimilar 余弦重排）
  if (embed.enabled()) {
    embed.embed(entry.error).then((v) => {
      if (v) { entry.vec = v; persist(); }
    }).catch(() => {});
  }
  data.entries.push(entry);
  enforceCap(data);
  persist();
}

/**
 * Keep the store bounded. When over MAX_ENTRIES, evict the lowest-value
 * entries first: sort by hitCount asc (ties → oldest first) and keep the tail.
 * Entries that have actually helped (hitCount > 0) survive a full cache.
 */
function enforceCap(data) {
  if (data.entries.length <= MAX_ENTRIES) return;
  data.entries.sort(
    (a, b) => (a.hitCount || 0) - (b.hitCount || 0) || (a.ts || 0) - (b.ts || 0)
  );
  data.entries = data.entries.slice(-MAX_ENTRIES);
}

function recordFix(tool, errorSig, fixDesc) {
  if (process.env.HESI_EXPERIENCE === '0') return;
  const data = load();
  // 把修复挂到该工具最近一次尚未记录修复的失败上
  for (let i = data.entries.length - 1; i >= 0; i--) {
    if (data.entries[i].tool === tool && !data.entries[i].fix) {
      data.entries[i].fix = {
        errorSig: String(errorSig || '').slice(0, 200),
        fixDesc: String(fixDesc || '').slice(0, 200),
        ts: Date.now(),
      };
      break;
    }
  }
  persist();
}

function findSimilar(tool, error, topK = 2) {
  if (process.env.HESI_EXPERIENCE === '0') return [];
  const data = load();
  const errWords = tokenize(error);
  if (!errWords.length) return [];
  const scored = [];
  for (const e of data.entries) {
    if (e.tool !== tool || !e.fix) continue;
    const eWords = tokenize(e.error);
    let overlap = 0;
    for (const w of errWords) if (eWords.includes(w)) overlap++;
    if (overlap > 0) scored.push({ entry: e, score: overlap });
  }
  scored.sort((a, b) => b.score - a.score);
  // v0.3.1 B1：embed 启用且条目有 vec 时，余弦重排有向量的条目优先
  // 因 findSimilar 为同步，不在此处发起新 embedding 请求(成本限制)；
  // 条目 vec 由 recordFailure 后台异步积累。有 vec 且高词法匹配=最可靠。
  const result = embed.enabled()
    ? scored.map((s) => ({ ...s, _cos: s.entry.vec ? 0.5 : -1 }))
      .sort((a, b) => b._cos - a._cos || b.score - a.score)
      .slice(0, topK).map((s) => s.entry)
    : scored.slice(0, topK).map((s) => s.entry);
  if (result.length) {
    for (const e of result) e.hitCount = (e.hitCount || 0) + 1;
    persist();
  }
  return result;
}

module.exports = { recordFailure, recordFix, findSimilar };
