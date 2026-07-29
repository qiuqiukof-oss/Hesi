/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Folder CRUD Routes
// ============================================================
const express = require('express');
const { loadRegistry, saveRegistry } = require('../cli-discovery');

/**
 * Create an Express router for folder CRUD operations.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // List all folders
  // ──────────────────────────────────────────────
  router.get('/folders', (req, res) => {
    const registry = loadRegistry();
    res.json(registry.folders || []);
  });

  // ──────────────────────────────────────────────
  // Create folder
  // ──────────────────────────────────────────────
  router.post('/folders', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const registry = loadRegistry();
    if (!registry.folders) registry.folders = [];

    const id = `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')  }-${  Date.now()}`;

    const folder = {
      id,
      name: name.trim(),
      cliIds: [],
      collapsed: false,
    };

    registry.folders.push(folder);
    saveRegistry(registry);
    res.status(201).json(folder);
  });

  // ──────────────────────────────────────────────
  // Update folder (name, cliIds, collapsed state)
  // ──────────────────────────────────────────────
  router.put('/folders/:id', (req, res) => {
    const registry = loadRegistry();
    if (!registry.folders) registry.folders = [];

    const idx = registry.folders.findIndex(f => f.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const { name, cliIds, collapsed } = req.body;
    if (name !== undefined) registry.folders[idx].name = name;
    if (cliIds !== undefined) {
      // Validate cliIds is an array of strings to prevent registry corruption
      if (!Array.isArray(cliIds) || !cliIds.every(id => typeof id === 'string')) {
        return res.status(400).json({ error: 'cliIds must be an array of strings' });
      }
      registry.folders[idx].cliIds = cliIds;
    }
    if (collapsed !== undefined) registry.folders[idx].collapsed = collapsed;

    saveRegistry(registry);
    res.json(registry.folders[idx]);
  });

  // ──────────────────────────────────────────────
  // Delete folder
  // ──────────────────────────────────────────────
  router.delete('/folders/:id', (req, res) => {
    const registry = loadRegistry();
    if (!registry.folders) registry.folders = [];

    const idx = registry.folders.findIndex(f => f.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    registry.folders.splice(idx, 1);
    saveRegistry(registry);
    res.json({ success: true });
  });

  return router;
}

module.exports = { createRouter };
