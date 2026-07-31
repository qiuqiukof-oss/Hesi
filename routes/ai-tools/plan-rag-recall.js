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
 * 关键词召回历史 Plan。
 * @param {string} q
 * @param {{topK?:number}} [opts]
 * @returns {Array<object>}
 */
function recallPlans(q, { topK = 3 } = {}) {
  const idx = getIndex();
  const hits = indexStore.query(idx, q, { topK });
  return hits.filter((d) => d.type === 'plan');
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
  return { total, items: paged };
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

module.exports = { recallPlans, listPlans, deletePlan, clearPlans, getIndex };
