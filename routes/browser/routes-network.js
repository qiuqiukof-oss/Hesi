/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: /browser/network (request monitoring).
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');

function createNetworkRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/browser/network — 网络请求监控
  // Body: { action?: 'start'|'stop'|'get', filter?: { urls?: string[], methods?: string[] } }
  // ──────────────────────────────────────────────
  router.post('/browser/network', async (req, res) => {
    try {
      const { action, filter } = req.body || {};

      if (action === 'start') {
        // 启用网络请求监控（注入失败会抛出，不再静默吞掉）
        try {
          await browserManager.ensureConnected();
        } catch (e) {
          return res.status(400).json({ success: false, error: `未连接到浏览器：${  e.message || ''}` });
        }
        const page = await browserManager.getActivePage();
        await page.evaluate(() => {
          if (window.__mcpNetworkCapture?.active) return;
          const entries = [];
          const maxEntries = 500;

          // 拦截 fetch
          const origFetch = window.fetch;
          window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.href);
            const method = (init?.method || 'GET').toUpperCase();
            const startTime = Date.now();
            try {
              const response = await origFetch.apply(this, arguments);
              const clone = response.clone();
              let bodyText = '';
              try {
                const contentType = clone.headers.get('content-type') || '';
                if (contentType.includes('json') || contentType.includes('text')) {
                  bodyText = await clone.text().catch(() => '');
                }
              } catch (e) { console.warn('[Browser] Failed to capture network response body:', e?.message); }
              entries.push({
                id: `net-${  Date.now()  }-${  Math.random().toString(36).slice(2, 6)}`,
                url, method, type: 'fetch',
                status: response.status,
                statusText: response.statusText,
                requestHeaders: init?.headers || {},
                responseHeaders: Object.fromEntries([...response.headers.entries()]),
                body: bodyText.slice(0, 2000),
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString(),
              });
              if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
              return response;
            } catch (err) {
              entries.push({
                id: `net-${  Date.now()  }-${  Math.random().toString(36).slice(2, 6)}`,
                url, method, type: 'fetch',
                status: 0, statusText: err.message,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString(),
                error: true,
              });
              if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
              throw err;
            }
          };

          // 拦截 XMLHttpRequest
          const origOpen = XMLHttpRequest.prototype.open;
          const origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function(method, url) {
            this._mcpMethod = method;
            this._mcpUrl = typeof url === 'string' ? url : (url ? url.href || String(url) : '');
            this._mcpStartTime = Date.now();
            return origOpen.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function(body) {
            this.addEventListener('loadend', function() {
              entries.push({
                id: `net-${  Date.now()  }-${  Math.random().toString(36).slice(2, 6)}`,
                url: this._mcpUrl,
                method: (this._mcpMethod || 'GET').toUpperCase(),
                type: 'xhr',
                status: this.status,
                statusText: this.statusText,
                body: this.responseText ? this.responseText.slice(0, 2000) : '',
                duration: Date.now() - (this._mcpStartTime || Date.now()),
                timestamp: new Date().toISOString(),
                error: this.status >= 400,
              });
              if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
            });
            return origSend.apply(this, arguments);
          };

          // 拦截 navigator.sendBeacon
          const origSendBeacon = navigator.sendBeacon;
          navigator.sendBeacon = function(url, data) {
            entries.push({
              id: `net-${  Date.now()  }-${  Math.random().toString(36).slice(2, 6)}`,
              url: typeof url === 'string' ? url : (url ? url.toString() : ''),
              method: 'POST',
              type: 'beacon',
              status: 0, statusText: 'sent',
              duration: 0,
              timestamp: new Date().toISOString(),
            });
            if (entries.length > maxEntries) entries.splice(0, entries.length - maxEntries);
            return origSendBeacon.apply(this, arguments);
          };

          window.__mcpNetworkCapture = {
            active: true,
            entries,
            maxEntries,
            startTime: Date.now(),
          };
        });

        browserManager.networkMonitoring = true;

        return res.json({
          success: true,
          action: 'started',
          isActive: true,
          message: '网络监控已启动，将捕获所有 fetch/XHR 请求',
        });
      }

      if (action === 'stop') {
        if (browserManager.connected) {
          const page = await browserManager.getActivePage().catch(() => null);
          if (page) {
            await page.evaluate(() => {
              if (window.__mcpNetworkCapture) window.__mcpNetworkCapture.active = false;
            }).catch(() => {});
          }
        }
        browserManager.networkMonitoring = false;
        return res.json({ success: true, action: 'stopped', isActive: false });
      }

      // action === 'get'（或默认）：读取已捕获的请求
      // 浏览器未连接时优雅返回空，而不是抛 500
      if (!browserManager.connected || !browserManager.browser || !browserManager.browser.isConnected()) {
        browserManager.networkMonitoring = false;
        return res.json({
          success: true,
          action: 'get',
          entries: [],
          stats: { total: 0, errors: 0, byMethod: {}, byType: {}, avgDuration: 0 },
          isActive: false,
        });
      }

      const page = await browserManager.getActivePage();
      const data = await page.evaluate(() => {
        const cap = window.__mcpNetworkCapture;
        if (!cap || !cap.active) return { entries: [], active: false };
        return { entries: cap.entries.slice(-100), active: true };
      }).catch(() => ({ entries: [], active: false }));

      const entries = data.entries || [];
      let filtered = entries;
      if (filter) {
        if (filter.urls) {
          filtered = filtered.filter(e => filter.urls.some(u => e.url.includes(u)));
        }
        if (filter.methods) {
          filtered = filtered.filter(e => filter.methods.includes(e.method));
        }
      }

      // 统计信息（基于全部已捕获请求，而非过滤后的子集）
      const stats = {
        total: entries.length,
        errors: entries.filter(e => e.error).length,
        byMethod: {},
        byType: {},
        avgDuration: 0,
      };
      let totalDur = 0;
      for (const e of entries) {
        stats.byMethod[e.method] = (stats.byMethod[e.method] || 0) + 1;
        stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
        totalDur += e.duration || 0;
      }
      stats.avgDuration = entries.length > 0 ? Math.round(totalDur / entries.length) : 0;

      // 若页面已重新导航导致注入失效，纠正 isActive 标志
      const isActive = !!data.active && browserManager.networkMonitoring;
      if (!isActive) browserManager.networkMonitoring = false;

      return res.json({
        success: true,
        action: 'get',
        entries: filtered,
        stats,
        isActive,
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createNetworkRouter;
