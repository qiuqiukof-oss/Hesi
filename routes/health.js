/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Health Route — GET /health
//
// Mounted at /health (not /api/health) so it bypasses the global
// apiLimiter. Aggregates system stats: version, uptime, memory,
// CLI registry counts, WebSocket status, CDP connection state.
// Used by dashboard and MCP resource qcli://health.
// ============================================================
const express = require('express');

// 复用浏览器管理单例，真实反映 CDP 连接状态（之前写死为 false）。
const { browserManager } = require('./browser/manager');

/**
 * Create the health router.
 * Accepts optional references to ws-handler for live WS stats.
 * @param {{ wss?: { clients?: { size: number } } }} [wsManager] — WebSocket server manager
 * @returns {express.Router}
 */
function createRouter(wsManager) {
  const router = express.Router();
  const startTime = Date.now();

  // Lazy require to avoid circular deps
  let cliDiscovery = null;
  function getCLIRegistry() {
    if (!cliDiscovery) {
      try { cliDiscovery = require('../cli-discovery'); } catch (e) { return null; }
    }
    return cliDiscovery;
  }

  // ── GET /health (mounted at /health) ───────────────────
  router.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();

    // CLI registry stats
    const registry = getCLIRegistry();
    const cliStats = { total: 0, agent: 0, tool: 0, env: 0 };
    if (registry) {
      try {
        const reg = registry.loadRegistry();
        const clis = reg.clis || [];
        cliStats.total = clis.length;
        for (const cli of clis) {
          const cat = (cli.category || 'tool').toLowerCase();
          if (cat === 'agent') cliStats.agent++;
          else if (cat === 'directory' || cat === 'env') cliStats.env++;
          else cliStats.tool++;
        }
      } catch (e) { /* registry not ready */ }
    }

    // WebSocket status
    const wsInfo = { connected: false, activeSessions: 0 };
    if (wsManager) {
      try {
        const wss = wsManager.wss;
        if (wss) {
          wsInfo.connected = true;
          wsInfo.activeSessions = wss.clients?.size || 0;
        }
      } catch (e) { /* ws not ready */ }
    }

    // CDP status — 真实反映浏览器管理单例的连接状态
    const cdpConnected = !!(
      browserManager &&
      browserManager.connected &&
      browserManager.browser &&
      typeof browserManager.browser.isConnected === 'function' &&
      browserManager.browser.isConnected()
    );
    const cdp = {
      connected: cdpConnected,
      browser: (cdpConnected && browserManager.browser && typeof browserManager.browser.version === 'function')
        ? browserManager.browser.version()
        : null,
      url: browserManager ? browserManager.cdpUrl : null,
    };

    res.json({
      version: process.env.npm_package_version || '0.1.0',
      uptime,
      node: process.version,
      platform: process.platform,
      memory: {
        rss: Math.round(mem.rss / 1048576),
        heap: Math.round(mem.heapUsed / 1048576),
      },
      clis: cliStats,
      ws: wsInfo,
      cdp,
    });
  });

  return router;
}

module.exports = { createRouter };
