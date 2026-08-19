/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// GET/DELETE /api/memory/facts — view and forget long-term facts (Layer A).
// Reads/writes facts.json directly; extraction itself lands in M6 (profile.js).
'use strict';

const express = require('express');
const config = require('../../lib/memory/config');
const storage = require('../../lib/memory/storage');

const router = express.Router();

router.get('/', (req, res) => {
  const facts = storage.readJSON(config.FACTS_FILE, []);
  const profile = storage.readJSON(config.PROFILE_FILE, null) || '';
  res.json({ facts, profile });
});

router.delete('/:id', (req, res) => {
  const facts = storage.readJSON(config.FACTS_FILE, []);
  const next = facts.filter((f) => f.id !== req.params.id);
  storage.writeJSON(config.FACTS_FILE, next);
  res.json({ ok: true, removed: facts.length - next.length });
});

module.exports = router;
