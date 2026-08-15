/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// DSH（DeepSeek Harness）引擎路由
//
// Hesi 与 DSH 并行：前端「AI 助手 ⇄ DSH」切换按钮通过这里
// 管理 DSH 子进程的生命周期与状态查询。
//   GET  /api/dsh/status   引擎状态（可用/运行/端口/版本/Key）
//   POST /api/dsh/start    启动引擎（幂等）
//   POST /api/dsh/stop     停止引擎
//   POST /api/dsh/restart  重启引擎
// ============================================================

const express = require('express');
const dsh = require('../lib/dsh/runtime');

function createRouter() {
  const router = express.Router();

  router.get('/dsh/status', async (_req, res) => {
    try {
      res.json(await dsh.getStatus());
    } catch (e) {
      res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  });

  router.post('/dsh/start', async (_req, res) => {
    try {
      res.json(await dsh.start());
    } catch (e) {
      res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  router.post('/dsh/stop', async (_req, res) => {
    try {
      await dsh.stop();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  router.post('/dsh/restart', async (_req, res) => {
    try {
      res.json(await dsh.restart());
    } catch (e) {
      res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });

  return router;
}

module.exports = { createRouter };
