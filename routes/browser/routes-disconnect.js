/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: /browser/disconnect.
// Handler copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');

function createDisconnectRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/browser/disconnect — 断开连接
  // ──────────────────────────────────────────────
  router.post('/browser/disconnect', async (req, res) => {
    try {
      await browserManager.disconnect();
      res.json({ success: true, connected: false });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createDisconnectRouter;
