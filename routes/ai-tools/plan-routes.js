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
const { runPlan, parseVerifyFromSummary } = require('./run-plan');
const { workflowManager } = require('./workflow-manager');
const { runRoundtable } = require('../chat/discuss');

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
        transcript: transcript ? [{ role: 'user', content: transcript }] : [],
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
 * @param {{ cwd?: string, workflowManager?: object }} [opts]
 * @returns {express.Router}
 */
function createRouter(opts = {}) {
  const router = express.Router();
  const cwd = opts.cwd || process.cwd();
  const wf = opts.workflowManager || workflowManager;

  router.post('/execute', async (req, res) => {
    const body = req.body || {};
    const plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
    if (!plan) {
      return res.status(400).json({ ok: false, error: '缺少 plan 对象（body.plan）' });
    }
    const runtime = {
      apiKey: body.apiKey,
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      partner: body.partner,
      partners: body.partners,
    };
    try {
      const result = await runPlan(plan, {
        cwd,
        workflowManager: wf,
        roundtableFn: buildRoundtableFn(runtime),
      });
      return res.json({ ok: result.ok, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter, buildRoundtableFn };
