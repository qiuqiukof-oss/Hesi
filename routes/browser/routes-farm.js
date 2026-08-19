/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: cross-session browser farm (isolated contexts).
// Handlers copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');

function createFarmRouter() {
  const router = express.Router();

  /**
   * 获取浏览器上下文列表（每个上下文是一个隔离的浏览会话）
   */
  router.get('/browser/farm/contexts', async (req, res) => {
    try {
      await browserManager.ensureConnected().catch(() => {
        throw new Error('未连接到浏览器');
      });

      const contexts = browserManager.browser.contexts() || [];
      const result = contexts.map((ctx, idx) => {
        const pages = ctx.pages();
        return {
          index: idx,
          id: `ctx-${idx}`,
          pages: pages.length,
          urls: pages.map(p => {
            try { return p.url(); } catch { return 'unknown'; }
          }).filter(u => !u.startsWith('about:')),
          active: ctx === browserManager._activeContext,
          createdAt: ctx._createdAt || null,
        };
      });

      res.json({ success: true, contexts: result, activeContext: browserManager._activeContextIndex || 0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 创建新的隔离浏览器上下文（新会话）
   */
  router.post('/browser/farm/create', async (req, res) => {
    try {
      await browserManager.ensureConnected();

      const context = await browserManager.browser.newContext({
        userAgent: req.body.userAgent || undefined,
        locale: req.body.locale || 'zh-CN',
        timezoneId: req.body.timezoneId || 'Asia/Shanghai',
        colorScheme: req.body.colorScheme || 'light',
      });

      // 注入隐身脚本
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      // 标记创建时间
      context._createdAt = Date.now();
      context._label = req.body.label || `会话 ${browserManager.browser.contexts().length}`;

      // 在新上下文中打开一个空白页
      const page = await context.newPage();
      await page.goto('about:blank');

      // 切换到此上下文
      browserManager._activeContext = context;
      browserManager._activeContextIndex = browserManager.browser.contexts().indexOf(context);

      const idx = browserManager.browser.contexts().indexOf(context);

      res.json({
        success: true,
        context: {
          index: idx,
          id: `ctx-${idx}`,
          label: context._label,
          pages: 1,
          createdAt: context._createdAt,
        },
        message: `新浏览器会话 #${idx} 已创建`,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 切换到指定浏览器上下文
   */
  router.post('/browser/farm/switch', async (req, res) => {
    try {
      const { index } = req.body;
      if (typeof index !== 'number') {
        return res.status(400).json({ success: false, error: 'index 参数必填（数字）' });
      }

      await browserManager.ensureConnected();
      const contexts = browserManager.browser.contexts();

      if (index < 0 || index >= contexts.length) {
        return res.status(400).json({ success: false, error: `上下文索引 ${index} 超出范围（共 ${contexts.length} 个）` });
      }

      browserManager._activeContext = contexts[index];
      browserManager._activeContextIndex = index;

      // 将该上下文的第一个非空白页设为活跃
      const pages = contexts[index].pages();
      const activePage = pages.find(p => !p.url().startsWith('about:')) || pages[0];
      if (activePage) {
        await activePage.bringToFront().catch(() => {});
      }

      res.json({
        success: true,
        contextIndex: index,
        pages: pages.length,
        activePageUrl: activePage ? activePage.url() : null,
        message: `已切换到会话 #${index}`,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 关闭浏览器上下文
   */
  router.post('/browser/farm/close', async (req, res) => {
    try {
      const { index } = req.body;
      if (typeof index !== 'number') {
        return res.status(400).json({ success: false, error: 'index 参数必填（数字）' });
      }

      await browserManager.ensureConnected();
      const contexts = browserManager.browser.contexts();

      if (index < 0 || index >= contexts.length) {
        return res.status(400).json({ success: false, error: `上下文索引 ${index} 超出范围` });
      }

      // 不能关闭默认上下文（索引 0）
      if (index === 0) {
        return res.status(400).json({ success: false, error: '不能关闭默认浏览器上下文' });
      }

      await contexts[index].close();

      // 如果关闭的是活跃上下文，切回默认
      if (browserManager._activeContextIndex === index) {
        const remaining = browserManager.browser.contexts();
        browserManager._activeContext = remaining[0];
        browserManager._activeContextIndex = 0;
      }

      res.json({ success: true, message: `会话 #${index} 已关闭` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createFarmRouter;
