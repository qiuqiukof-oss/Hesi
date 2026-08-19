/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Switch — 管理端点
//   GET/POST/DELETE /admin/keys   —— 网关 API Key 管理
//   GET /admin/usage              —— 用量统计
//   GET /admin/ui                 —— 管理面板（ui/admin.html）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DATA = path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'hesi-switch');
const KEYS_FILE = path.join(PLUGIN_DATA, 'keys.json');
const USAGE_FILE = path.join(PLUGIN_DATA, 'usage.json');
const UI_FILE = path.join(__dirname, '..', 'ui', 'admin.html');

/** 读写 keys.json（数组）。 */
function readKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (Array.isArray(data)) return data.filter((k) => typeof k === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

function writeKeys(keys) {
  fs.mkdirSync(PLUGIN_DATA, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
}

/** 生成随机 key。 */
function genKey() {
  return `sk-hesi-${require('crypto').randomBytes(16).toString('hex')}`;
}

/** 统一管理端点分发。 */
async function adminHandler(req, res) {
  const urlPath = (req.path || '').replace(/\/+$/, '');

  // ── GET /admin/ui（管理面板）──────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/admin/ui')) {
    if (!fs.existsSync(UI_FILE)) return res.status(404).send('admin ui not found');
    const html = fs.readFileSync(UI_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  // ── GET /admin/keys ────────────────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/admin/keys')) {
    const keys = readKeys();
    // 不返回完整 key，只给 mask 提示 + 数量
    return res.json({
      enabled: keys.length > 0,
      count: keys.length,
      keys: keys.map((k) => (k.length > 8 ? `${k.slice(0, 6)}...${k.slice(-4)}` : '****')),
      hint: '网关 Key：非本机回环请求需带 Authorization: Bearer <key>；留空=仅本机可用',
    });
  }

  // ── POST /admin/keys { action: 'add'|'clear' } ─────────────
  if (req.method === 'POST' && urlPath.endsWith('/admin/keys')) {
    const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
    const action = body.action || 'add';
    if (action === 'clear') {
      writeKeys([]);
      return res.json({ ok: true, count: 0 });
    }
    const keys = readKeys();
    const key = genKey();
    keys.push(key);
    writeKeys(keys);
    return res.json({ ok: true, key, count: keys.length });
  }

  // ── DELETE /admin/keys { key } ─────────────────────────────
  if (req.method === 'DELETE' && urlPath.endsWith('/admin/keys')) {
    const body = (typeof req.body === 'object' && req.body !== null) ? req.body : {};
    const target = String(body.key || '');
    const keys = readKeys().filter((k) => k !== target);
    writeKeys(keys);
    return res.json({ ok: true, count: keys.length });
  }

  // ── GET /admin/usage ───────────────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/admin/usage')) {
    try {
      let usage = {};
      try { if (fs.existsSync(USAGE_FILE)) usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { /* ignore */ }
      const entries = Object.entries(usage)
        .map(([model, v]) => ({ model, ...v }))
        .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
      const totalRequests = entries.reduce((s, e) => s + (e.requests || 0), 0);
      const totalChars = entries.reduce((s, e) => s + (e.chars || 0), 0);
      return res.json({ totalRequests, totalChars, models: entries });
    } catch (err) {
      return res.status(500).json({ error: (err && err.message) || String(err) });
    }
  }

  return res.status(404).json({ error: 'hesi-switch admin: unknown endpoint' });
}

module.exports = adminHandler;
