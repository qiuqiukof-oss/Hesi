/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Quant Trading Route — entry / aggregator
//
// 实时数据（腾讯 + 新浪 + 东方财富 + Binance）的量化交易路由。
// 数据抓取见 ./quant/sources.js，指标与策略引擎见 ./quant/indicators.js，
// 常量见 ./quant/constants.js，API 路由见 ./quant/routes.js。
//
// 本文件只负责聚合 createRouter 与页面路由；页面路由保留在此处，
// 以便 __dirname 正确指向项目根 public/ 目录。
// ============================================================
const path = require('path');

const { createRouter } = require('./quant/routes');

/**
 * Set up quant-related page routes.
 * @param {import('express').Application} app
 */
function setupPageRoutes(app) {
  app.get('/quant', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'quant.html'));
  });
  app.get('/media', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'media.html'));
  });
}

module.exports = { createRouter, setupPageRoutes };
