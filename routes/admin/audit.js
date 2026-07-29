/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Admin Audit API (A2) — query + export the unified audit trail
// Mounted at /api/admin/audit
// ============================================================
const express = require('express');
const audit = require('../../lib/audit');
const session = require('../../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/admin/audit?type=&user=&since=&limit=
  router.get('/', session.requireAuth, session.requireRole('audit:read'), (req, res) => {
    const { type, user, since, limit } = req.query;
    const rows = audit.query({
      type: typeof type === 'string' ? type : undefined,
      user: typeof user === 'string' ? user : undefined,
      since: typeof since === 'string' ? since : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ count: rows.length, events: rows });
  });

  // GET /api/admin/audit/export?type=&since=  → CSV
  router.get('/export', session.requireAuth, session.requireRole('audit:export'), (req, res) => {
    const { type, since } = req.query;
    const csv = audit.exportCsv({
      type: typeof type === 'string' ? type : undefined,
      since: typeof since === 'string' ? since : undefined,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hesi-audit.csv"');
    res.send(csv);
  });

  return router;
}

module.exports = { createRouter };
