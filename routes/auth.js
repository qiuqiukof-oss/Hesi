/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Auth API (A1) — login / logout / me / user admin / SSO bootstrap
// Mounted at /api/auth
// ============================================================
const express = require('express');
const accounts = require('../lib/auth/accounts');
const session = require('../lib/auth/session');
const telemetry = require('../lib/telemetry');
const idp = require('../lib/auth/idp');
const { AUTH_MODE } = require('../lib/config');

function createRouter() {
  const router = express.Router();
  accounts.ensureBootstrap();

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = accounts.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = session.createSession(user);
    telemetry.track('login', { user: user.id, feature: 'auth' });
    res.json({ token, user });
  });

  // POST /api/auth/logout
  router.post('/logout', session.requireAuth, (req, res) => {
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', session.requireAuth, (req, res) => {
    res.json({ user: req.user, mode: AUTH_MODE });
  });

  // POST /api/auth/bootstrap — create the first admin (local mode only)
  router.post('/bootstrap', (req, res) => {
    if (accounts.listUsers().length > 0) return res.status(409).json({ error: 'accounts already exist' });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    accounts.createUser({ username, password, role: 'admin' })
      .then((user) => {
        const token = session.createSession(user);
        res.json({ token, user });
      })
      .catch((e) => res.status(400).json({ error: e.message }));
  });

  // Admin: list users
  router.get('/users', session.requireAuth, session.requireRole('users:read'), (req, res) => {
    res.json({ users: accounts.listUsers() });
  });

  // Admin: create user
  router.post('/users', session.requireAuth, session.requireRole('users:write'), (req, res) => {
    const { username, password, role } = req.body || {};
    accounts.createUser({ username, password, role: role || 'user' })
      .then((u) => {
        res.json({ user: u });
      })
      .catch((e) => res.status(400).json({ error: e.message }));
  });

  // Admin: set role
  router.post('/users/:id/role', session.requireAuth, session.requireRole('users:write'), (req, res) => {
    const u = accounts.updateRole(req.params.id, req.body.role);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json({ user: u });
  });

  // SSO: list providers / begin / callback
  router.get('/sso/providers', (req, res) => res.json({ providers: idp.listProviders() }));
  router.get('/sso/:provider/begin', (req, res) => {
    try { res.json(idp.beginAuth(req.params.provider, req.query.redirect_uri || '')); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  router.post('/sso/:provider/callback', async (req, res) => {
    try { res.json(await idp.handleCallback(req.params.provider, req.body.code)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  return router;
}

module.exports = { createRouter };
