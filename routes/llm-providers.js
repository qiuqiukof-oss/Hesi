/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider API 路由（M0/M2/M3 共享）
//
//   GET  /api/llm-providers             → 注册表 + 生效配置（脱敏）+ 健康状态
//   GET  /api/llm-providers/:id/models  → 模型列表（本地惰性探测 / 云端静态）
//   POST /api/llm-providers/health      → 强制刷新健康
//   POST /api/llm-providers/config      → 保存用户级配置（data/llm-providers.json）
//
// 除列表外均 requireToken 保护（与 bots config 端点同策略：本机默认放行，
// 配了 QCLI_ACCESS_TOKEN 后管理操作需鉴权；webhook/列表公开）。
// ============================================================
'use strict';

const express = require('express');
const { getAllConfigs, getConfig, setConfig, getProviderDef, addCustomProvider, updateCustomProvider, removeCustomProvider } = require('../lib/llm-provider/provider-config');
const { listModels } = require('../lib/llm-provider/provider-client');
const { healthAll } = require('../lib/llm-provider/provider-health');
const { requireToken } = require('../lib/access-auth');

/**
 * @returns {import('express').Router}
 */
function createRouter() {
  const router = express.Router();

  // 列表：注册表 + 配置（脱敏）+ 健康 + ⭐默认 + 角色分工（惰性，首次 30s 缓存）
  router.get('/llm-providers', async (req, res) => {
    try {
      const configs = getAllConfigs();
      const health = await healthAll();
      const out = configs.map((c) => {
        const h = health.find((x) => x.id === c.id) || { status: 'unknown' };
        return { ...c, health: h.status, healthError: h.error || '' };
      });
      const { getDefaultProvider, getRole, ROLES } = require('../lib/llm-provider/provider-config');
      const roles = {};
      for (const r of ROLES) roles[r] = getRole(r);
      res.json({ providers: out, source: 'env优先/设置页覆盖', defaultProvider: getDefaultProvider(), roles });
    } catch (err) {
      res.status(500).json({ error: (err && err.message) || String(err) });
    }
  });

  // ⭐ 设置默认 provider
  router.post('/llm-providers/default', requireToken, (req, res) => {
    const { provider } = req.body || {};
    const { setDefaultProvider } = require('../lib/llm-provider/provider-config');
    const result = setDefaultProvider(provider);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, defaultProvider: provider });
  });

  // 设置角色分工（chat/plan/discuss/memory）
  router.post('/llm-providers/role', requireToken, (req, res) => {
    const { role, fields } = req.body || {};
    const { setRole } = require('../lib/llm-provider/provider-config');
    const result = setRole(role, fields);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, role, ...(result.warning ? { warning: result.warning } : {}) });
  });

  // 模型列表（本地探测 / 云端静态）
  router.get('/llm-providers/:id/models', requireToken, async (req, res) => {
    const { id } = req.params;
    const result = await listModels(id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // 强制刷新健康（POST body 可带 provider 子集，缺省全部）
  router.post('/llm-providers/health', requireToken, async (req, res) => {
    const { providers } = req.body || {};
    try {
      const all = await healthAll({ force: true });
      const out = Array.isArray(providers) && providers.length
        ? all.filter((h) => providers.includes(h.id))
        : all;
      res.json({ ok: true, health: out });
    } catch (err) {
      res.status(500).json({ error: (err && err.message) || String(err) });
    }
  });

  // 保存用户级配置（env 仍优先，文件只补缺；可清空字段恢复 env/none）
  router.post('/llm-providers/config', requireToken, (req, res) => {
    const { provider, fields } = req.body || {};
    if (!provider || !fields) return res.status(400).json({ error: 'provider/fields required' });
    const result = setConfig(provider, fields);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, ...(result.warning ? { warning: result.warning } : {}) });
  });

  // 单 provider 生效配置详情（脱敏，调试用）
  router.get('/llm-providers/:id', requireToken, (req, res) => {
    const { id } = req.params;
    const def = getProviderDef(id);
    if (!def) return res.status(404).json({ error: `unknown provider: ${id}` });
    const cfg = getConfig(id);
    res.json({ id, name: def.name, apiType: def.apiType, kind: def.kind, ...cfg, apiKey: cfg.apiKey ? `****${cfg.apiKey.slice(-4)}` : '' });
  });

  // ── 自定义 provider（模型广场「➕ 自定义」入口，v0.8.0）──
  // POST /llm-providers/custom { action: 'add'|'update'|'remove', ... } — requireToken 保护
  router.post('/llm-providers/custom', requireToken, (req, res) => {
    const { action, fields, id } = req.body || {};
    let result;
    if (action === 'add') {
      result = addCustomProvider(fields);
      if (result.ok) return res.json({ ok: true, provider: result.provider });
    } else if (action === 'update') {
      result = updateCustomProvider(id, fields);
      if (result.ok) return res.json({ ok: true });
    } else if (action === 'remove') {
      result = removeCustomProvider(id);
      if (result.ok) return res.json({ ok: true });
    } else {
      return res.status(400).json({ error: "action 须为 'add' | 'update' | 'remove'" });
    }
    return res.status(400).json({ error: result && result.error ? result.error : 'operation failed' });
  });

  return router;
}

module.exports = { createRouter };
