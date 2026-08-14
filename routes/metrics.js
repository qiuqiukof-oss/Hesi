/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Metrics API (C2) — growth / adoption aggregates for the admin dashboard
// Mounted at /api/metrics
// ============================================================
const express = require('express');
const telemetry = require('../lib/telemetry');
const session = require('../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/metrics — admin only
  router.get('/', session.requireAuth, session.requireRole('metrics:read'), (req, res) => {
    res.json({
      mode: 'personal',
      capabilities: {},
      audit: {
        eventsLast7d: 0,
        byType: {},
        ptyCommands: 0,
        uploads: 0,
      },
      telemetry: telemetry.snapshot(),
    });
  });

  return router;
}

module.exports = { createRouter };
