// ============================================================
// Telemetry API (C1) — status, opt-in toggle, local snapshot
// Mounted at /api/telemetry
// ============================================================
const express = require('express');
const telemetry = require('../lib/telemetry');
const session = require('../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/telemetry — current status + aggregate snapshot (admin)
  router.get('/', session.requireAuth, session.requireRole('metrics:read'), (req, res) => {
    res.json({ enabled: telemetry.isEnabled(), snapshot: telemetry.snapshot() });
  });

  // POST /api/telemetry/enable
  router.post('/enable', session.requireAuth, session.requireRole('admin:all'), (req, res) => {
    const on = telemetry.setEnabled(true);
    res.json({ enabled: on });
  });

  // POST /api/telemetry/disable
  router.post('/disable', session.requireAuth, session.requireRole('admin:all'), (req, res) => {
    const off = telemetry.setEnabled(false);
    res.json({ enabled: off });
  });

  // POST /api/telemetry/client — accept client-side telemetry (first-paint, errors).
  // Local-only: logged server-side; nothing is transmitted externally.
  // Global apiLimiter (600/min) applies to all /api/* except chat.
  router.post('/client', (req, res) => {
    const body = req.body || {};
    const { kind, value, message, stack, url } = body;
    if (!kind || typeof kind !== 'string') {
      return res.status(400).json({ error: 'kind (string) required' });
    }
    const entry = { t: new Date().toISOString(), kind, value, message, url };
    // eslint-disable-next-line no-console
    console.log('[telemetry:client]', JSON.stringify(entry));
    if (telemetry.isEnabled()) telemetry.track('client_' + kind, { feature: kind });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createRouter };
