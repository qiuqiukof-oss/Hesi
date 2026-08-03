/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Bot Routes — unified webhook receiver for bot platforms (模式 A)
//
// 统一入站：
//   POST /api/bots/<platform>/webhook   — 平台回调（签名校验 fail-closed）
//   GET  /api/bots/<platform>/webhook   — 平台 URL 校验（飞书等用 challenge）
//   POST /api/bots/dispatch             — 内部/调试派发（本地可用）
//
// 平台注册（fail-closed）：只有配置了凭证的平台才注册路由，未配置不暴露端点。
// 派发 → routes/bots/dispatch.js → 内部 /api/chat（复用 LLM/Plan 全链路）。
// ============================================================
const express = require('express');
const { getPort } = require('../../lib/port');
const { requireToken, isLoopbackAddr } = require('../../lib/access-auth');
const { normalizeInbound } = require('./adapter');
const { dispatchToChat } = require('./dispatch');

// ── 平台适配器注册表（fail-closed：isConfigured() 为 false 的平台不挂路由）──
const ADAPTERS = [
  { id: 'qq', name: 'QQ 机器人', adapter: require('./qq') },
  // M2+ 接入：wecom / feishu / dingtalk / wechat-bot（各自 <platform>.js + 官方文档核对）
];

/**
 * 解析平台回调 body → 统一 inbound（平台差异在适配器内）。
 * @param {string} platformId
 * @param {object} body
 * @returns {object} inbound
 */
function toInbound(platformId, body) {
  const entry = ADAPTERS.find(a => a.id === platformId);
  if (!entry) throw new Error(`bot: unknown platform "${platformId}"`);
  if (typeof entry.adapter.eventToInbound === 'function') {
    return entry.adapter.eventToInbound(body);
  }
  return normalizeInbound(platformId, body);
}

/**
 * 创建 bots 路由。
 * @returns {import('express').Router}
 */
function createRouter() {
  const router = express.Router();

  // ── 各平台 webhook 接收（fail-closed）──
  for (const entry of ADAPTERS) {
    if (!entry.adapter.isConfigured || !entry.adapter.isConfigured()) {
      console.log(`[bots] ${entry.name} 未配置凭证，不注册 /api/bots/${entry.id}/webhook（fail-closed）`);
      continue;
    }

    // URL 校验（GET challenge）
    router.get(`/bots/${entry.id}/webhook`, (req, res) => {
      const challenge = req.query && (req.query.challenge || req.query.echostr);
      if (challenge) return res.send(String(challenge));
      return res.status(400).json({ error: 'missing challenge' });
    });

    // 消息回调（POST）
    router.post(`/bots/${entry.id}/webhook`, async (req, res) => {
      try {
        // 签名校验（fail-closed：校验不通过 → 403 拒绝）
        const ok = entry.adapter.verifyWebhook
          ? entry.adapter.verifyWebhook(req)
          : true;
        if (!ok) return res.status(403).json({ error: 'signature verification failed' });

        const inbound = toInbound(entry.id, req.body || {});
        const result = await dispatchToChat(inbound, {
          planMode: (req.body && req.body.planMode === true),
          provider: (req.body && req.body.provider) || undefined,
        });

        if (result.ok && entry.adapter.sendMessage && inbound.chatId) {
          const sent = await entry.adapter.sendMessage(inbound.chatId, result.reply);
          if (!sent.ok) console.warn(`[bots] ${entry.id} 回传失败:`, sent.error);
        }
        // 平台期望立即 200（异步回传），或等待回传——这里统一先 200 受理
        return res.json({ ok: true, received: true });
      } catch (err) {
        console.warn(`[bots] ${entry.id} webhook 处理异常:`, err && err.message);
        return res.status(400).json({ error: (err && err.message) || 'bad request' });
      }
    });

    console.log(`[bots] ✅ ${entry.name} 已注册 /api/bots/${entry.id}/webhook`);
  }

  // ── 内部/调试派发端点（本机回环可用；未配置任何平台也能本地冒烟）──
  // 安全：只允许回环 IP 调用（防公网滥用）；若服务启用了 QCLI_ACCESS_TOKEN，
  // 再叠加 requireToken 校验（token 与回环豁免策略一致）。
  router.post('/bots/dispatch', (req, res, next) => {
    const ip = (req.ip || req.connection?.remoteAddress || '');
    if (!isLoopbackAddr(ip)) return res.status(403).json({ error: 'dispatch is loopback-only' });
    return next();
  }, requireToken, async (req, res) => {
    try {
      const { platform, chatId, userId, text, provider, planMode } = req.body || {};
      if (!platform || !chatId || !text) {
        return res.status(400).json({ error: 'platform/chatId/text required' });
      }
      const inbound = normalizeInbound(platform, { chatId, userId, text, ...(req.body || {}) });
      const result = await dispatchToChat(inbound, { provider, planMode });
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: (err && err.message) || 'bad request' });
    }
  });

  // ── 平台列表（给前端/调试）──
  router.get('/bots', (req, res) => {
    res.json({
      bots: ADAPTERS.map(a => ({
        id: a.id,
        name: a.name,
        configured: !!(a.adapter.isConfigured && a.adapter.isConfigured()),
      })),
      loopbackPort: getPort(),
    });
  });

  return router;
}

module.exports = { createRouter, ADAPTERS, toInbound };
