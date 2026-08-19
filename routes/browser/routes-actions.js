/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: page actions
// (navigate, click, type, screenshot, tabs, switch-tab, back, refresh, text).
// Handlers copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const {
  validateUrl, buildResponse, captureBeforeAction, checkCLIQPage,
  MAX_TYPE_LENGTH, MAX_TEXT_LENGTH, NAVIGATE_TIMEOUT, LOCATOR_TIMEOUT, SCREENSHOT_MAX_WIDTH,
} = require('./helpers');

function createActionsRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/browser/navigate — 导航到 URL
  // ──────────────────────────────────────────────
  router.post('/browser/navigate', async (req, res) => {
    try {
      const { url } = req.body;

      // URL 校验
      const validated = validateUrl(url);
      if (!validated.valid) {
        return res.status(400).json({ success: false, error: validated.error });
      }

      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上导航
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: cliqCheck.message,
          farmAction: 'browser_farm_create',
        });
      }

      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      const before = await captureBeforeAction(page);

      await page.goto(validated.url, {
        waitUntil: 'networkidle',
        timeout: NAVIGATE_TIMEOUT,
      });

      const response = await buildResponse(page, {
        action: 'navigate',
        previousUrl,
        navigatedTo: validated.url,
      });

      res.json(response);
    } catch (err) {
      // 失败时返回当前页面状态快照，让 AI 重新评估
      try {
        const page = await browserManager.getActivePage().catch(() => null);
        if (page) {
          const state = await buildResponse(page, {
            success: false,
            action: 'navigate',
            error: err.message,
          });
          return res.json(state);
        }
      } catch (fallbackErr) { console.debug('[Browser] navigate fallback error:', fallbackErr?.message); }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/click — 点击元素
  // ──────────────────────────────────────────────
  router.post('/browser/click', async (req, res) => {
    try {
      const { selector, text, coordinate } = req.body;
      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上点击
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: cliqCheck.message,
          farmAction: 'browser_farm_create',
        });
      }

      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      const before = await captureBeforeAction(page);

      if (coordinate && typeof coordinate.x === 'number' && typeof coordinate.y === 'number') {
        // 坐标点击（AI 视觉定位兜底）
        await page.mouse.click(coordinate.x, coordinate.y);
      } else if (text) {
        // 文本匹配优先（最稳定）
        await page.getByText(text, { exact: false }).first().click({ timeout: LOCATOR_TIMEOUT });
      } else if (selector) {
        // CSS selector / Playwright locator
        // 先用 Semrole 定位，失败降级到 selector
        await page.locator(selector).first().click({ timeout: LOCATOR_TIMEOUT });
      } else {
        return res.status(400).json({ success: false, error: '请提供 selector、text 或 coordinate 之一' });
      }

      // 等待网络空闲（页面可能跳转）
      await page.waitForLoadState('networkidle').catch(() => {});
      // 额外等 500ms 让动态渲染完成
      await new Promise(r => setTimeout(r, 500));

      const response = await buildResponse(page, {
        action: 'click',
        previousUrl,
        method: coordinate ? 'coordinate' : (text ? 'text' : 'selector'),
        target: coordinate ? `${coordinate.x},${coordinate.y}` : (text || selector),
      });

      res.json(response);
    } catch (err) {
      // 失败时返回当前状态快照，让 AI 重新评估
      try {
        const page = await browserManager.getActivePage().catch(() => null);
        if (page) {
          const state = await buildResponse(page, {
            success: false,
            error: err.message,
          });
          return res.json(state);
        }
      } catch (fallbackErr) { console.debug('[Browser] click fallback error:', fallbackErr?.message); }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/type — 输入文本
  // ──────────────────────────────────────────────
  router.post('/browser/type', async (req, res) => {
    try {
      const { selector, text, clear } = req.body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ success: false, error: 'text 参数必填' });
      }

      // 长度限制
      const safeText = text.slice(0, MAX_TYPE_LENGTH);

      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上输入
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: cliqCheck.message,
          farmAction: 'browser_farm_create',
        });
      }

      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      const before = await captureBeforeAction(page);

      if (selector) {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: LOCATOR_TIMEOUT });
        await locator.scrollIntoViewIfNeeded();
        if (clear) {
          await locator.clear();
        }
        await locator.fill(safeText); // fill 比 type 更快更稳定
      } else {
        // 没有 selector 则聚焦当前页面并 keyboard 输入
        await page.keyboard.type(safeText);
      }

      const response = await buildResponse(page, {
        action: 'type',
        previousUrl,
        inputLength: safeText.length,
      });

      res.json(response);
    } catch (err) {
      try {
        const page = await browserManager.getActivePage().catch(() => null);
        if (page) {
          const state = await buildResponse(page, { success: false, error: err.message });
          return res.json(state);
        }
      } catch (fallbackErr) { console.debug('[Browser] type fallback error:', fallbackErr?.message); }
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/screenshot — 截图
  // ──────────────────────────────────────────────
  router.post('/browser/screenshot', async (req, res) => {
    try {
      const { fullPage } = req.body;
      const page = await browserManager.getActivePage();

      const state = await browserManager.getPageState(page);

      let screenshot;
      try {
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 75,
          fullPage: !!fullPage,
          clip: fullPage ? undefined : { x: 0, y: 0, width: SCREENSHOT_MAX_WIDTH, height: 900 },
        }).then(buf => buf.toString('base64'));
      } catch (e) {
        return res.status(500).json({ success: false, error: `截图失败: ${e.message}` });
      }

      res.json({
        success: true,
        ...state,
        screenshot,
        fullPage: !!fullPage,
        format: 'jpeg',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/browser/tabs — 列出所有 tab
  // ──────────────────────────────────────────────
  router.get('/browser/tabs', async (req, res) => {
    try {
      await browserManager.ensureConnected();
      const context = browserManager.browser.contexts()[0];
      const pages = context?.pages() || [];

      const tabs = pages.map((p, i) => ({
        index: i,
        url: p.url(),
        title: p.url().startsWith('about:') ? '(新标签页)' : '',
        visible: true,
      }));

      // 获取标题（考虑 about:blank 页面可能正在加载）
      await Promise.allSettled(
        tabs.map(async (t, i) => {
          if (!t.title) {
            t.title = await pages[i].title().catch(() => '(无标题)');
          }
        })
      );

      res.json({
        success: true,
        tabs,
        activeIndex: 0,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/switch-tab — 切换 tab
  // ──────────────────────────────────────────────
  router.post('/browser/switch-tab', async (req, res) => {
    try {
      const { index } = req.body;
      if (typeof index !== 'number') {
        return res.status(400).json({ success: false, error: 'index 参数必填（数字）' });
      }

      await browserManager.ensureConnected();
      const context = browserManager.browser.contexts()[0];
      const pages = context?.pages() || [];

      if (index < 0 || index >= pages.length) {
        return res.status(400).json({ success: false, error: `tab 索引 ${index} 超出范围（共 ${pages.length} 个 tab）` });
      }

      const page = pages[index];
      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      await page.bringToFront();

      const response = await buildResponse(page, {
        action: 'switch_tab',
        previousUrl,
        tabIndex: index,
      });

      res.json(response);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/back — 返回上一页
  // ──────────────────────────────────────────────
  router.post('/browser/back', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上操作
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: cliqCheck.message,
          farmAction: 'browser_farm_create',
        });
      }

      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      await page.goBack({ waitUntil: 'networkidle', timeout: NAVIGATE_TIMEOUT }).catch(() => {});

      const response = await buildResponse(page, { action: 'back', previousUrl });
      res.json(response);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/refresh — 刷新当前页面
  // ──────────────────────────────────────────────
  router.post('/browser/refresh', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();

      // 🚨 Hesi 页面保护：禁止在 Hesi 管理页面上操作
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.status(400).json({
          success: false,
          error: 'Hesi 管理页面禁止操作',
          hint: cliqCheck.message,
          farmAction: 'browser_farm_create',
        });
      }

      const previousUrl = (() => { try { return page.url(); } catch { return null; } })();
      await page.reload({ waitUntil: 'networkidle', timeout: NAVIGATE_TIMEOUT });

      const response = await buildResponse(page, { action: 'refresh', previousUrl });
      res.json(response);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/text — 提取页面可见文本
  // ──────────────────────────────────────────────
  router.post('/browser/text', async (req, res) => {
    try {
      const maxLength = Math.min(req.body.maxLength || MAX_TEXT_LENGTH, 20000);
      const page = await browserManager.getActivePage();

      // ⚠️ Hesi 页面提示：提取文本是安全操作，但建议在新会话中进行
      const cliqCheck = await checkCLIQPage(page);
      if (cliqCheck.isCLIQ) {
        return res.json({
          success: false,
          error: 'Hesi 管理页面禁止提取文本',
          hint: '如需分析外部网页的文本内容，请先用 browser_farm_create 创建新会话后在新会话中调用 browser_text',
          farmAction: 'browser_farm_create',
        });
      }

      const state = await browserManager.getPageState(page);

      // 提取可见文本内容
      let text = '';
      try {
        text = await page.evaluate(() => {
          // 跳过隐藏元素和脚本/样式
          const clone = document.body.cloneNode(true);
          const removals = clone.querySelectorAll('script, style, noscript, svg, canvas, iframe');
          removals.forEach(el => el.remove());
          return clone.innerText || '';
        }).catch(() => '');
      } catch (e) { console.debug('[Browser] text extraction error:', e?.message); }

      // 也尝试获取 meta description
      let metaDescription = '';
      try {
        metaDescription = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="description"]');
          return meta?.getAttribute('content') || '';
        }).catch(() => '');
      } catch (e) { console.debug('[Browser] meta extraction error:', e?.message); }

      const truncated = text.length > maxLength;
      const visibleText = text.slice(0, maxLength);

      res.json({
        success: true,
        ...state,
        text: visibleText,
        textLength: text.length,
        returnedLength: visibleText.length,
        truncated,
        metaDescription,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createActionsRouter;
