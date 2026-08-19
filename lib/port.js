/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 端口单一事实源（Single Source of Truth）
//
// 历史包袱：Hesi 内部多处（internal-api / chat utils / browser helpers /
// csp）各自写死端口字面量，server.js 默认 4264、内部调用兜底 3001 —— 同一
// 实例里端口分裂、默认部署内部 API 连死端口。此模块集中所有端口读取，避免
// 后续散落字面量继续制造同类 bug。
//
// 用法：
//   const { getPort } = require('./lib/port');
//   const port = getPort();           // 数字
//   apiBase = `http://127.0.0.1:${port}/api`;
//
// 注意：
// - server.js 启动期会执行 syncPortToEnv()，把 getPort() 的结果写回 process.env.PORT，
//   让未迁移的旧调用点（如 `process.env.PORT || 4264`）也能正确读到一致端口。
// - 默认 4264 与 server.js / mcp / CLI 保持一致；改默认值请同步改 server.js:52。
// ============================================================
'use strict';

const DEFAULT_PORT = 4264;

function getPort() {
  const envPort = parseInt(process.env.PORT, 10);
  if (Number.isFinite(envPort) && envPort > 0 && envPort < 65536) {
    return envPort;
  }
  return DEFAULT_PORT;
}

// 防御性：把解析后的端口同步回 process.env，消除历史散落的
// `process.env.PORT || 3001` 这类写法造成的端口分裂。
// server.js 启动期调用一次即可。
function syncPortToEnv() {
  const port = getPort();
  if (String(process.env.PORT) !== String(port)) {
    process.env.PORT = String(port);
  }
  return port;
}

module.exports = { getPort, syncPortToEnv, DEFAULT_PORT };