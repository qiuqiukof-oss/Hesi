/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Browser Control Route — thin aggregator
//
// The previous monolithic ~1900-line routes/browser.js has been decomposed
// into focused sub-routers under routes/browser/ that share a single
// BrowserManager singleton (routes/browser/manager.js). This file only
// composes those sub-routers into one Express router so the public
// interface — module.exports = { createRouter, browserManager } — stays
// byte-for-byte compatible with routes/index.js and any other consumer.
//
// Sub-routers each define their own absolute path (e.g. /browser/navigate),
// so they are mounted WITHOUT a path prefix (router.use(subRouter)) to keep
// the final path under /api/browser/*.
// ============================================================
const express = require('express');

// ── Sub-routers (each returns a fresh express.Router) ──
const createConnectRouter = require('./browser/routes-connect');   // ping, connect
const createActionsRouter = require('./browser/routes-actions');   // navigate, click, type, screenshot, tabs, switch-tab, back, refresh, text
const createEvaluateRouter = require('./browser/routes-evaluate'); // evaluate
const createConsoleRouter = require('./browser/routes-console');   // console
const createDisconnectRouter = require('./browser/routes-disconnect'); // disconnect
const createNetworkRouter = require('./browser/routes-network');   // network
const createInfoRouter = require('./browser/routes-info');         // info
const createFarmRouter = require('./browser/routes-farm');         // farm/contexts, farm/create, farm/switch, farm/close
const createDomRouter = require('./browser/routes-dom');           // dom-snapshot, dom-diff
const createFormsRouter = require('./browser/routes-forms');       // detect-forms, fill-forms
const createA11yRouter = require('./browser/routes-a11y');         // accessibility

// ── Shared singleton (used by browser-scripts.js injection + tests) ──
const { browserManager } = require('./browser/manager');

/**
 * Compose all browser sub-routers into a single Express router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  router.use(createConnectRouter());
  router.use(createActionsRouter());
  router.use(createEvaluateRouter());
  router.use(createConsoleRouter());
  router.use(createDisconnectRouter());
  router.use(createNetworkRouter());
  router.use(createInfoRouter());
  router.use(createFarmRouter());
  router.use(createDomRouter());
  router.use(createFormsRouter());
  router.use(createA11yRouter());

  return router;
}

module.exports = { createRouter, browserManager };
