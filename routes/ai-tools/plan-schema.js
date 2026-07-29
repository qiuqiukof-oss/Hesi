/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 协议 / schema（Phase 0 — 全自动闭环）
//
// 定义结构化、机器可验证的 Plan 形状，并提供纯函数校验。
// 这是全自动闭环的"契约层"：Executor 只认通过 validatePlan 的 plan，
// plan-contract.js 再在此基础上做"可验证性闸门"。
//
// 设计约束（来自 .workbuddy/全自动-mvp-plan.md）：
//   - 纯函数、零 LLM 依赖、可单测；
//   - 自主边界由"目标可验证性"决定，不靠逐步人工。
// ============================================================

// 验收 / 验证手段种类
const VERIFY_KINDS = ['command', 'script', 'http', 'manual'];

// 机器可自动判定的手段（除 manual 外都可由程序执行并断言）
const AUTO_VERIFY_KINDS = ['command', 'script', 'http'];

/** 返回一份空 plan 模板（便于 UI / Planner 初始化） */
function emptyPlan() {
  return {
    id: '',
    title: '',
    objective: '',
    acceptance: [], // [{ id?, kind, command?, expect?, description? }]
    steps: [], // [{ id, goal, action, type?, verify?, on_fail?, checkpoint?, dependsOn?, requireApproval? }]
    approvalPolicy: 'marked', // 'marked' = 仅 requireApproval 步需审批；'all' = 每步都需审批（P2.6 审批闸）
    allow_external: false,
    forbidden: [], // 命令/关键词黑名单
    scope_paths: [], // 允许路径前缀（空 = 仓库根）
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
  };
}

/**
 * 校验 plan 结构合法性（不判意图，只判形状）。
 * @param {object} plan
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['plan 必须是对象'] };
  }
  if (typeof plan.objective !== 'string' || !plan.objective.trim()) {
    errors.push('objective 必填且为字符串');
  }
  if (!Array.isArray(plan.acceptance) || plan.acceptance.length === 0) {
    errors.push('acceptance 至少含一条验收标准');
  } else {
    plan.acceptance.forEach((a, i) => {
      if (!a || typeof a !== 'object') {
        errors.push(`acceptance[${i}] 必须是对象`);
        return;
      }
      if (!VERIFY_KINDS.includes(a.kind)) {
        errors.push(`acceptance[${i}].kind 必须是 ${VERIFY_KINDS.join('/')}`);
      }
      if ((a.kind === 'command' || a.kind === 'script') && !a.command) {
        errors.push(`acceptance[${i}].command 必填（kind=${a.kind}）`);
      }
    });
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('steps 至少含一步');
  } else {
    const ids = new Set();
    plan.steps.forEach((s, i) => {
      if (!s || typeof s !== 'object') {
        errors.push(`steps[${i}] 必须是对象`);
        return;
      }
      if (!s.id) {
        errors.push(`steps[${i}].id 必填`);
      } else if (ids.has(s.id)) {
        errors.push(`steps[${i}].id 重复: ${s.id}`);
      } else {
        ids.add(s.id);
      }
      if (!s.goal) errors.push(`steps[${i}].goal 必填`);
      if (!s.action) errors.push(`steps[${i}].action 必填`);
      if (s.requireApproval !== undefined && typeof s.requireApproval !== 'boolean') {
        errors.push(`steps[${i}].requireApproval 必须是布尔`);
      }
      if (s.verify) {
        if (!VERIFY_KINDS.includes(s.verify.kind)) {
          errors.push(`steps[${i}].verify.kind 无效`);
        }
      }
      if (Array.isArray(s.dependsOn)) {
        for (const d of s.dependsOn) {
          if (!ids.has(d) && !plan.steps.some((x) => x && x.id === d)) {
            errors.push(`steps[${i}] 依赖不存在: ${d}`);
          }
        }
      }
    });
    if (plan.approvalPolicy !== undefined && !['all', 'marked'].includes(plan.approvalPolicy)) {
      errors.push('approvalPolicy 仅支持 all | marked');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 判断 plan 是否"机器可验证"：所有 acceptance 都可由程序自动判定。
 * 任一 acceptance 为 manual（需人确认）即视为不可机器验证。
 * @param {object} plan
 * @returns {boolean}
 */
function isMachineVerifiable(plan) {
  const acc = Array.isArray(plan && plan.acceptance) ? plan.acceptance : [];
  if (acc.length === 0) return false;
  return acc.every((a) => a && AUTO_VERIFY_KINDS.includes(a.kind));
}

/** 列出不可机器验证的验收项 id（用于 gate 提示） */
function nonVerifiableAcceptanceIds(plan) {
  return (Array.isArray(plan && plan.acceptance) ? plan.acceptance : [])
    .filter((a) => a && !AUTO_VERIFY_KINDS.includes(a.kind))
    .map((a) => a.id || '?');
}

module.exports = {
  VERIFY_KINDS,
  AUTO_VERIFY_KINDS,
  emptyPlan,
  validatePlan,
  isMachineVerifiable,
  nonVerifiableAcceptanceIds,
};
