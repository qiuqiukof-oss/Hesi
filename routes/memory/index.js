/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Memory API router aggregator. Mounted at /api/memory by routes/index.js.
'use strict';

const express = require('express');
const sessionsRouter = require('./sessions');
const recallRouter = require('./recall');
const compactRouter = require('./compact');
const factsRouter = require('./facts');
const MemoryStore = require('../../lib/memory');

function createMemoryRouter() {
  const router = express.Router();
  router.get('/health', (req, res) => res.json({ ok: true, enabled: MemoryStore.enabled }));

  // Import a legacy (pre-memory) message list as the first session.
  // Body: { messages: [{role, content, ...}], meta? }
  router.post('/import', (req, res) => {
    const { messages, meta } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: '"messages" (non-empty array) is required' });
    }
    MemoryStore.importLegacy(messages, meta || {})
      .then((s) => res.status(201).json({ id: s.id, title: s.title }))
      .catch((e) => res.status(500).json({ error: e.message }));
  });

  router.use('/sessions', sessionsRouter);
  router.use('/recall', recallRouter);
  router.use('/compact', compactRouter);
  router.use('/facts', factsRouter);
  return router;
}

module.exports = { createMemoryRouter };
