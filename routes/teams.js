/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Team Workspaces API (B2) — foundational CRUD
// Mounted at /api/workspaces
// ============================================================
const express = require('express');
const teams = require('../lib/teams');
const session = require('../lib/auth/session');

function createRouter() {
  const router = express.Router();

  // GET /api/workspaces — workspaces the caller belongs to
  router.get('/', session.requireAuth, (req, res) => {
    const list = teams.listWorkspacesForUser(req.user && req.user.id);
    res.json({ workspaces: list });
  });

  // POST /api/workspaces — create (caller becomes owner)
  router.post('/', session.requireAuth, (req, res) => {
    const { name } = req.body || {};
    try {
      const ws = teams.createWorkspace({ name, ownerId: req.user && req.user.id });
      res.json({ workspace: ws });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /api/workspaces/:id/members — add a member (owner/admin)
  router.post('/:id/members', session.requireAuth, (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      const ws = teams.addMember(req.params.id, userId);
      res.json({ workspace: ws });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
