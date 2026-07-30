/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 执行 HTTP 路由（Phase 0 — 全自动闭环的前端入口）
//
// POST /api/plan/execute  { plan, apiKey?, provider?, baseUrl?, model?, partners? }
//   → 调 runPlan(plan, {...}) 跑完整闭环，返回 { ok, status, branch, steps, reflection }。
//
// cwd 固定为 server 根（process.cwd()）；Phase 0 不接收任意路径，避免越权。
// roundtableFn 由本模块用 discuss.runRoundtable 包装（无配置时优雅降级为 diverged）。
// ============================================================

const express = require('express');
const crypto = require('crypto');
const { runPlan, parseVerifyFromSummary } = require('./run-plan');
const { workflowManager } = require('./workflow-manager');
const { runRoundtable } = require('../chat/discuss');
const { generatePlanFromObjective, revisePlan } = require('./plan-from-nl');
const { sinkPlanToIndex } = require('./plan-rag-sink');

/**
 * 解析 Plan 执行默认 Agent（可自选 / 圆桌式默认）。
 * - 前端显式选择 body.agentId 时优先用（'ai' 表示内置 AI 助手 LLM 管线，
 *   其余为外部 CLI agent id，走旧 agentPool 回退路径）。
 * - 未指定 → 圆桌式默认：AI 助手为本地推理方（'ai'），复用其已调好的 LLM 工具环。
 * @param {object} body 请求体（含可选 agentId）
 * @returns {string} 'ai' 或外部 agent id
 */
function resolveExecutorAgentId(body) {
  const sel = body && body.agentId;
  if (typeof sel === 'string' && sel.trim()) return sel.trim();
  return 'ai';
}

// 审批闸：execId -> { resolve, timer }
const pendingApprovals = new Map();
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30min 无操作 → 视为驳回

/**
 * 用 discuss.runRoundtable 包装出 resolveCheckpoint 需要的 roundtableFn。
 * @param {object} runtime  { apiKey, provider, baseUrl, model, partner, partners }
 */
function buildRoundtableFn(runtime) {
  return async function roundtableFn({ question, transcript, rounds }) {
    try {
      const out = await runRoundtable({
        message: question,
        partner: runtime.partner,
        partners: Array.isArray(runtime.partners) ? runtime.partners : [],
        maxTurns: rounds || 3,
        apiKey: runtime.apiKey,
        provider: runtime.provider,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        transcript: transcript || '',
        onEvent: null,
        shouldAbort: null,
      });
      return parseVerifyFromSummary(out && out.summary);
    } catch {
      return null; // 圆桌失败 → 交给 resolveCheckpoint 兜底回决策①
    }
  };
}

/**
 * @param {{ cwd?: string, workflowManager?: object, broadcastFn?: (data:object)=>void, approvalTimeoutMs?: number }} [opts]
 * @returns {express.Router}
 */
