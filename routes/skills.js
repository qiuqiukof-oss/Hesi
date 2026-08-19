/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Skills Router — expose ingested WorkBuddy skills as a
// native, queryable part of Hesi (no external links).
// ============================================================
const express = require('express');
const skillRegistry = require('../skills/registry');

function createRouter() {
  const router = express.Router();

  // List all ingested skills (with optional ?category= filter)
  router.get('/', (req, res) => {
    try {
      let skills = skillRegistry.list();
      if (req.query.category) {
        skills = skills.filter((s) => (s.category || '技能') === req.query.category);
      }
      res.json({ ok: true, skills, categories: skillRegistry.categories() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Re-scan the local WorkBuddy cache and rebuild the catalog
  router.post('/ingest', (req, res) => {
    try {
      const catalog = skillRegistry.reingest();
      res.json({ ok: true, count: catalog.skills.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Get one skill (includes full body)
  router.get('/:id', (req, res) => {
    try {
      const s = skillRegistry.get(req.params.id);
      if (!s) return res.status(404).json({ ok: false, error: 'skill not found' });
      res.json({ ok: true, skill: s });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Add/override a skill (native authoring)
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      if (!body.id || !body.name) return res.status(400).json({ ok: false, error: 'id and name required' });
      const skill = skillRegistry.addSkill({
        id: String(body.id),
        name: body.name,
        description: body.description || '',
        descriptionEn: body.descriptionEn || '',
        version: body.version || '',
        author: body.author || 'Hesi',
        category: body.category || '自定义',
        body: body.body || '',
        source: 'custom',
      });
      res.json({ ok: true, skill });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
