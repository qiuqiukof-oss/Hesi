/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 审批闸共享登记表（P4-2：审批闸对话式）
//
// 旧实现把 pendingApprovals 关在 plan-routes.js 的 createRouter 闭包里，
// 只有 /api/plan/execute 这条「抽屉」链路能用；对话链路（plan-turn.js 的
// SSE 回合）没有审批 UI，只能「遇到需审批步骤直接驳回」。
//
// 抽出进程级单例后，两条链路共用同一张表：
//   - plan-turn.js 的 requestApproval → registerApproval（发 await-approval、挂起等决议）
//   - plan-routes.js 的 /approve|/reject 端点 → resolveApproval（解挂、发 approval-resolved）
// HTTP 端点契约不变（仍是 POST /api/plan/<execId>/approve|reject），仅内部接线收敛。
// ============================================================
'use strict';

/** execId -> { resolve, timer, emit }；emit 为各链路自带的投递器（WS / SSE） */
const pending = new Map();

/**
 * 登记一次待审批并挂起等待人工决议。
 * @param {string} execId
 * @param {object} info 步骤信息 { execId, index, id, goal, action, risk }
 * @param {number} timeoutMs 超时（毫秒）；超时视为驳回
 * @param {(type:string, data?:object)=>void} emit 投递器（WS emit 或 SSE emit）
 * @returns {Promise<boolean>} true=通过 / false=驳回（含超时）
 */
function registerApproval(execId, info, timeoutMs, emit) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(execId);
      try { emit('approval-resolved', { approved: false, timedOut: true }); } catch { /* ignore */ }
      resolve(false);
    }, Number(timeoutMs) || 30 * 60 * 1000);
    pending.set(execId, { resolve, timer, emit, info });
    // 通知前端出闸门（WS: plan:await-approval / SSE: plan_await_approval）
    try { emit('await-approval', { step: info }); } catch { /* ignore */ }
  });
}

/**
 * 人工决议（通过/驳回），解挂并通知前端。
 * @param {string} execId
 * @param {boolean} approved
 * @returns {boolean} 是否命中待审批项
 */
function resolveApproval(execId, approved) {
  const p = pending.get(execId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(execId);
  try { p.emit('approval-resolved', { approved: !!approved, timedOut: false }); } catch { /* ignore */ }
  p.resolve(!!approved);
  return true;
}

/** 执行结束/异常时清理挂起的审批定时器（不决议） */
function cancelApproval(execId) {
  const p = pending.get(execId);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(execId);
  return true;
}

function hasPendingApproval(execId) {
  return pending.has(execId);
}

module.exports = { registerApproval, resolveApproval, cancelApproval, hasPendingApproval };
