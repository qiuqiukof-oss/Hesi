/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Browser Scripts — 用户脚本管理 API
//
// 提供类似 Tampermonkey 的脚本管理能力，但完全基于 CDP 原生注入。
// 脚本持久化到 .browser-scripts.json 文件，支持 CRUD + 启用/禁用。
//
// 脚本注入流程：
//   1. 用户通过前端面板创建/编辑脚本
//   2. 后端保存到 .browser-scripts.json
//   3. 当 CDP 连接建立后，调用 applyScripts() 将启用的脚本注入到匹配的页面
//   4. 脚本通过 Page.addScriptToEvaluateOnNewDocument 注入（runAt 可控）
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── 配置 ──
const SCRIPTS_PATH = path.join(__dirname, '..', '.browser-scripts.json');
const MAX_SCRIPT_CODE_LENGTH = 50000;
const MAX_SCRIPT_NAME_LENGTH = 100;
const MAX_DESC_LENGTH = 500;

// ============================================================
// 数据模型
// ============================================================

/**
 * @typedef {object} BrowserScript
 * @property {string} id          - 唯一 ID
 * @property {string} name        - 脚本名称
 * @property {string} description - 描述
 * @property {boolean} enabled    - 是否启用
 * @property {string} urlPattern  - URL 匹配模式 (glob, e.g. *://*.example.com/*)
 * @property {'document-start'|'document-end'|'document-idle'} runAt - 注入时机
 * @property {string} code        - JavaScript 代码
 * @property {number} version     - 版本号
 * @property {number} createdAt   - 创建时间戳
 * @property {number} updatedAt   - 更新时间戳
 * @property {string[]} tags      - 标签
 * @property {string|null} fromPlugin - 来源插件名称
 */

// ============================================================
// 持久化 Store
// ============================================================

/** @type {Map<string, BrowserScript>} */
let _scriptsCache = null;

/**
 * 加载持久化的脚本列表。
 * @returns {Map<string, BrowserScript>}
 */
function loadScripts() {
  if (_scriptsCache) return _scriptsCache;
  _scriptsCache = new Map();
  try {
    const raw = fs.readFileSync(SCRIPTS_PATH, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const s of arr) {
        _scriptsCache.set(s.id, s);
      }
    }
  } catch {
    // 文件不存在或格式错误，使用空列表
  }
  return _scriptsCache;
}

/**
 * 保存脚本列表到磁盘。
 */
