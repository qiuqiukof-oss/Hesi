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
const { generatePlanFromObjective } = require('./plan-from-nl');

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
  // 审批超时（默认 30min）；测试可注入极小值以覆盖超时路径
  const approvalTimeoutMs = Number.isFinite(opts.approvalTimeoutMs) && opts.approvalTimeoutMs > 0
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
      const result = await runPlan(plan, {
        cwd,
        workflowManager: wf,
        roundtableFn: buildRoundtableFn(runtime),
        execId,
        requestApproval,
        // 个性化「权限设置」下钻（来自前端 localStorage）
        permissions: (body.permissions && typeof body.permissions === 'object') ? body.permissions : null,
      });
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

module.exports = { createRouter, buildRoundtableFn };
