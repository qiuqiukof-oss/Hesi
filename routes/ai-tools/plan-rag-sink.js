/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// RAG 快照回流（全自动 Phase 1 — ③）
//
// Plan 跑通（done/partial）后，把「目标 + 步骤 + 结论」作为一条 type:'plan'
// 文档回流进 index-store，供后续会话的检索增强（recall.js）召回，形成
// 「执行 → 沉淀 → 复用」的闭环。
//
// 设计：纯函数 + 零 LLM 依赖；HESI_PLAN_RAG_SINK=0 可关闭（测试/隔离用）。
// 落盘走 index-store 既有 upsert/buildDoc，不引入新存储。
// ============================================================

const indexStore = require('../../lib/memory/index-store');

/** 把 Plan 执行结果压成索引文本 */
function buildPlanDocText(plan, result) {
  const lines = [];
  lines.push(`目标: ${plan.objective || ''}`);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  for (const s of steps) {
    const st = (result && Array.isArray(result.steps) ? result.steps : []).find((x) => x.id === s.id);
    lines.push(`- 步骤 ${s.id} (${st ? st.status : '?'}): ${s.goal || ''}`);
  }
  const acc = Array.isArray(plan.acceptance) ? plan.acceptance : [];
  if (acc.length) lines.push(`验收: ${acc.map((a) => a.command || a.kind).join('; ')}`);
  lines.push(`结论: ${result && result.status}`);
  return lines.join('\n');
}

/**
 * 把跑通的 Plan 快照回流进 index-store（供后续检索增强 RAG）。
 * @param {object} plan
 * @param {object} result  runPlan 的返回（含 steps / status / branch）
 * @returns {object|null} 回流的文档，或关闭时返回 null
 */
function sinkPlanToIndex(plan, result) {
  if (process.env.HESI_PLAN_RAG_SINK === '0') return null;
  if (!plan) return null;
  const ref = `plan:${plan.id || (result && result.branch) || 'unknown'}`;
  const title = plan.title || (plan.objective || '').slice(0, 60);
  const text = buildPlanDocText(plan, result);
  const doc = indexStore.buildDoc({ ref, type: 'plan', title, text });
  indexStore.upsert(doc);
  return doc;
}

module.exports = { sinkPlanToIndex };
