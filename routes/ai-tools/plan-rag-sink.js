/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// RAG 快照回流（全自动 Phase 1 — ③）—— 商业级增强版 (v0.6.3 M1)
//
// Plan 执行完成（成功/失败）后，把「目标 + 执行元信息 + 每步 action/状态 + 结论」
// 作为一条 type:'plan' 文档回流进 index-store，供后续「历史 Plan」列表与聊天召回
// （recall.js / M2）检索，形成「执行 → 沉淀 → 复用」的闭环。
//
// 设计原则：
// - 纯函数 + 零 LLM 依赖；HESI_PLAN_RAG_SINK=0 可整体关闭。
// - 稳定 ref：基于 objective+steps 内容哈希，同目标反复执行 → 更新而非新增（P-A3）。
// - 失败也回流（HESI_PLAN_RAG_SINK_FAILED，默认开启）——对"哪些事没做成/为什么"有价值。
// - 轻量脱敏（HESI_PLAN_RAG_REDACT，默认开启）：路径用户段 + 高熵密钥打码（P-A6/A7）。
// - 容量上限（HESI_PLAN_INDEX_MAX，默认 500）：超出删最旧，避免 index JSON 膨胀（P-A2）。
// - 单 doc text 截断（4KB），防止步骤过多撑爆索引（P-A2）。
// - 任何一环失败均不影响主执行流程（失败静默降级）。
// ============================================================

const crypto = require('crypto');
const indexStore = require('../../lib/memory/index-store');

const TEXT_LIMIT = 4096;

/**
 * 稳定 ref：基于 objective + steps 关键字段的哈希，保证同一目标反复执行落到同一 ref
 * （更新而非新增），并保留执行次数。plan.id 不稳定（每次生成不同 uuid）一律不用作 ref。
 * @param {object} plan
 * @returns {string}
 */
function stableRef(plan) {
  const id = plan && plan.id;
  // 调用方提供的稳定业务 id（非 uuid v4 随机串）→ 优先复用，便于「重新执行」定位同一历史
  if (typeof id === 'string' && id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return `plan:${id}`;
  }
  // 否则基于 objective+steps 内容哈希：同目标反复执行 → 落到同一 ref（更新而非新增，P-A3）
  const objective = plan && plan.objective ? String(plan.objective) : '';
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  const seed = `${objective}\n${JSON.stringify(
    steps.map((s) => ({ goal: s.goal, action: s.action, type: s.type }))
  )}`;
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  return `plan:${hash}`;
}

/**
 * 轻量脱敏：仅打码绝对路径的用户主目录段与高熵密钥模式，保留命令结构（P-A6）。
 * 不写死任何具体用户名/盘符（遵守无硬编码红线，用通用前缀正则）。
 * @param {string} text
 * @returns {string}
 */
