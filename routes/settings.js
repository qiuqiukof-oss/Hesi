/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Settings API — Export/import configuration for backup
// ============================================================
const express = require('express');
const { loadRegistry, saveRegistry } = require('../cli-discovery');

/**
 * Create the settings router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  /**
   * GET /api/settings — Export all config as JSON.
   * Returns registry + folders data for backup/download.
   */
  router.get('/settings', (req, res) => {
    try {
      const registry = loadRegistry();

      // Folders are stored inside cli-registry.json as registry.folders
      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        registry,
        folders: registry.folders || [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/settings/import — Import config from uploaded JSON.
   * Replaces registry and folders with the imported data.
   */
  router.post('/settings/import', (req, res) => {
    try {
      const data = req.body;
      if (!data || !data.registry) {
        return res.status(400).json({ error: 'Invalid settings file: missing registry' });
      }

      // Save registry (folders are stored inside cli-registry.json as registry.folders)
      if (data.folders) {
        data.registry.folders = data.folders;
      }
      saveRegistry(data.registry);

      res.json({ success: true, message: 'Settings imported successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/settings/env — Get environment variables safe list.
   */
  router.get('/settings/env', (req, res) => {
    const safeVars = {};
    const sensitivePatterns = [
      /^API_KEY/i, /^TOKEN/i, /^SECRET/i, /^PASSWORD/i, /^AUTH/i,
      /^JWT/i, /^COOKIE/i, /^SESSION/i, /^PRIVATE_KEY/i,
    ];

    for (const [key, value] of Object.entries(process.env)) {
      const isSensitive = sensitivePatterns.some(p => p.test(key));
      if (!isSensitive && typeof value === 'string' && value.length < 200) {
        safeVars[key] = value;
      }
    }

    res.json({ env: safeVars, count: Object.keys(safeVars).length });
  });

  return router;
}

module.exports = { createRouter };
