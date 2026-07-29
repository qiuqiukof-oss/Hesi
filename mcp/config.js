/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Config — environment variables with sensible defaults
// ============================================================

const config = {
  // ── Hesi API / WS endpoints ──
  // 必须与 server.js 的实际端口一致（默认 4264）。优先用 QCLI_API_URL 覆盖，
  // 否则回退到 process.env.PORT（MCP 子进程从父进程继承该环境变量），
  // 再回退到 4264。切勿硬编码 3001（旧默认值，会导致 MCP 工具全部打错端口）。
  apiBase: process.env.QCLI_API_URL || `http://127.0.0.1:${process.env.PORT || 4264}/api`,
  wsUrl: process.env.QCLI_WS_URL || `ws://127.0.0.1:${process.env.PORT || 4264}`,

  // ── Session defaults ──
  cmdTimeout: parseInt(process.env.QCLI_CMD_TIMEOUT, 10) || 15000,
  cmdDrainMs: parseInt(process.env.QCLI_CMD_DRAIN, 10) || 2000,
  sessionTtlMs: parseInt(process.env.QCLI_SESSION_TTL, 10) || 900000, // 15 min
  maxSessions: parseInt(process.env.QCLI_MAX_SESSIONS, 10) || 10,
  ringBufferSize: parseInt(process.env.QCLI_RING_BUFFER, 10) || 5000,
  wsConnectTimeoutMs: parseInt(process.env.QCLI_WS_TIMEOUT, 10) || 10000, // 10s

  // ── Security ──
  mcpToken: process.env.QCLI_MCP_TOKEN || "",
  policyPath: process.env.QCLI_POLICY_PATH || "",

  // ── Server metadata ──
  serverName: "qcli-hub",
  serverVersion: "1.2.0",
};

module.exports = config;