function redact(text) {
  if (process.env.HESI_PLAN_RAG_REDACT === '0') return text;
  let t = String(text);
  // 用户主目录段打码（跨平台通用前缀）
  t = t.replace(/\/home\/[^\/\s'"]+/g, '/home/<user>');
  t = t.replace(/\/Users\/[^\/\s'"]+/g, '/Users/<user>');
  t = t.replace(/\/root\/[^\/\s'"]+/g, '/root/<user>');
  t = t.replace(/C:\\Users\\[^\s'"]+/gi, 'C:\\Users\\<user>');
  t = t.replace(/[A-Z]:\\Users\\[^\s'"]+/gi, '<userhome>\\<user>');
  // 高熵密钥 / token 模式
  t = t.replace(/(api[_-]?key|secret|token|access[_-]?token|password)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi, '$1=<secret>');
  t = t.replace(/sk-[A-Za-z0-9]{16,}/g, 'sk-<secret>');
  t = t.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, 'gh<secret>');
  return t;
}

/**
 * 脱敏完整 plan（用于「重新执行」回填），仅处理 objective / 每步 action / 验收 command。
 * 不写死路径（通用前缀正则），保留计划结构。
 * @param {object} plan
 * @returns {object}
 */
function redactPlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  let clone;
  try { clone = JSON.parse(JSON.stringify(plan)); } catch { return plan; }
  if (typeof clone.objective === 'string') clone.objective = redact(clone.objective);
  if (Array.isArray(clone.steps)) clone.steps.forEach((s) => { if (typeof s.action === 'string') s.action = redact(s.action); });
  if (Array.isArray(clone.acceptance)) clone.acceptance.forEach((a) => { if (typeof a.command === 'string') a.command = redact(a.command); });
  return clone;
}

/** 单 doc text 截断，防步骤过多撑爆索引（P-A2）。 */
function truncate(text) {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…(内容过长已截断)` : text;
}

/**
 * 把 Plan 执行结果压成结构化索引文本。
 * @param {object} plan
 * @param {object} result  runPlan 返回（含 steps / status / branch）
 * @param {object} meta  { startedAt, endedAt, agentId, discussionSummary }
 */
function buildPlanDocText(plan, result, meta) {
  const lines = [];
  lines.push(`目标: ${plan.objective || ''}`);
  const status = (result && result.status) ? result.status : 'unknown';
  const durSec = (meta && meta.startedAt && meta.endedAt)
    ? ((meta.endedAt - meta.startedAt) / 1000).toFixed(1)
    : '?';
  const agent = (meta && meta.agentId) || plan.agentId || 'ai';
  const branch = result && result.branch ? result.branch : '';
  const when = (meta && meta.endedAt) ? new Date(meta.endedAt).toISOString() : new Date().toISOString();
  lines.push(`执行: 状态=${status} 耗时=${durSec}s Agent=${agent} 分支=${branch} 时间=${when}`);
  const resSteps = (result && Array.isArray(result.steps)) ? result.steps : [];
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  for (const s of steps) {
    const st = resSteps.find((x) => x.id === s.id);
    const cmd = s.action ? ` (cmd: ${String(s.action).slice(0, 140)})` : '';
    lines.push(`- [${st ? st.status : '?'}] ${s.goal || ''}${cmd}`);
  }
  const acc = Array.isArray(plan.acceptance) ? plan.acceptance : [];
  if (acc.length) lines.push(`验收: ${acc.map((a) => a.command || a.kind).join('; ')}`);
  if (meta && meta.discussionSummary) lines.push(`讨论: ${meta.discussionSummary}`);
  lines.push(`结论: ${status}`);
  return lines.join('\n');
}

/**
 * 容量清理：超出 HESI_PLAN_INDEX_MAX 时按 updatedAt 升序删最旧（P-A2/A5）。
 */
function enforceCapacity() {
  const max = Number(process.env.HESI_PLAN_INDEX_MAX) || 500;
  try {
    const idx = indexStore.load();
    const plans = (idx.docs || []).filter((d) => d.type === 'plan');
    if (plans.length <= max) return;
    const excess = plans.length - max;
    const sorted = plans.slice().sort((a, b) => (a.meta && a.meta.updatedAt ? a.meta.updatedAt : 0)
      - (b.meta && b.meta.updatedAt ? b.meta.updatedAt : 0));
    for (let i = 0; i < excess; i++) indexStore.remove(sorted[i].ref);
  } catch { /* 容量清理失败不阻断主流程 */ }
}

/**
 * 把 Plan 执行结果回流进 index-store（供后续检索增强 RAG）。
 * @param {object} plan
 * @param {object} result  runPlan 返回
 * @param {object} [meta]  { startedAt, endedAt, agentId, discussionSummary }
 * @returns {object|null} 回流的文档，或关闭/跳过时返回 null
 */
function sinkPlanToIndex(plan, result, meta = {}) {
  if (process.env.HESI_PLAN_RAG_SINK === '0') return null;
  if (!plan) return null;
  const ok = !!(result && result.ok);
  const sinkFailed = process.env.HESI_PLAN_RAG_SINK_FAILED !== '0';
  if (!ok && !sinkFailed) return null; // 失败不回流（按开关，默认回流）
  const ref = stableRef(plan);
  const title = plan.title || (plan.objective || '').slice(0, 60) || ref;
  const rawText = buildPlanDocText(plan, result, meta);
  const text = truncate(redact(rawText));
  const doc = indexStore.buildDoc({ ref, type: 'plan', title, text });
  doc.meta = {
    planId: plan.id || null,
    status: (result && result.status) || 'unknown',
    ok,
    startedAt: meta && meta.startedAt ? new Date(meta.startedAt).toISOString() : null,
    endedAt: meta && meta.endedAt ? new Date(meta.endedAt).toISOString() : null,
    agentId: (meta && meta.agentId) || plan.agentId || 'ai',
    branch: result && result.branch ? result.branch : null,
    plan: redactPlan(plan),
    discussionTranscript: (meta && meta.discussionTranscript) ? meta.discussionTranscript : null,
    executions: 1,
    updatedAt: Date.now(),
    discussionSummary: meta && meta.discussionSummary ? meta.discussionSummary : null,
  };
  indexStore.upsert(doc);
  enforceCapacity();
  return doc;
}

module.exports = { sinkPlanToIndex, stableRef, redact, truncate, enforceCapacity };
