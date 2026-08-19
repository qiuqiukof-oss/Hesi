/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route group: DOM snapshot + diff.
// Handlers copied verbatim from the original routes/browser.js.
// ============================================================
const express = require('express');
const { browserManager } = require('./manager');
const { simpleHash, compareNodes, countNodes } = require('./dom-helpers');

function createDomRouter() {
  const router = express.Router();

  /**
   * 捕获当前页面的 DOM 快照（结构化、可比较的 DOM 表示）
   */
  router.post('/browser/dom-snapshot', async (req, res) => {
    try {
      const page = await browserManager.getActivePage();
      const state = await browserManager.getPageState(page);

      // 捕获 DOM 结构（简化版 — 标签+属性+文本，忽略动态内容）
      const snapshot = await page.evaluate(() => {
        function captureNode(node, depth = 0) {
          if (depth > 20 || node.nodeType !== 1) return null;
          const el = /** @type {Element} */ (node);

          // 收集关键属性
          const attrs = {};
          for (const attr of el.attributes) {
            // 只保留结构相关属性，忽略事件处理、样式值等动态内容
            if (['id', 'class', 'type', 'name', 'href', 'src', 'alt',
                 'placeholder', 'aria-label', 'role', 'value',
                 'disabled', 'readonly', 'checked', 'selected',
                 'data-*'].includes(attr.name)) continue;
            if (attr.name.startsWith('on') || attr.name === 'style' ||
                attr.name === 'data-reactid') continue;
            attrs[attr.name] = attr.value;
          }

          // 收集 class (用于差异对比)
          const classes = el.className ? el.className.split(/\s+/).filter(Boolean) : [];

          // 收集文本（忽略脚本、样式内容）
          let text = '';
          if (!['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) {
            text = (el.childNodes[0]?.nodeType === 3) ? el.textContent?.trim().slice(0, 200) || '' : '';
          }

          const children = [];
          for (const child of el.children) {
            const captured = captureNode(child, depth + 1);
            if (captured) children.push(captured);
          }

          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: classes.length > 0 ? classes : undefined,
            attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
            text: text || undefined,
            children: children.length > 0 ? children : undefined,
            childCount: el.children.length,
          };
        }

        const root = document.querySelector('main') || document.querySelector('#app') || document.querySelector('.app') || document.body;
        return captureNode(root);
      }).catch(() => null);

      if (!snapshot) {
        return res.status(500).json({ success: false, error: 'DOM 快照捕获失败' });
      }

      // 生成为比较用的标准化字符串
      const snapshotStr = JSON.stringify(snapshot);

      res.json({
        success: true,
        ...state,
        snapshot,
        snapshotHash: simpleHash(snapshotStr),
        timestamp: Date.now(),
        nodeCount: countNodes(snapshot),
        note: '将此 snapshotHash 传递给 dom-diff 以比较差异',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * 比较两个 DOM 快照，返回差异
   */
  router.post('/browser/dom-diff', async (req, res) => {
    try {
      const { snapshotA, snapshotB } = req.body;

      if (!snapshotA || !snapshotB) {
        return res.status(400).json({ success: false, error: '需要 snapshotA 和 snapshotB 参数' });
      }

      // 解析快照
      let treeA, treeB;
      try {
        treeA = typeof snapshotA === 'string' ? JSON.parse(snapshotA) : snapshotA;
        treeB = typeof snapshotB === 'string' ? JSON.parse(snapshotB) : snapshotB;
      } catch {
        return res.status(400).json({ success: false, error: '无效的快照 JSON' });
      }

      const diffs = [];
      compareNodes(treeA, treeB, '$root', diffs);

      res.json({
        success: true,
        diffCount: diffs.length,
        hasChanges: diffs.length > 0,
        diffs,
        summary: {
          added: diffs.filter(d => d.type === 'added').length,
          removed: diffs.filter(d => d.type === 'removed').length,
          modified: diffs.filter(d => d.type === 'modified').length,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = createDomRouter;
