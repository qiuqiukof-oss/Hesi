/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// web-grounding.js — Hesi 插件 handler（薄代理）
//
// 复制即用：本插件内嵌 lib/ 核心（由独立包 sync-hesi-plugin.js 同步，
// playwright 由 Hesi 宿主 node_modules 提供），handler 直接 require
// 插件自身 lib/index，零环境变量、零外部依赖。
//
// 可选覆盖：设 env WG_STANDALONE_DIR 时改从该目录加载（独立包分离部署）。
// ============================================================

const path = require('path');
const fs = require('fs');

/** 优先 env 指定，否则用插件内嵌 lib（复制即用路径） */
function resolveStandaloneDir() {
  if (process.env.WG_STANDALONE_DIR) return process.env.WG_STANDALONE_DIR;
  return path.join(__dirname, '..'); // handlers/ → 插件根（含 lib/）
}

function loadStandalone() {
  const dir = resolveStandaloneDir();
  const entry = path.join(dir, 'lib', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `未找到 ${entry}。插件内嵌 lib 缺失（重新运行独立包 npm run sync-plugin），` +
        '或用 WG_STANDALONE_DIR 指向独立包。'
    );
  }
  return {
    dir,
    wg: require(entry),
    format: require(path.join(dir, 'lib', 'format')),
  };
}

/**
 * 执行 AI 工具。
 * @param {object} args 工具参数
 * @param {object} context { broadcastFn, plugin, pluginLoader, toolName }
 * @returns {Promise<string>} 文本结果
 */
async function execute(args, context) {
  const name = context && context.toolName;
  const a = args || {};
  let lib;
  try {
    lib = loadStandalone();
  } catch (e) {
    return `web-grounding 插件不可用：${e.message}`;
  }
  const { wg, format } = lib;

  try {
    if (name === 'web_grounding_status') {
      return JSON.stringify(wg.status(), null, 2);
    }

    const json = a.format === 'json';
    const fmt = json ? 'json' : 'text';

    if (name === 'web_grounding_search') {
      const query = String(a.query || '').trim();
      if (!query) return 'web_grounding_search 缺少必填参数 query';
      const r = await wg.read(query, { format: fmt, maxChars: a.maxChars || 6000 });
      return json ? JSON.stringify(r, null, 2) : format.formatResult('search', query, r);
    }

    if (name === 'web_grounding_fetch') {
      const url = String(a.url || '').trim();
      if (!url) return 'web_grounding_fetch 缺少必填参数 url';
      const r = await wg.read(url, { format: fmt, maxChars: a.maxChars || 12000 });
      return json ? JSON.stringify(r, null, 2) : format.formatResult('fetch', url, r);
    }

    return `未知工具: ${name}`;
  } catch (e) {
    return `web-grounding 调用失败: ${(e && e.message) || e}`;
  }
}

module.exports = { execute };
