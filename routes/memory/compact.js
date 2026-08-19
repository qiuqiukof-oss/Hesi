/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// POST /api/memory/compact — manually trigger compaction for a session.
// In M2 compactIfNeeded is a no-op stub (wired for real in M5).
'use strict';

const express = require('express');
const MemoryStore = require('../../lib/memory');

const router = express.Router();

router.post('/', async (req, res) => {
  const { sessionId, apiKey, provider, model } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: '"sessionId" is required' });
  const result = await MemoryStore.compactIfNeeded(sessionId, { apiKey, provider, model });
  res.json({ ok: true, ...result });
});

module.exports = router;
