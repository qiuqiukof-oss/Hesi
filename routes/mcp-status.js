/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// /api/mcp/status — report MCP runtime status for the dashboard.
//
// Surfaces whether the MCP sub-process (started via --with-mcp) is
// running, plus its PID / uptime / restart count / metric count.
// This gives the Dashboard MCP panel real data instead of an
// always-empty metrics view. No secrets (token) are returned.
// ============================================================
const express = require('express');

/**
 * @param {object} opts
 * @param {() => object|null} opts.ensureMCPManager - returns the live MCPProcessManager (lazy)
 * @param {boolean} opts.withMcp - whether --with-mcp / QCLI_WITH_MCP=1 was requested
 */
function createMcpStatusRouter({ ensureMCPManager, withMcp } = {}) {
  const router = express.Router();

  router.get('/mcp/status', (req, res) => {
    if (!withMcp || typeof ensureMCPManager !== 'function') {
      return res.json({
        enabled: false,
        running: false,
        message: 'MCP 未启用。用 `npm start -- --with-mcp`（或 QCLI_WITH_MCP=1）启动以启用 MCP 子进程。',
      });
    }

    const mgr = ensureMCPManager();
    if (!mgr) {
      return res.json({ enabled: true, running: false, message: 'MCP 管理器未就绪' });
    }

    const running = mgr.isRunning === true;
    const status = typeof mgr.getStatus === 'function' ? mgr.getStatus() : {};

    res.json({
      enabled: true,
      running,
      pid: status.pid ?? null,
      uptimeMs: status.uptimeMs ?? 0,
      restartCount: status.restartCount ?? 0,
      metricCount: status.metricCount ?? 0,
      stdoutBytes: status.stdoutBytes ?? 0,
      stderrBytes: status.stderrBytes ?? 0,
    });
  });

  return router;
}

module.exports = createMcpStatusRouter;
