/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Switch — 生命周期 onLoad：确保插件数据目录存在。
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DATA = path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'hesi-switch');

/** @param {object} _ctx — 插件上下文（plugin/loader） */
function onLoad(_ctx) {
  try {
    fs.mkdirSync(PLUGIN_DATA, { recursive: true });
  } catch { /* ignore */ }
  console.log('[hesi-switch] 插件已加载：对外 OpenAI 兼容网关就绪（/api/plugins/hesi-switch/v1/chat/completions）');
}

module.exports = onLoad;