function saveScripts() {
  if (!_scriptsCache) return;
  try {
    const arr = Array.from(_scriptsCache.values());
    fs.writeFileSync(SCRIPTS_PATH, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[BrowserScripts] Failed to save:', err.message);
  }
}

/**
 * 生成唯一 ID。
 */
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 验证 URL 匹配模式的格式（简单 glob 语法）。
 * @param {string} pattern
 * @returns {boolean}
 */
function isValidUrlPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return false;
  if (pattern.length > 500) return false;
  // 基础 glob：支持 * 和 ? 通配符
  try {
    // 只允许 * : / . ? 字母数字和常见字符
    if (/[<>"|\\]/.test(pattern)) return false;
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// URL 匹配函数（供 BrowserManager 注入使用）
// ============================================================

/**
 * 检查 URL 是否匹配给定的 glob 模式。
 * @param {string} pattern - 如 *://*.example.com/*
 * @param {string} url
 * @returns {boolean}
 */
function matchesUrlPattern(pattern, url) {
  if (!pattern || pattern === '*') return true;
  if (pattern === '*://*/*' || pattern === '**') return true;

  // 将 glob 模式转换为正则
  let regexStr = '';
  let inBrackets = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (inBrackets) {
      if (ch === ']') inBrackets = false;
      regexStr += ch;
      continue;
    }
    if (ch === '[') {
      inBrackets = true;
      regexStr += '[';
      continue;
    }
    if (ch === '*') {
      // ** 匹配任意路径，* 匹配一个路径段
      if (pattern[i + 1] === '*') {
        regexStr += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        regexStr += '[^/]*';
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
    } else if (/[.+^${}()|\\]/.test(ch)) {
      regexStr += `\\${  ch}`;
    } else {
      regexStr += ch;
    }
  }
  try {
    return new RegExp(`^${  regexStr  }$`, 'i').test(url);
  } catch {
    return false;
  }
}

/**
 * 获取当前启用的脚本列表（用于注入）。
 * @returns {BrowserScript[]}
 */
function getEnabledScripts() {
  const all = loadScripts();
  return Array.from(all.values()).filter(s => s.enabled);
}

// ============================================================
// Express Router
// ============================================================

/**
 * Create the browser scripts router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // GET /api/browser/scripts — 列出所有脚本
  // ──────────────────────────────────────────────
  router.get('/browser/scripts', (req, res) => {
    const scripts = loadScripts();
    const list = Array.from(scripts.values()).map(s => ({
      ...s,
      // 返回时截断 code 以防响应过大
      code: s.code.length > 500 ? `${s.code.slice(0, 500)  }\n// ... [截断]` : s.code,
    }));
    res.json({ scripts: list, total: scripts.size });
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/scripts — 创建新脚本
  // Body: { name, description?, urlPattern, runAt?, code, tags? }
  // ──────────────────────────────────────────────
  router.post('/browser/scripts', (req, res) => {
    const { name, description, urlPattern, runAt, code, tags } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.length > MAX_SCRIPT_NAME_LENGTH) {
      return res.status(400).json({ error: `name too long (max ${MAX_SCRIPT_NAME_LENGTH} chars)` });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'code is required' });
    }
    if (code.length > MAX_SCRIPT_CODE_LENGTH) {
      return res.status(400).json({ error: `code too long (max ${MAX_SCRIPT_CODE_LENGTH} chars)` });
    }
    if (!urlPattern) {
      return res.status(400).json({ error: 'urlPattern is required' });
    }
    if (!isValidUrlPattern(urlPattern)) {
      return res.status(400).json({ error: 'Invalid urlPattern format' });
    }

    const validRunAts = ['document-start', 'document-end', 'document-idle'];
    const scriptRunAt = validRunAts.includes(runAt) ? runAt : 'document-end';

    const now = Date.now();
    /** @type {BrowserScript} */
    const script = {
      id: generateId(),
      name: name.trim(),
      description: (description || '').trim().slice(0, MAX_DESC_LENGTH),
      enabled: true,
      urlPattern: urlPattern.trim(),
      runAt: scriptRunAt,
      code,
      version: 1,
      createdAt: now,
      updatedAt: now,
      tags: Array.isArray(tags) ? tags.filter(t => typeof t === 'string') : [],
      fromPlugin: null,
    };

    const scripts = loadScripts();
    scripts.set(script.id, script);
    saveScripts();

    res.status(201).json({ success: true, script });
  });

  // ──────────────────────────────────────────────
  // PUT /api/browser/scripts/:id — 更新脚本
  // Body: { name?, description?, enabled?, urlPattern?, runAt?, code?, tags? }
  // ──────────────────────────────────────────────
  router.put('/browser/scripts/:id', (req, res) => {
    const scripts = loadScripts();
    const existing = scripts.get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const { name, description, enabled, urlPattern, runAt, code, tags } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.length > MAX_SCRIPT_NAME_LENGTH) {
        return res.status(400).json({ error: `Invalid name (max ${MAX_SCRIPT_NAME_LENGTH} chars)` });
      }
      existing.name = name.trim();
    }
    if (description !== undefined) {
      existing.description = String(description).slice(0, MAX_DESC_LENGTH);
    }
    if (enabled !== undefined) {
      existing.enabled = !!enabled;
    }
    if (urlPattern !== undefined) {
      if (!isValidUrlPattern(urlPattern)) {
        return res.status(400).json({ error: 'Invalid urlPattern format' });
      }
      existing.urlPattern = urlPattern.trim();
    }
    if (runAt !== undefined) {
      const validRunAts = ['document-start', 'document-end', 'document-idle'];
      if (!validRunAts.includes(runAt)) {
        return res.status(400).json({ error: `runAt must be one of: ${validRunAts.join(', ')}` });
      }
      existing.runAt = runAt;
    }
    if (code !== undefined) {
      if (typeof code !== 'string' || code.length > MAX_SCRIPT_CODE_LENGTH) {
        return res.status(400).json({ error: `Invalid code (max ${MAX_SCRIPT_CODE_LENGTH} chars)` });
      }
      existing.code = code;
      existing.version++;
    }
    if (tags !== undefined && Array.isArray(tags)) {
      existing.tags = tags.filter(t => typeof t === 'string');
    }

    existing.updatedAt = Date.now();
    saveScripts();

    res.json({ success: true, script: existing });
  });

  // ──────────────────────────────────────────────
  // DELETE /api/browser/scripts/:id — 删除脚本
  // ──────────────────────────────────────────────
  router.delete('/browser/scripts/:id', (req, res) => {
    const scripts = loadScripts();
    if (!scripts.has(req.params.id)) {
      return res.status(404).json({ error: 'Script not found' });
    }
    scripts.delete(req.params.id);
    saveScripts();
    res.json({ success: true });
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/scripts/:id/toggle — 启用/禁用
  // ──────────────────────────────────────────────
  router.post('/browser/scripts/:id/toggle', (req, res) => {
    const scripts = loadScripts();
    const script = scripts.get(req.params.id);
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    script.enabled = !script.enabled;
    script.updatedAt = Date.now();
    saveScripts();
    res.json({ success: true, enabled: script.enabled });
  });

  // ──────────────────────────────────────────────
  // POST /api/browser/scripts/:id/execute — 即时执行（在当前页面注入）
  // ──────────────────────────────────────────────
  router.post('/browser/scripts/:id/execute', async (req, res) => {
    const scripts = loadScripts();
    const script = scripts.get(req.params.id);
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }

    // 需要 CDP 连接 — 通过 BrowserManager 执行
    // 使用内部 HTTP 请求到 browser/evaluate 来执行脚本
    try {
      const apiBase = `http://127.0.0.1:${process.env.PORT || 3001}/api`;
      const response = await fetch(`${apiBase}/browser/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: script.code }),
      });
      const data = await response.json();
      res.json({ success: true, result: data });
    } catch (err) {
      res.status(502).json({ error: `Failed to execute script: ${err.message}` });
    }
  });

  return router;
}

module.exports = {
  createRouter,
  loadScripts,
  getEnabledScripts,
  matchesUrlPattern,
};
