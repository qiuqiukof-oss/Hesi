// ============================================================
// Blackboard routes — 共享黑板只读观测端点（Phase 1 S8）
//
//   GET /api/blackboard/:projectId          → 黑板完整状态 JSON
//   GET /api/blackboard/:projectId?since=N  → version 未变时返回 { unchanged:true }
//
// 只读：可视化面板（public/blackboard.html）轮询用。
// 写入一律走 AI 工具 blackboard_patch / workflow 步骤钩子，
// 本路由不提供任何修改能力。
// ============================================================

const express = require('express');
const blackboard = require('../lib/blackboard');

function createRouter() {
  const router = express.Router();

  router.get('/:projectId', (req, res) => {
    try {
      const projectId = String(req.params.projectId || 'default');
      const state = blackboard.read(projectId);

      if (!state) {
        return res.json({ ok: true, exists: false, projectId, state: null });
      }

      // 轻量轮询：版本未变则省带宽
      const since = req.query.since !== undefined ? Number(req.query.since) : NaN;
      if (Number.isFinite(since) && state.version === since) {
        return res.json({ ok: true, unchanged: true, version: state.version });
      }

      return res.json({ ok: true, exists: true, projectId, state });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
