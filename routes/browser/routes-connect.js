/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: connection + health (ping, connect).
// Handlers are copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const { DEFAULT_CDP_URL } = require('./helpers');

function createConnectRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // GET /api/browser/ping — 健康检查 + 状态
  // ──────────────────────────────────────────────
  router.get('/browser/ping', async (req, res) => {
    try {
      await browserManager.ensureConnected().catch(() => {
        // 未连接不算错，如实返回
      });

      if (!browserManager.connected || !browserManager.browser?.isConnected()) {
        return res.json({
          connected: false,
          message: '未连接到浏览器。请先确保 Edge/Chrome 已用 --remote-debugging-port=9222 启动，然后调用 POST /api/browser/connect',
          cdpUrl: browserManager.cdpUrl,
        });
      }

      const page = await browserManager.getActivePage().catch(() => null);
      const state = page ? await browserManager.getPageState(page) : { url: null, title: null };

      res.json({
        connected: true,
        browser: browserManager.browser.version() || 'unknown',
        tabCount: browserManager.browser.contexts()[0]?.pages().length || 0,
        ...state,
      });
    } catch (err) {
      res.status(500).json({ connected: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/connect — 连接到浏览器
  // Body: { cdpUrl?: string }
  // ──────────────────────────────────────────────
  router.post('/browser/connect', async (req, res) => {
    try {
      // 先断开旧连接
      await browserManager.disconnect().catch(() => {});

      const cdpUrl = req.body.cdpUrl || DEFAULT_CDP_URL;

      // 校验 CDP URL — 只允许本地连接
      try {
        const parsed = new URL(cdpUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return res.status(400).json({ connected: false, error: 'CDP URL 必须使用 http/https 协议' });
        }
        if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
          return res.status(400).json({ connected: false, error: `CDP URL 主机名 '${parsed.hostname}' 不被允许，仅允许 127.0.0.1 或 localhost` });
        }
      } catch {
        return res.status(400).json({ connected: false, error: `CDP URL 格式无效: ${cdpUrl}` });
      }

      const info = await browserManager.connect(cdpUrl);

      res.json(info);
    } catch (err) {
      res.status(502).json({
        connected: false,
        error: err.message,
        hint: '在 Edge 地址栏输入 edge://inspect，或重新以 --remote-debugging-port=9222 启动浏览器',
      });
    }
  });

  return router;
}

module.exports = createConnectRouter;
