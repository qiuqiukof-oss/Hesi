/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Phase 2 S3/S5 — 围炉圆桌只读状态 + 覆盖层读写 + 纪要持久化
//
//   GET  /api/roundtable/state     → 花名册覆盖层 + 可用 CLI + 黑板摘要 + 角色协议
//   POST /api/roundtable/overrides → 保存席位自定义覆盖层（落 agent-overrides.json）
//   POST /api/roundtable/summary   → 把圆桌纪要追加进指定会话（MemoryStore），满足「保存到对话内容」
//
// 设计：只读聚合 + 轻量写入，不修改 discuss.js 内核；不落 data/；隐私红线不受影响。
// ============================================================
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadRegistry } = require('../cli-discovery');
const blackboard = require('../lib/blackboard');
const MemoryStore = require('../lib/memory');
const { readOverrides, writeOverrides } = require('../lib/agent-overrides');
const { listPresets, getPreset } = require('./ai-tools/roundtable-presets');

const TEMPLATE_PATH = path.join(__dirname, 'ai-tools', 'workflow-templates', 'roundtable.json');

function loadTemplate() {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function createRouter() {
  const router = express.Router();

  // ── 只读聚合状态 ──
  router.get('/state', (req, res) => {
    let availableClis = [];
    try {
      const reg = loadRegistry();
      // 圆桌只应列出「AgentCLI」+ 用户手动添加的 exe；过滤掉普通 tool/directory
      availableClis = (reg.clis || [])
        .filter((c) => c.category === 'agent' || c.discovered === 'manual')
        .map((c) => ({
          id: c.id,
          name: c.name,
          displayName: c.displayName || c.name,
          category: c.category,
          discovered: c.discovered,
        }));
    } catch { /* ignore */ }

    let board = null;
    try {
      const st = blackboard.read('default');
      if (st) {
        board = {
          projectId: st.projectId,
          tasks: st.tasks || [],
          files: st.files || {},
          round: st.round || 0,
          version: st.version || 0,
        };
      }
    } catch { /* ignore */ }

    const tpl = loadTemplate();
    res.json({
      overrides: readOverrides(),
      availableClis,
      blackboard: board,
      personas: tpl.personas || [],
      host: tpl.host || null,
      protocol: tpl.protocol || '',
    });
  });

  // ── 保存席位自定义覆盖层 ──
  router.post('/overrides', (req, res) => {
    const body = req.body || {};
    if (typeof body.overrides !== 'object' || body.overrides === null) {
      return res.status(400).json({ error: '"overrides" (object) is required' });
    }
    // 仅接受已知字段 + 合法 id，防注入任意结构
    const ALLOWED = ['name', 'roleLabel', 'themeColor', 'svg', 'avatar'];
    const clean = {};
    for (const [id, val] of Object.entries(body.overrides)) {
      if (typeof id !== 'string' || !/^[a-z0-9_-]+$/i.test(id)) continue;
      const o = {};
      for (const k of ALLOWED) {
        if (val && val[k] !== undefined) o[k] = val[k];
      }
      if (Object.keys(o).length) clean[id] = o;
    }
    try {
      const saved = writeOverrides(clean);
      return res.json({ ok: true, overrides: saved });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── P2.2 圆桌模板：列表 + 详情 ──
  router.get('/templates', (req, res) => {
    res.json({ ok: true, templates: listPresets() });
  });

  router.get('/templates/:id', (req, res) => {
    const tpl = getPreset(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'template not found: ' + req.params.id });
    res.json({ ok: true, template: tpl });
  });

  // ── 纪要持久化：追加进指定会话（满足「保存到对话内容」）──
  router.post('/summary', async (req, res) => {
    const { sessionId, summary, transcript } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: '"sessionId" is required' });
    }
    const content = summary || transcript;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: '"summary" or "transcript" is required' });
    }
    if (!MemoryStore.enabled) {
      return res.json({ ok: false, reason: 'memory disabled' });
    }
    try {
      await MemoryStore.ensure(sessionId, {});
      await MemoryStore.append(sessionId, [{ role: 'assistant', content }], {});
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}

module.exports = { createRouter };
