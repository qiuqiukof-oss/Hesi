/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Settings API — Export/import configuration for backup
// ============================================================
const express = require('express');
const { loadRegistry, saveRegistry } = require('../cli-discovery');
const { SENSITIVE_VAR_PATTERNS } = require('../lib/env-filter');

// ── import 白名单清洗（bug 修复 2026-08-04 审查反馈）──
// CLI 注册表合法字段（与 cli-discovery 产物一致）；未知字段一律剔除，
// 防脏 JSON 覆盖注册表/注入任意键。
const CLI_FIELDS = ['id', 'name', 'path', 'type', 'category', 'discovered', 'args', 'version', 'addedAt', 'init'];
const MAX_CLIS = 10000;      // 注册表条目上限（防超大 payload）
const MAX_STR_LEN = 2000;    // 单字段字符串上限
const MAX_ARGS_LEN = 65536;  // args（object/array）序列化上限
const MAX_FOLDERS = 1000;    // 收藏文件夹数量上限
const MAX_FOLDER_LEN = 500;  // 单个文件夹路径上限

/**
 * 清洗 import 数据为合法 registry 结构；不合法返回 null。
 * @param {object} data
 * @returns {object|null}
 */
function sanitizeRegistry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = { version: Number.isInteger(data.version) && data.version >= 1 ? data.version : 1 };
  const clis = Array.isArray(data.clis) ? data.clis : [];
  if (clis.length > MAX_CLIS) return null;
  out.clis = clis
    .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
    .map((c) => {
      const clean = {};
      for (const k of CLI_FIELDS) {
        if (!(k in c)) continue;
        const v = c[k];
        if (k === 'args') {
          if (v !== null && typeof v === 'object' && JSON.stringify(v).length <= MAX_ARGS_LEN) clean.args = v;
        } else if (typeof v === 'string' && v.length <= MAX_STR_LEN) {
          clean[k] = v;
        }
      }
      return clean;
    });
  if (Array.isArray(data.folders)) {
    out.folders = data.folders
      .filter((f) => typeof f === 'string' && f.length <= MAX_FOLDER_LEN)
      .slice(0, MAX_FOLDERS);
  }
  return out;
}

/**
 * Create the settings router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  /**
   * GET /api/settings — Export all config as JSON.
   * Returns registry + folders data for backup/download.
   */
  router.get('/settings', (req, res) => {
    try {
      const registry = loadRegistry();

      // Folders are stored inside cli-registry.json as registry.folders
      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        registry,
        folders: registry.folders || [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/settings/import — Import config from uploaded JSON.
   * Replaces registry and folders with the imported data.
   * （bug 修复 2026-08-04 审查反馈：原只校验 registry 存在，脏 JSON 可覆盖
   * CLI 注册表任意字段——增加结构白名单清洗：类型/长度/数量上限，剔除未知字段。）
   */
  router.post('/settings/import', (req, res) => {
    try {
      const data = req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) || !data.registry) {
        return res.status(400).json({ error: 'Invalid settings file: missing registry' });
      }

      // bug 修复（2026-08-04 审查反馈）：sanitizeRegistry 接收的是 registry
      // 结构本身（{version, clis, folders}），不是 {registry:...} 外壳——
      // 传错层级会导致 data.clis 恒为 undefined → 空注册表被误判合法
      const cleaned = sanitizeRegistry(data.registry);
      if (!cleaned) {
        return res.status(400).json({ error: 'Invalid settings file: registry structure rejected' });
      }

      // folders 独立清洗（不并入 registry 外壳）
      if (Array.isArray(data.folders)) {
        cleaned.folders = data.folders
          .filter((f) => typeof f === 'string' && f.length <= MAX_FOLDER_LEN)
          .slice(0, MAX_FOLDERS);
      }

      // 清洗后的 registry 落盘
      saveRegistry(cleaned);

      res.json({ success: true, message: 'Settings imported successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/settings/env — Get environment variables safe list.
   */
  router.get('/settings/env', (req, res) => {
    const safeVars = {};
    // 复用 lib/env-filter.js 的共享敏感模式（段边界匹配，覆盖 OPENAI_API_KEY /
    // QCLI_ACCESS_TOKEN 等前缀式命名；不误伤 TOKENIZERS_PARALLELISM 等无害变量）。
    // 不再使用 `^` 锚定正则——那会漏掉所有带业务前缀的密钥变量。

    for (const [key, value] of Object.entries(process.env)) {
      const isSensitive = SENSITIVE_VAR_PATTERNS.some(p => p.test(key));
      if (!isSensitive && typeof value === 'string' && value.length < 200) {
        safeVars[key] = value;
      }
    }

    res.json({ env: safeVars, count: Object.keys(safeVars).length });
  });

  return router;
}

module.exports = { createRouter, sanitizeRegistry };
