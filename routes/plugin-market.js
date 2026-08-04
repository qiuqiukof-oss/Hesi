/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plugin Market — 插件市场路由（聚合器）
//
// 提供从 GitHub 发现、搜索、安装 Hesi 插件的一站式 API。
// 插件仓库应包含根目录的 plugin.json 文件，并添加 GitHub
// topic "cli-q-plugin" 以便自动发现。
//
// API:
//   GET  /api/plugins/market
//        → 返回精选插件 + GitHub 话题发现结果（缓存 5 分钟）
//   GET  /api/plugins/market?force=1
//        → 绕过缓存，强制从 GitHub 刷新数据
//
//   GET  /api/plugins/market/search?q=<query>
//        → 在 GitHub 中搜索含 "cli-q-plugin" topic 的仓库
//
//   POST /api/plugins/market/install
//        Body: { repo: "owner/repo", url?: "...", branch?: "main" }
//        → git clone 到 plugins/<dirname>/，然后加载
//
//   GET  /api/plugins/market/installed
//        → 列出 plugins/ 目录下所有目录（含未加载的）
//
//   DELETE /api/plugins/market/installed/:name
//        → 卸载插件 + 删除插件目录
//
// 该文件只负责挂载子路由；纯逻辑见 ./plugin-market/helpers.js，
// 发现/搜索路由见 ./plugin-market/discovery.js，安装路由见
// ./plugin-market/install.js。
// ============================================================
const { Router } = require('express');

const { createDiscoveryRouter } = require('./plugin-market/discovery');
const { createInstallRouter } = require('./plugin-market/install');
const { createDocRouter } = require('./plugin-market/doc');
const { _test } = require('./plugin-market/helpers');

/**
 * 创建插件市场路由。
 * @param {object} opts
 * @param {object} [opts.pluginLoader] — PluginLoader 实例（安装后自动加载）
 * @param {Function} [opts.broadcastFn] — WebSocket 广播函数，用于推送安装进度
 * @returns {import('express').Router}
 */
function createRouter(opts = {}) {
  const router = Router();
  router.use(createDiscoveryRouter(opts));
  router.use(createInstallRouter(opts));
  router.use(createDocRouter());
  return router;
}

module.exports = { createRouter };
// 透传测试用导出，保持 test/plugin-install-flow.test.js 的契约不变。
module.exports._test = _test;
