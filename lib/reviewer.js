/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2 Reviewer（质量与目标漂移审查）—— 纯函数，零 LLM
//
// 依据《协作工作流讨论与试实施方案》4.1：
// - Verifier：每轮、低成本、只查 DoD 合规（functional/semantic/quality）
// - Reviewer：罕见、高成本、查**质量与目标漂移**，仅在 STALLED（连续无进展）时触发
// - 合并的后果：便宜的事变贵、贵的事被例行化 → 必须分离
//
// 本模块做确定性聚合判定（不调用 LLM）：
// - 质量门：Verifier 的 delta 项数 + 工件存在性 → OK / WARN / POOR
// - 漂移门：plan 是否被修订 + 修订是否偏离原始目标 → ON_TRACK / DRIFTED
// - 决策：CONTINUE（可修）/ STOP（质量差且无改进）/ ESCALATE（漂移→人工）
// ============================================================

'use strict';

/**
 * Reviewer 质量门阈值。
 * - deltaItems: Verifier 缺失清单总条数
 * - missingArtifacts: 冻结 plan 要求产出但缺失的工件数
 */
const QUALITY_GATES = {
  warnDeltaItems: 3,   // delta ≥ 3 → WARN
  poorDeltaItems: 8,   // delta ≥ 8 → POOR
  warnMissingArtifacts: 1,
  poorMissingArtifacts: 3,
};

/**
 * 执行质量与漂移审查（仅在 STALLED 时调用，成本高故收敛为单次判定）。
 * @param {object} ctx
 * @param {object} [ctx.plan] 冻结计划（含 goal/title 与要求产出的工件清单 artifactsRequired）
 * @param {Array} [ctx.verifierDelta] Verifier 产出的 delta list（缺失清单）
 * @param {Array} [ctx.artifacts] 实际产出的工件路径清单
 * @param {number} [ctx.rounds] 已执行轮数
 * @param {Array<string>} [ctx.driftEvidence] 漂移证据（调用方收集：如修订后 goal 变化、commit msg 偏离目标词）
 * @param {boolean} [ctx.planRevised] 本轮 revision 是否改动了 plan 本身（不改动=原地打转）
 * @returns {{
 *   quality: { v: 'OK'|'WARN'|'POOR', issues: string[] },
 *   drift: { v: 'ON_TRACK'|'DRIFTED', evidence: string[] },
 *   verdict: 'CONTINUE'|'STOP'|'ESCALATE',
 *   why: string,
 * }}
 */
function review(ctx = {}) {
  const delta = Array.isArray(ctx.verifierDelta) ? ctx.verifierDelta : [];
  const artifacts = Array.isArray(ctx.artifacts) ? ctx.artifacts : [];
  const driftEvidence = Array.isArray(ctx.driftEvidence) ? ctx.driftEvidence : [];
  const requiredArtifacts = Array.isArray(ctx.plan && ctx.plan.artifactsRequired)
    ? ctx.plan.artifactsRequired
    : [];
  const issues = [];

  // ── 质量门（确定性） ──
  const deltaItems = delta.reduce((n, d) => n + ((d && d.missing) ? d.missing.length : 0), 0);
  const missingArtifacts = requiredArtifacts.filter((a) => !artifacts.includes(a));

  let quality;
  if (deltaItems >= QUALITY_GATES.poorDeltaItems || missingArtifacts.length >= QUALITY_GATES.poorMissingArtifacts) {
    issues.push(`Verifier 缺失项 ${deltaItems} 条`);
    if (missingArtifacts.length > 0) issues.push(`缺失工件 ${missingArtifacts.length} 个: ${missingArtifacts.join(', ')}`);
    quality = { v: 'POOR', issues };
  } else if (deltaItems >= QUALITY_GATES.warnDeltaItems || missingArtifacts.length >= QUALITY_GATES.warnMissingArtifacts) {
    if (deltaItems > 0) issues.push(`Verifier 缺失项 ${deltaItems} 条`);
    if (missingArtifacts.length > 0) issues.push(`缺失工件 ${missingArtifacts.length} 个: ${missingArtifacts.join(', ')}`);
    quality = { v: 'WARN', issues };
  } else {
    quality = { v: 'OK', issues };
  }

  // ── 漂移门 ──
  const drift = driftEvidence.length > 0
    ? { v: 'DRIFTED', evidence: driftEvidence }
    : { v: 'ON_TRACK', evidence: [] };

  // ── 决策 ──
  // 漂移（修订改了目标/commit 偏离）→ 人工介入，绝不自动续跑
  if (drift.v === 'DRIFTED') {
    return { quality, drift, verdict: 'ESCALATE', why: `目标漂移：${driftEvidence.join('; ')}。需人工裁定是否改目标，严禁自动继续。` };
  }
  // 质量差 + 多轮无改进（原地打转且 delta 大）→ 停止并报告，避免无目标重做
  if (quality.v === 'POOR' && ctx.planRevised === false) {
    return { quality, drift, verdict: 'STOP', why: `质量不达标（delta=${deltaItems}）且 plan 未修订（原地打转），停止并出报告。` };
  }
  if (quality.v === 'POOR') {
    return { quality, drift, verdict: 'STOP', why: `质量不达标（delta=${deltaItems}），停止并出报告，避免无目标重做。` };
  }
  // 可修 → 继续（带回质量警告）
  return { quality, drift, verdict: 'CONTINUE', why: quality.v === 'WARN' ? `质量警告（delta=${deltaItems}），可继续修订。` : '质量与目标均正常，可继续。' };
}

module.exports = { review, QUALITY_GATES };
