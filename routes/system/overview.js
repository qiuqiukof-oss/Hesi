/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// System Route — system overview (disk + network IO)
//
// GET /api/system/overview — Disk usage & network IO stats
//
// Shared state/helpers come from ./monitoring (imported by reference so
// mutations stay visible across modules).
// ============================================================
const express = require('express');
const {
  _netIoState,
  _pollNetworkIOAsync,
  _getDiskUsageAsync,
} = require('./monitoring');

/**
 * Create the system-overview sub-router.
 * @param {object} [_activePTYs] — accepted for signature parity, unused here.
 * @returns {import('express').Router}
 */
function createOverviewRouter(_activePTYs) {
  const router = express.Router();

  // ── GET /api/system/overview ───────────────────────────
  router.get('/system/overview', async (req, res) => {
    // Refresh network IO counters (async — non-blocking)
    await _pollNetworkIOAsync();

    // Disk usage (async)
    const disks = await _getDiskUsageAsync();

    // Network IO
    const netIo = {
      rxBytes: _netIoState.rxBytes,
      txBytes: _netIoState.txBytes,
      rxPerSec: _netIoState.rxPerSec,
      txPerSec: _netIoState.txPerSec,
      cumulativeRx: _netIoState.cumulativeRx,
      cumulativeTx: _netIoState.cumulativeTx,
    };

    res.json({
      success: true,
      disks,
      netIo,
      ts: Date.now(),
    });
  });

  return router;
}

module.exports = { createOverviewRouter };
