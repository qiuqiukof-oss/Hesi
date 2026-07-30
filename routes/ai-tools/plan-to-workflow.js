/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan → workflow DAG 转换器（Phase 0 — 全自动闭环）
//
// 把通过合约的 Plan 映射成 workflow-manager 的任务定义：
//   - step → task（goal 作 label，action 作 task）
//   - dependsOn 透传（顺序/并行由图决定）
//   - verify / checkpoint 作为 task 元数据（Executor 在标完成前跑 verify）
//   - on_fail → failure policy（stop/continue/skip-dependents）
//
// 另提供 scope/forbidden 纯函数守卫，供 Executor 在创建/执行 task 前校验
// （爆震半径控制，对应 plan 的 scope_paths / forbidden）。
// ============================================================

/**
 * 将 Plan 转换为 workflow-manager 任务数组。
 * @param {object} plan
 * @param {{ defaultAgentId?: string }} [opts]
 * @returns {Array<object>}
 */
function planToWorkflowTasks(plan, opts) {
  const steps = Array.isArray(plan && plan.steps) ? plan.steps : [];
  const defaultAgentId = (opts && opts.defaultAgentId) || null;
  return steps.map((s, i) => ({
    id: s.id || `task-${i + 1}`,
    label: s.goal || s.id || `任务 ${i + 1}`,
    task: s.action || '',
    agentId: s.agentId || defaultAgentId || undefined,
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    onFailure: s.on_fail || 'stop', // stop / continue / skip-dependents
    maxRetries: s.retry != null ? s.retry : 0,
    // ── Phase 0 元数据（Executor 消费）──
    verify: s.verify || null, // { kind, command?, expect? }
    checkpoint: !!s.checkpoint, // 软断点
    type: s.type || 'exec',
  }));
}

/**
 * 路径是否在 scope_paths 白名单内。
 * scope_paths 为空 → 允许仓库内任意路径（白名单为空=不限制）。
 * @param {object} plan
 * @param {string} path
 * @returns {boolean}
 */
function inScope(plan, path) {
  const scopes = Array.isArray(plan && plan.scope_paths) ? plan.scope_paths : [];
  if (scopes.length === 0) return true;
  // 统一正斜杠比较：Windows 路径可能含 \，LLM 生成的路径可能用 /
  // 避免 H:/Hesi/foo 与 H:\Hesi 因分隔符不同而误判为越界
  const p = String(path || '').replace(/\\/g, '/');
  return scopes.some((s) => {
    const norm = String(s).replace(/\\/g, '/').replace(/\/$/, '');
    return p === norm || p.startsWith(norm + '/');
  });
}

/**
 * 命令是否命中 forbidden 黑名单（子串匹配）。
 * @param {object} plan
 * @param {string} command
 * @returns {boolean} true=被禁
 */
function isForbidden(plan, command) {
  const forbidden = Array.isArray(plan && plan.forbidden) ? plan.forbidden : [];
  const c = String(command || '').toLowerCase();
  return forbidden.some((f) => c.includes(String(f).toLowerCase()));
}

module.exports = { planToWorkflowTasks, inScope, isForbidden };