function createRouter(opts = {}) {
  const router = express.Router();
  const cwd = opts.cwd || process.cwd();
  const wf = opts.workflowManager || workflowManager;
  const broadcast = (data) => { try { if (opts.broadcastFn) opts.broadcastFn(data); } catch { /* ignore */ } };
  // 审批超时回退值（默认 30min）；测试可注入极小值以覆盖超时路径。
  // 真实请求可经 body.approvalTimeoutMs / plan.approvalTimeoutMs 按 plan 覆盖（见 /execute 处理器）。
  const factoryApprovalTimeoutMs = Number.isFinite(opts.approvalTimeoutMs) && opts.approvalTimeoutMs > 0
    ? opts.approvalTimeoutMs
    : APPROVAL_TIMEOUT_MS;

  router.post('/execute', async (req, res) => {
    const body = req.body || {};
    const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
    const runtime = {
      apiKey: body.apiKey,
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      partner: body.partner,
      partners: body.partners,
    };
    let plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
    // 自然语言入口：给了 objective 且没手写 plan → 先让 AI 拆解成 plan
    if (!plan && objective) {
      try {
        plan = await generatePlanFromObjective(objective, runtime);
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message, code: e.code || 'GEN_FAILED' });
      }
    }
    if (!plan) {
      return res.status(400).json({ ok: false, error: '缺少 plan 对象（body.plan）或目标（body.objective）' });
    }
    // 审批超时：支持 per-plan 配置（body.approvalTimeoutMs / plan.approvalTimeoutMs），
    // 回退到路由工厂注入值，最终回退 30min 默认。大型多步重构可调长。
    const reqApprovalTimeoutMs = Number(body.approvalTimeoutMs);
    const planApprovalTimeoutMs = Number(plan && plan.approvalTimeoutMs);
    const approvalTimeoutMs =
      (Number.isFinite(reqApprovalTimeoutMs) && reqApprovalTimeoutMs > 0 && reqApprovalTimeoutMs) ||
      (Number.isFinite(planApprovalTimeoutMs) && planApprovalTimeoutMs > 0 && planApprovalTimeoutMs) ||
      factoryApprovalTimeoutMs;
    const execId = crypto.randomUUID();
    // 审批闸：等待人工决议（超时兜底→驳回）
    const requestApproval = (reqInfo) => new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovals.delete(execId);
        broadcast({ type: 'plan:approval-resolved', execId, approved: false, timedOut: true });
        resolve(false);
      }, approvalTimeoutMs);
      pendingApprovals.set(execId, { resolve, timer });
      broadcast({ type: 'plan:await-approval', execId, step: reqInfo });
    });
    try {
      // ② 反思重规划环 / ④ 运行时拦截开关（仅当显式开启或 fullAuto 时激活，默认关闭避免回归）
      const perms = (body.permissions && typeof body.permissions === 'object') ? body.permissions : null;
      const fullAuto = !!(perms && perms.fullAuto);
      // 占位符步骤（LLM 输出为空壳）自动启用 autoReplan：让反思重规划环重新生成 Plan
      // 一次，符合用户期望的"发现问题自动修复一次"能力（而非静默 done 或直接失败）。
      const hasPlaceholderSteps = Array.isArray(plan.steps)
        && plan.steps.some((s) => s && (s._isPlaceholder || s.type === 'skip'));
      const autoReplan = !!(body.autoReplan || plan.autoReplan || fullAuto || hasPlaceholderSteps);
      const maxRetries = Number.isFinite(Number(body.maxRetries)) && body.maxRetries > 0 ? body.maxRetries
        : (Number.isFinite(Number(plan.maxRetries)) && plan.maxRetries > 0 ? plan.maxRetries
          : (autoReplan ? 1 : 0));
      const result = await runPlan(plan, {
        cwd,
        workflowManager: wf,
        roundtableFn: buildRoundtableFn(runtime),
        execId,
        requestApproval,
        // 个性化「权限设置」下钻（来自前端 localStorage）
        permissions: perms,
        // 全自动 Phase 1 接线
        runtimeIntercept: !!(body.runtimeIntercept || plan.runtimeIntercept || fullAuto || process.env.HESI_PLAN_RUNTIME_INTERCEPT === '1'),
        plannerRuntime: runtime,
        revisePlanFn: revisePlan,
        maxRetries,
        // 执行默认 Agent：前端可自选（body.agentId）；未选则圆桌式默认 'ai'
        // （AI 助手 LLM 工具环，不重新实现）。
        executorAgentId: resolveExecutorAgentId(body),
      });
      // ③ RAG 快照回流（跑通即沉淀，失败不影响主流程）
      if (result.ok) {
        try { sinkPlanToIndex(plan, result); } catch { /* RAG 回流失败不影响主流程 */ }
      }
      const p = pendingApprovals.get(execId);
      if (p) { clearTimeout(p.timer); pendingApprovals.delete(execId); }
      return res.json({ ok: result.ok, execId, ...result });
    } catch (e) {
      const p = pendingApprovals.get(execId);
      if (p) { clearTimeout(p.timer); pendingApprovals.delete(execId); }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 审批闸：人工通过
  router.post('/:execId/approve', (req, res) => {
    const p = pendingApprovals.get(req.params.execId);
    if (!p) return res.status(404).json({ ok: false, error: '无待审批项（已结束或超时）' });
    clearTimeout(p.timer);
    pendingApprovals.delete(req.params.execId);
    broadcast({ type: 'plan:approval-resolved', execId: req.params.execId, approved: true });
    p.resolve(true);
    res.json({ ok: true });
  });

  // 审批闸：人工驳回
  router.post('/:execId/reject', (req, res) => {
    const p = pendingApprovals.get(req.params.execId);
    if (!p) return res.status(404).json({ ok: false, error: '无待审批项（已结束或超时）' });
    clearTimeout(p.timer);
    pendingApprovals.delete(req.params.execId);
    broadcast({ type: 'plan:approval-resolved', execId: req.params.execId, approved: false });
    p.resolve(false);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createRouter, buildRoundtableFn, resolveExecutorAgentId };
