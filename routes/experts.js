/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Experts Router — 把 WorkBuddy 专家暴露为 Hesi 原生、可选用的角色。
// 与 skills / mcp-connectors 同源：连接器可接入调用，技能/专家已摄入为本机指令库。
// ============================================================
const express = require('express');
const expertRegistry = require('../ws/experts');

function createRouter() {
  const router = express.Router();

  // 列出全部专家（含内置与自定义）
  router.get('/', (req, res) => {
    try {
      res.json({ ok: true, experts: expertRegistry.list() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 重新播种内置专家（保留自定义）
  router.post('/ingest', (req, res) => {
    try {
      const catalog = expertRegistry.reingest();
      res.json({ ok: true, count: catalog.experts.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 获取单个专家（含完整 persona）
  router.get('/:id', (req, res) => {
    try {
      const e = expertRegistry.get(req.params.id);
      if (!e) return res.status(404).json({ ok: false, error: 'expert not found' });
      res.json({ ok: true, expert: e });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 新增/覆盖自定义专家
  router.post('/', (req, res) => {
    try {
      const body = req.body || {};
      if (!body.id || !body.name) return res.status(400).json({ ok: false, error: 'id and name required' });
      const expert = expertRegistry.addExpert({
        id: body.id,
        name: body.name,
        nameEn: body.nameEn,
        icon: body.icon,
        description: body.description,
        persona: body.persona,
        color: body.color,
        allowedSkills: body.allowedSkills,
        allowedConnectors: body.allowedConnectors,
      });
      res.json({ ok: true, expert });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
