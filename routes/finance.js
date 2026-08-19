/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Finance Route — entry / aggregator
//
// 预算 / 销账 / 统计 / AI 建议的 REST 路由。数据持久化见
// ./finance/store.js，建议启发式见 ./finance/suggestions.js，
// API 路由见 ./finance/routes.js。
//
// 本文件只负责聚合 createRouter 与页面路由；页面路由保留在此处，
// 以便 __dirname 正确指向项目根 public/ 目录。
// ============================================================
const path = require('path');

const { createRouter } = require('./finance/routes');

/**
 * Set up finance-related page routes.
 * @param {import('express').Application} app
 */
function setupPageRoutes(app) {
  app.get('/budget', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'budget.html'));
  });
}

module.exports = { createRouter, setupPageRoutes };
