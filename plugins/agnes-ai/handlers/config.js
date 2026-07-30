/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Agnes config endpoint — stores/reads the API key + base URL on the Hesi
// backend (NOT in the browser). The proxy reads this to inject the key.
'use strict';

const fs = require('fs');
const path = require('path');

// 默认落盘于 data/plugin-data/agnes-ai/config.json；测试可通过环境变量重定向
const PLUGIN_DATA = process.env.AGNES_CONFIG_DIR
  ? path.resolve(process.env.AGNES_CONFIG_DIR)
  : path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'agnes-ai');
const CONFIG_FILE = path.join(PLUGIN_DATA, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}

function saveConfig(cfg) {
  try {
    if (!fs.existsSync(PLUGIN_DATA)) fs.mkdirSync(PLUGIN_DATA, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

function maskKey(key) {
  if (!key || key.length < 8) return key || '';
  return `${key.slice(0, 4)  }…${  key.slice(-4)}`;
}

// 需在服务端持久化的模型/温度等偏好（与前端 State 字段一一对应）
const MODEL_PREFS = ['chatModel', 'imageModel', 'videoModel', 'temperature', 'defaultImageSize', 'videoResolution'];

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
module.exports = function config(req, res) {
  if (req.method === 'GET') {
    const cfg = loadConfig();
    const out = {
      // 返回真实 key 供前端恢复（Hesi 本地运行、无鉴权，key 已在浏览器内存中，安全）
      apiKey: cfg.apiKey || '',
      apiKeyMasked: maskKey(cfg.apiKey),
      apiBaseUrl: cfg.apiBaseUrl || 'https://apihub.agnes-ai.com/v1',
      configured: !!cfg.apiKey,
    };
    for (const k of MODEL_PREFS) {
      if (cfg[k] !== undefined && cfg[k] !== '') out[k] = cfg[k];
    }
    return res.json(out);
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const cfg = loadConfig();
    // 仅当传入非空 key 时才覆盖；空字段表示「保留现有 key」（改 Base URL 无需重填 key）
    if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
      cfg.apiKey = body.apiKey.trim();
    }
    if (typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim() !== '') {
      cfg.apiBaseUrl = body.apiBaseUrl.trim();
    }
    // 模型/温度等偏好一并持久化，重启不再丢失
    for (const k of MODEL_PREFS) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== '') cfg[k] = body[k];
    }
    saveConfig(cfg);
    return res.json({ ok: true, configured: !!cfg.apiKey });
  }

  if (req.method === 'DELETE') {
    // 「清除所有数据」时一并清空服务端配置（含 API Key）
    try { if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE); } catch (e) { /* ignore */ }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
