/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Metrics API (C2) — growth / adoption aggregates for the admin dashboard
// Mounted at /api/metrics
// ============================================================
const express = require('express');
const audit = require('../lib/audit');
const telemetry = require('../lib/telemetry');
const license = require('../lib/license');
const session = require('../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/metrics — admin only
  router.get('/', session.requireAuth, session.requireRole('metrics:read'), (req, res) => {
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    const recent = audit.query({ since: since7 });
    const byType = {};
    for (const r of recent) byType[r.type] = (byType[r.type] || 0) + 1;
    const pty = recent.filter((r) => r.type === 'pty_command');
    const uploads = recent.filter((r) => r.type === 'file_upload');
    res.json({
      mode: license.resolveMode(),
      capabilities: license.status().capabilities,
      audit: {
        eventsLast7d: recent.length,
        byType,
        ptyCommands: pty.length,
        uploads: uploads.length,
      },
      telemetry: telemetry.snapshot(),
    });
  });

  return router;
}

module.exports = { createRouter };
