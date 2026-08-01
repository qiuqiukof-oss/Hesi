/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// RAG 检索服务（v0.6.3 M1）—— 打通 index-store 的读取端
//
// 现状：index-store.query() 此前全项目零调用方，回流是单向空壳。
// 本模块提供：
// - recallPlans(q, {topK})：按关键词 BM25 召回历史 Plan（type='plan' 过滤）
// - listPlans({limit, offset, status})：分页列表，供前端「历史 Plan」UI
// - deletePlan(ref) / clearPlans()：清理接口（受 RAG 总开关 gate）
// - 内存缓存：按 index 文件 mtime 失效，避免每次全量读 JSON（P-A8）
//
// 所有读取失败静默降级，绝不阻断调用方。
// ============================================================

const fs = require('fs');
const indexStore = require('../../lib/memory/index-store');
const config = require('../../lib/memory/config');

let _cache = null;
let _cacheMtime = -1;

/** 带 mtime 缓存的索引读取 */
function getIndex() {
  try {
    const st = fs.statSync(config.INDEX_FILE);
    if (_cache && _cacheMtime === st.mtimeMs) return _cache;
    const idx = indexStore.load();
    _cache = idx;
    _cacheMtime = st.mtimeMs;
    return idx;
  } catch {
    const idx = indexStore.load();
    _cache = idx;
    _cacheMtime = Date.now();
    return idx;
  }
}

/**
 * 出参投影：剔除 BM25 内部字段（tf/tokens/vec）。
 * 这些字段仅供打分使用，前端从不消费；50 条历史里 tf 可占 ~67% 体积，
 * 直接外发会让 /history 响应膨胀到百 KB 级（P-A9）。
 * @param {object} doc
 * @returns {object}
 */
function toView(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { tf: _tf, tokens: _tokens, vec: _vec, ...rest } = doc;
  return rest;
}

/**
 * 关键词召回历史 Plan。
 * @param {string} q
 * @param {{topK?:number}} [opts]
 * @returns {Array<object>}
 */
function recallPlans(q, { topK = 3 } = {}) {
  const idx = getIndex();
  const hits = indexStore.query(idx, q, { topK });
  return hits.filter((d) => d.type === 'plan').map(toView);
}

/**
 * 关键词召回历史圆桌讨论（type='roundtable'，讨论库，方案 D）。
 * 命中项含 question/summary/verify/transcriptRef —— 供前端展示「人工确认复用建议」：
 * 原问题 + 结论 + 验收命令（复用前可重跑 verify 确认结论仍成立），绝不自动跳过。
 * @param {string} q
 * @param {{topK?:number}} [opts]
 * @returns {Array<object>}
 */
function recallRoundtables(q, { topK = 3 } = {}) {
  const idx = getIndex();
  const hits = indexStore.query(idx, q, { topK });
  return hits.filter((d) => d.type === 'roundtable').map(toView);
}

/**
 * 关键词召回全部可复用记录（plan + roundtable），按 type 区分。
 * 供 /history/search 一次返回两类（前端可分别展示「历史 Plan」与「历史讨论建议」）。
 * @param {string} q
 * @param {{topK?:number}} [opts]
 * @returns {Array<object>}
 */
function recallAll(q, { topK = 5 } = {}) {
  const idx = getIndex();
  const hits = indexStore.query(idx, q, { topK });
  return hits.map(toView);
}

/**
 * 分页列出历史 Plan（默认按更新时间倒序）。
 * @param {{limit?:number,offset?:number,status?:string|null}} [opts]
 * @returns {{total:number,items:Array<object>}}
 */
function listPlans({ limit = 50, offset = 0, status = null } = {}) {
  const idx = getIndex();
  let docs = (idx.docs || []).filter((d) => d.type === 'plan');
  if (status) docs = docs.filter((d) => d.meta && d.meta.status === status);
  docs.sort((a, b) => (b.meta && b.meta.updatedAt ? b.meta.updatedAt : 0)
    - (a.meta && a.meta.updatedAt ? a.meta.updatedAt : 0));
  const total = docs.length;
  const paged = docs.slice(Math.max(offset, 0), Math.max(offset, 0) + Math.min(limit, 200));
  return { total, items: paged.map(toView) };
}

/**
 * 按 ref 精确删除一条历史 Plan。
 * @param {string} ref
 * @returns {boolean}
 */
function deletePlan(ref) {
  if (typeof ref !== 'string' || !ref) return false;
  indexStore.remove(ref);
  _cache = null;
  return true;
}

/** 清空全部历史 Plan（谨慎；前端需二次确认）。 */
function clearPlans() {
  const idx = indexStore.load();
  idx.docs = (idx.docs || []).filter((d) => d.type !== 'plan');
  indexStore.save(idx);
  _cache = null;
  return true;
}

module.exports = { recallPlans, recallRoundtables, recallAll, listPlans, deletePlan, clearPlans, getIndex, toView };
