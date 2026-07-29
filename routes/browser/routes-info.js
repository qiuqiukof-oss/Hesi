/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: /browser/info (detailed status).
// Handler copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');

function createInfoRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // GET /api/browser/info — 详细的浏览器状态信息
  // 供 AI Agent 感知完整的浏览器环境。
  // ──────────────────────────────────────────────
  router.get('/browser/info', async (req, res) => {
    try {
      await browserManager.ensureConnected().catch(() => {});

      if (!browserManager.connected || !browserManager.browser?.isConnected()) {
        return res.json({
          connected: false,
          message: '未连接到浏览器。请先调用 POST /api/browser/connect',
        });
      }

      const version = browserManager.browser.version() || 'unknown';
      const context = browserManager.browser.contexts()[0];
      const pages = context?.pages() || [];

      // 收集标签页信息
      const tabs = [];
      for (let i = 0; i < pages.length; i++) {
        try {
          const p = pages[i];
          tabs.push({
            index: i,
            url: p.url(),
            title: await p.title().catch(() => ''),
            ready: await p.evaluate(() => document.readyState === 'complete').catch(() => false),
          });
        } catch (e) { console.warn('[Browser] Failed to evaluate page readyState:', e?.message); }
      }

      // 获取运行时性能（仅浏览器端内存）
      let performance = null;
      try {
        const activePage = pages.find(p => !p.url().startsWith('about:')) || pages[0];
        if (activePage) {
          performance = await activePage.evaluate(() => ({
            jsHeapSizeLimit: (performance?.memory?.jsHeapSizeLimit || 0),
            totalJSHeapSize: (performance?.memory?.totalJSHeapSize || 0),
            usedJSHeapSize: (performance?.memory?.usedJSHeapSize || 0),
          })).catch(() => null);
        }
      } catch (e) { console.warn('[Browser] Failed to capture page screenshot:', e?.message); }

      res.json({
        connected: true,
        browser: version,
        tabCount: tabs.length,
        tabs,
        platform: {
          os: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
        },
        performance,
        cdpUrl: browserManager.cdpUrl,
      });
    } catch (err) {
      res.status(500).json({ connected: false, error: err.message });
    }
  });

  return router;
}

module.exports = createInfoRouter;
