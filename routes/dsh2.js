/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// DSH2 — 进程内 DeepSeek Harness 引擎路由（Phase 2）
//
// 与 Phase 1（子进程 + iframe）并行存在：
//   POST /api/dsh2/chat    SSE 流式聊天（复用 Hesi chat 的事件协议：
//                          token / reasoning / status / tool_call_start /
//                          tool_call_end / usage / [DONE]）
//   GET  /api/dsh2/status  引擎状态（模型/会话数）
//   POST /api/dsh2/reset   重置某会话的 DSH Agent（开新上下文）
// ============================================================

const express = require('express');

/** 动态加载 ESM 引擎（CJS require 不能直接吃 ESM，用 import()）。加载失败时清空缓存以允许下次重试。 */
let _enginePromise = null;
function engine() {
  if (!_enginePromise) {
    _enginePromise = import('../lib/dsh2/engine.mjs').catch((e) => {
      _enginePromise = null; // 失败后清空，下次请求重新尝试
      throw e;
    });
  }
  return _enginePromise;
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function writeFrame(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch { /* client closed */ }
}

function createRouter() {
  const router = express.Router();

  // ── SSE 流式聊天（与 /api/chat 同一事件协议，前端管线零改动复用）──
  router.post('/dsh2/chat', async (req, res) => {
    const { messages, sessionId } = req.body || {};
    const list = Array.isArray(messages) ? messages : [];
    const last = list[list.length - 1];
    const text = last && typeof last.content === 'string' ? last.content : '';
    const sid = typeof sessionId === 'string' && sessionId ? sessionId : `dsh-${Date.now().toString(36)}`;

    if (!text.trim()) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }

    sseHeaders(res);

    let eng;
    try {
      eng = await engine();
    } catch (e) {
      writeFrame(res, { type: 'error', message: `DSH 引擎加载失败: ${e && e.message}` });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    try {
      await eng.sendMessage(sid, text, {
        cwd: req.body && req.body.cwd ? req.body.cwd : undefined,
        onEvent: (payload) => writeFrame(res, payload),
      });
      writeFrame(res, { type: 'status', message: '✅ 完成' });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // 常见可读错误提示
      if (/channel|model/i.test(msg)) {
        writeFrame(res, { type: 'error', message: `DSH 模型通道错误：${msg}（检查 HESI_DSH_MODEL 与端点是否支持该模型）` });
      } else if (/api[_-]?key|unauthorized|401|403/i.test(msg)) {
        writeFrame(res, { type: 'error', message: 'DSH 调用被拒：请检查模型服务里的 Key 是否有效' });
      } else {
        writeFrame(res, { type: 'error', message: `DSH 错误：${msg}` });
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  router.get('/dsh2/status', async (_req, res) => {
    try {
      const eng = await engine();
      res.json(await eng.getStatus());
    } catch (e) {
      res.json({ running: false, error: e && e.message ? e.message : String(e) });
    }
  });

  router.post('/dsh2/reset', async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId 必填' });
    try {
      const eng = await engine();
      const reset = await eng.resetSession(sessionId);
      res.json({ ok: true, reset });
    } catch (e) {
      res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  return router;
}

module.exports = { createRouter };
