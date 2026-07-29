/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// License API (B1) — capability status + activation
// Mounted at /api/license
// ============================================================
const express = require('express');
const license = require('../lib/license');
const session = require('../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/license/status
  router.get('/status', session.requireAuth, (req, res) => {
    res.json(license.status());
  });

  // POST /api/license/activate  (admin)
  router.post('/activate', session.requireAuth, session.requireRole('admin:all'), (req, res) => {
    try {
      const status = license.activate(req.body && req.body.key);
      res.json({ ok: true, status });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
