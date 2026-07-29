/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Workspace route — get / set the global working directory.
// The workspace drives the default cwd of new terminals and
// AI tool exec / file ops (see lib/workspace.js).
// ============================================================
const express = require('express');
const { getWorkspace, setWorkspace } = require('../lib/workspace');

/**
 * Create an Express router for workspace endpoints.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // GET /api/workspace → current workspace directory
  router.get('/workspace', (req, res) => {
    res.json({ workspace: getWorkspace() });
  });

  // POST /api/workspace  Body: { dir }
  // Sets the global workspace. Requires a valid access token off-loopback
  // (mounted under requireToken in routes/index.js).
  router.post('/workspace', (req, res) => {
    const { dir } = (req.body || {});
    if (!dir || typeof dir !== 'string' || dir.trim().length === 0) {
      return res.status(400).json({ error: 'dir is required (absolute or relative path)' });
    }
    try {
      const abs = setWorkspace(dir);
      return res.json({ workspace: abs });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
