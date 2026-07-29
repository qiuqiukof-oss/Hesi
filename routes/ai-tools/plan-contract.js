/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 可验证性闸门 + checkpoint 兜底（Phase 0 — 全自动闭环）
//
// 这是"意图对齐（无 HITL 唯一致命风险）"的结构性解法层：
//   - gatePlan()        : 决策① —— objective 不可机器验证即拒收，要人补 acceptance
//   - resolveCheckpoint(): 决策② —— checkpoint 步无法机器验证 → 转圆桌讨论 N 轮推导，
//                            仍不行则兜底回决策①
//
// roundtableFn 依赖注入（便于单测、避免硬耦合 discuss.js）：
//   async ({ question, transcript, rounds }) => ({ kind, command } | null)
// 真实实现（Phase 0 执行器阶段）由 discuss.js 的汇总能力包装提供。
// ============================================================

const { isMachineVerifiable, nonVerifiableAcceptanceIds, AUTO_VERIFY_KINDS } = require('./plan-schema');

/**
 * 评估 plan 各项的机器可验证性（不拒收，只报告）。
 * @returns {{ overall: boolean, acceptance: Array, steps: Array }}
 */
function assessVerifiability(plan) {
  const acceptance = (plan.acceptance || []).map((a) => ({
    id: a.id || '?',
    kind: a.kind,
    machine: AUTO_VERIFY_KINDS.includes(a.kind),
  }));
  const steps = (plan.steps || []).map((s) => ({
    id: s.id,
    hasVerify: !!s.verify,
    machine: s.verify ? AUTO_VERIFY_KINDS.includes(s.verify.kind) : false,
  }));
  return { overall: isMachineVerifiable(plan), acceptance, steps };
}

/**
 * 决策①：可验证性闸门。
 * objective 无法映射为机器可查 acceptance（含 manual）→ 拒收 + 要人补。
 * @returns {{ ok: boolean, needsAcceptance?: boolean, reason?: string, missing?: string[] }}
 */
function gatePlan(plan) {
  const a = assessVerifiability(plan);
  if (!a.overall) {
    return {
      ok: false,
      needsAcceptance: true,
      reason: '目标无法被机器自动验证（存在 manual/缺失验收），需补充机器可查的 acceptance',
      missing: nonVerifiableAcceptanceIds(plan),
    };
  }
  return { ok: true, verifiable: a };
}

function _buildCheckpointQuestion(plan, step) {
  const obj = plan && plan.objective ? `计划目标：${plan.objective}\n` : '';
  const goal = step && step.goal ? `步骤目标：${step.goal}\n` : '';
  const action = step && step.action ? `步骤动作：${step.action}\n` : '';
  return (
    `${obj}${goal}${action}` +
    '请推导一个「机器可自动验证」的验收标准，返回 JSON：' +
    '{ "kind": "command"|"script"|"http", "command": "可执行的命令", "expect": "期望结果关键字" }。' +
    '不要返回需要人工确认(manual)的标准。若确实无法机器验证，返回 null。'
  );
}

/**
 * 决策②：checkpoint 软断点兜底。
 * 若本步已有机器可验证 verify → 直接通过；
 * 否则注入 roundtableFn 跑最多 rounds 轮，尝试推导可验证 acceptance；
 * 仍不行 → 兜底回决策①（needsAcceptance + fellBack）。
 *
 * @param {object} plan
 * @param {object} step
 * @param {{ rounds?: number, roundtableFn?: Function, transcript?: string }} [opts]
 * @returns {Promise<{ ok: boolean, usedRoundtable?: boolean, roundsUsed?: number, derivedVerify?: object, needsAcceptance?: boolean, fellBack?: boolean, reason?: string }>}
 */
async function resolveCheckpoint(plan, step, opts = {}) {
  const rounds = opts.rounds || 3;
  // 本步已机器可验证 → 无需讨论
  if (step && step.verify && AUTO_VERIFY_KINDS.includes(step.verify.kind)) {
    return { ok: true, usedRoundtable: false };
  }
  // 未配置 roundtable → 直接兜底回决策①
  if (typeof opts.roundtableFn !== 'function') {
    return {
      ok: false,
      needsAcceptance: true,
      fellBack: true,
      reason: 'checkpoint 无法验证且未配置 roundtable，退回需人补充 acceptance',
    };
  }
  const question = _buildCheckpointQuestion(plan, step);
  const transcript = opts.transcript || '';
  for (let r = 1; r <= rounds; r++) {
    let out = null;
    try {
      out = await opts.roundtableFn({ question, transcript, rounds: 1 });
    } catch {
      out = null;
    }
    if (out && out.kind && AUTO_VERIFY_KINDS.includes(out.kind) && (out.command || out.expect)) {
      return { ok: true, usedRoundtable: true, roundsUsed: r, derivedVerify: out };
    }
  }
  // 耗尽轮数仍不可验证 → 兜底回决策①
  return {
    ok: false,
    needsAcceptance: true,
    fellBack: true,
    roundsUsed: rounds,
    reason: `roundtable 经 ${rounds} 轮仍无法推导机器可验证标准，退回需人补充 acceptance`,
  };
}

module.exports = { assessVerifiability, gatePlan, resolveCheckpoint };
