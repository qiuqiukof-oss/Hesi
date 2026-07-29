/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// System Route — Process Resource Monitoring & System Overview
//
// GET /api/system/process-stats  — CPU/MEM per running PTY process
// GET /api/system/process-detail — on-demand detail for a single PID
// POST /api/system/kill-process   — terminate a PID
// GET /api/system/overview        — Disk usage & network IO stats
//
// This file is the router aggregator. Shared monitoring state/helpers
// live in ./system/monitoring.js; the route groups live in
// ./system/process.js and ./system/overview.js.
// ============================================================
const express = require('express');

const { createProcessRouter } = require('./system/process');
const { createOverviewRouter } = require('./system/overview');

/**
 * Create the system router.
 * Accepts the activePTYs Map from ws-handler for process inspection.
 *
 * @param {Map<WebSocket, Map<string, {pty: object, cliId: string, name: string}>>} activePTYs
 * @returns {express.Router}
 */
function createRouter(activePTYs) {
  const router = express.Router();
  router.use(createProcessRouter(activePTYs));
  router.use(createOverviewRouter(activePTYs));
  return router;
}

module.exports = { createRouter };
