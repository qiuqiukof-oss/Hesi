/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// POST /api/memory/recall — debug / drawer endpoint: what would be injected
// for a given query. Returns the <memory> block (or null).
'use strict';

const express = require('express');
const MemoryStore = require('../../lib/memory');

const router = express.Router();

router.post('/', (req, res) => {
  const { query, topK } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: '"query" (string) is required' });
  }
  const block = MemoryStore.recall(query, { topK: topK ? Number(topK) : undefined });
  res.json({ block });
});

module.exports = router;
