/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Connectors Router
// Exposes imported WorkBuddy connectors as manageable,
// callable MCP clients within Hesi.
// ============================================================
const express = require('express');
const hub = require('../mcp/hub');

function createRouter() {
  const router = express.Router();

  // List all imported connectors (with live status/tool counts)
  router.get('/', (req, res) => {
    try {
      res.json({ ok: true, connectors: hub.list() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // List importable connectors from the local WorkBuddy cache
  router.get('/available', (req, res) => {
    try {
      res.json({ ok: true, available: hub.availableFromCache() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Import from local WorkBuddy cache by source id
  router.post('/import', async (req, res) => {
    try {
      const { sourceId, env, enabled } = req.body || {};
      if (!sourceId) return res.status(400).json({ ok: false, error: 'sourceId is required' });
      const rec = hub.importFromCache(sourceId, { env: env || {}, enabled: !!enabled });
      res.json({ ok: true, connector: rec });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Import from a raw mcp.json payload
  router.post('/import-raw', async (req, res) => {
    try {
      const { id, name, serverName, entry, mcpConfig, env, enabled } = req.body || {};
      if (!mcpConfig && !(serverName && entry)) {
        return res.status(400).json({ ok: false, error: 'mcpConfig or (serverName+entry) required' });
      }
      const rec = hub.importRaw({ id, name, serverName, entry: entry || mcpConfig, env: env || {}, enabled: !!enabled });
      res.json({ ok: true, connector: rec });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // Remove a connector
  router.delete('/:id', (req, res) => {
    try {
      hub.remove(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Connect (and cache tools)
  router.post('/:id/connect', async (req, res) => {
    try {
      const info = await hub.connect(req.params.id);
      res.json({ ok: true, connector: info });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message, id: req.params.id });
    }
  });

  // Disconnect
  router.post('/:id/disconnect', (req, res) => {
    try {
      hub.disconnect(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // List tools (connects if needed)
  router.get('/:id/tools', async (req, res) => {
    try {
      const tools = await hub.listTools(req.params.id);
      res.json({ ok: true, tools });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // Call a tool (connects if needed)
  router.post('/:id/call', async (req, res) => {
    try {
      const { name, arguments: args } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, error: 'tool name required' });
      const result = await hub.callTool(req.params.id, name, args || {});
      res.json({ ok: true, result });
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
