/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: /browser/console (console log capture).
// Handler copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');

function createConsoleRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/browser/console — 获取浏览器 console 日志
  // ──────────────────────────────────────────────
  router.post('/browser/console', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();
      // Inject console capture if not already present
      await page.evaluate(() => {
        if (window.__mcpConsoleCaptureInjected) return;
        window.__mcpConsoleLogs = [];
        const methods = ['log', 'warn', 'error', 'info', 'debug'];
        for (const method of methods) {
          const original = console[method];
          console[method] = function (...args) {
            window.__mcpConsoleLogs.push({
              method,
              text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
              time: Date.now(),
            });
            if (window.__mcpConsoleLogs.length > 200) {
              window.__mcpConsoleLogs.splice(0, window.__mcpConsoleLogs.length - 200);
            }
            return original.apply(console, args);
          };
        }
        window.__mcpConsoleCaptureInjected = true;
      }).catch(() => {});

      // Now get the captured logs
      const entries = await page.evaluate(() => {
        return (window.__mcpConsoleLogs || []).slice(-100);
      }).catch(() => []);

      res.json({
        success: true,
        entries,
        count: entries.length,
        note: entries.length === 0 ? 'Console capture injected. Logs will appear after page activity.' : undefined,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createConsoleRouter;
