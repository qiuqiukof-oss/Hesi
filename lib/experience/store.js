// @ts-check
// M3 (v0.3.1): 经验知识库（Reflexion-lite）。
// 记录工具失败 + 对应修复，下次同类失败时把历史经验注入给 LLM，减少重试、提成功率。
// 落盘 data/memory/experience.json；纯本地、零额外 LLM 调用、零新依赖。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../memory/config');

const EXP_FILE = path.join(path.dirname(config.SESSIONS_DIR), 'experience.json');
const MAX_ENTRIES = 500;

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
  data.entries.push({
    tool,
    argsDigest: digest(JSON.stringify(args || {})),
    error: String(error || '').slice(0, 300),
    ts: Date.now(),
  });
  if (data.entries.length > MAX_ENTRIES) {
    data.entries = data.entries.slice(-MAX_ENTRIES);
  }
  persist();
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
  return scored.slice(0, topK).map((s) => s.entry);
}

module.exports = { recordFailure, recordFix, findSimilar };
