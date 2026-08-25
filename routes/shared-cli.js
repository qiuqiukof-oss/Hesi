/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// ============================================================
// Shared CLI routes — 用户 CLI 会话「邀请 AI 协作」登记接口
//
// POST /api/cli/:tabId/share   — 把当前用户的某 tab 登记为 AI 可协作共享会话
// POST /api/cli/:tabId/unshare — 解除
// GET  /api/cli/shared         — 查当前用户共享状态（前端刷新图标态用）
//
// 权限：仅允许用户共享「自己」的 tab（activePTYs 中 tab.ws._userId === req.user.id），
// 防跨用户劫持。admin 可共享任意（含 orphan owner 同源校验在 ws 层已做）。
// ============================================================
const express = require('express');
const { sharedCliBridge } = require('../lib/shared-cli-bridge');

/**
 * @param {Map<WebSocket, Map<string, object>>} activePTYs — ws-handler 的活跃 tab 表
 */
function createRouter({ activePTYs }) {
  const router = express.Router();

  // 在 activePTYs 中查找 tabId，返回 { tab, ownerId } 或 null。
  function findTab(tabId) {
    if (!activePTYs) return null;
    for (const [ws, tabs] of activePTYs) {
      const tab = tabs && tabs.get(tabId);
      if (tab) {
        const ownerId = tab.ws ? tab.ws._userId : (tab.ownerId || null);
        return { tab, ownerId };
      }
    }
    return null;
  }

  // ── 登记共享 ──
  router.post('/cli/:tabId/share', (req, res) => {
    const { tabId } = req.params;
    const userId = (req.user && req.user.id) || 'local';
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const found = findTab(tabId);
    if (!found) {
      return res.status(404).json({ error: 'Tab not found or already exited', tabId });
    }
    // 归属校验：非 admin 只能共享自己的 tab。
    const isAdmin = !!(req.user && req.user.role === 'admin');
    if (!isAdmin && found.ownerId && found.ownerId !== userId) {
      return res.status(403).json({ error: 'Cannot share a terminal owned by another user', tabId });
    }
    // 非行式程序直接拒绝（培训边界）。
    if (sharedCliBridge.isNonLinear(found.tab.cliId)) {
      return res.status(422).json({
        error: 'interactive-program',
        message: `检测到交互式程序「${found.tab.cliId}」，请先退出再邀请 AI 协作`,
        tabId,
      });
    }

    sharedCliBridge.invite(userId, tabId, found.tab.cliId);
    res.json({ ok: true, tabId, cliId: found.tab.cliId, mode: 'readwrite' });
  });

  // ── 解除共享 ──
  router.post('/cli/:tabId/unshare', (req, res) => {
    const { tabId } = req.params;
    const userId = (req.user && req.user.id) || 'local';
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const cur = sharedCliBridge.getShared(userId);
    if (!cur || cur.tabId !== tabId) {
      return res.status(404).json({ error: 'No active share for this tab', tabId });
    }
    sharedCliBridge.revoke(userId);
    res.json({ ok: true, tabId });
  });

  // ── 查当前共享态 ──
  router.get('/cli/shared', (req, res) => {
    const userId = (req.user && req.user.id) || 'local';
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    const cur = sharedCliBridge.getShared(userId);
    res.json({ shared: cur || null });
  });

  return router;
}

module.exports = { createRouter };
