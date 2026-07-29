/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Rate Limiter Stats — expose real-time throttling metrics
// ============================================================
const express = require('express');
const { getAllRateLimiterStats } = require('../rate-limiter');

/**
 * Create the rate-limiter stats router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  /**
   * GET /api/rate-limit-stats
   *
   * Returns aggregated stats from all registered rate limiter instances.
   * Used by the frontend rate-limit-panel to display real-time metrics.
   *
   * Response:
   *   { "limiters": [...], "ts": 1234567890 }
   */
  router.get('/rate-limit-stats', (req, res) => {
    const stats = getAllRateLimiterStats();
    res.json({
      limiters: stats,
      ts: Date.now(),
    });
  });

  return router;
}

module.exports = { createRouter };
