/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 共享 LLM API URL 构建工具
//
// 抽自 routes/chat/utils.js，供 chat 子系统与 lib/memory/llm-bridge.js
// 共用，确保本地 LLM（Ollama / LM Studio / vLLM 等）的 baseUrl 拼接逻辑
// 完全一致——尤其是「自动补 /v1」与 baseUrl 归一化，否则会打到错误端点
// （如 /chat/completions 而非 /v1/chat/completions）。
//
// 注意：默认本地 LLM 地址通过环境变量 HESI_LLM_BASE_URL 可覆盖，
// 不硬编码特定端口/主机，兼容用户各异的本地 LLM 部署。
// ============================================================
'use strict';

// 默认本地 LLM 地址：Ollama 惯例端口，但允许通过环境变量 HESI_LLM_BASE_URL 覆盖（用户环境各不相同）
// 注意：在调用时读取 env（非模块加载时），确保运行时可覆盖。

/**
 * Normalize a base URL for API calls.
 * Supports hostnames, IP addresses, localhost, and path-only inputs.
 * @param {string} url
 * @returns {string}
 */
function normalizeBaseUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  // 调用时读取 env 覆盖（支持运行时动态调整，不写死端口）
  const DEFAULT_LOCAL_LLM = process.env.HESI_LLM_BASE_URL || 'http://localhost:11434';
  if (url.startsWith('/')) {
    return `${DEFAULT_LOCAL_LLM}${url}`;
  }
  const isHostname = (
    /^localhost(?::\d+)?(\/|$)/i.test(url) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?(\/|$)/.test(url) ||
    /^[\w-]+(?:\.\w{2,})+(?::\d+)?(\/|$)/.test(url) ||
    /^[\w.-]+:\d+(\/|$)/.test(url)
  );
  if (isHostname) {
    return `http://${url}`;
  }
  return `${DEFAULT_LOCAL_LLM}/${url}`;
}

/**
 * Build a full API URL from a base URL, default URL, and endpoint path.
 * 关键：若 baseUrl 未带 /v1，自动补上（本地 LLM 的 OpenAI 兼容端点多为 /v1/chat/completions）。
 * @param {string} baseUrl - User-provided base URL (may be null/undefined)
 * @param {string} defaultUrl - Default API base (e.g. 'https://api.openai.com/v1')
 * @param {string} endpoint - Endpoint path (e.g. '/chat/completions')
 * @returns {string}
 */
function buildApiUrl(baseUrl, defaultUrl, endpoint) {
  const normalized = normalizeBaseUrl(baseUrl) || defaultUrl;
  const clean = normalized.replace(/\/+$/, '');
  if (/\/v1(\/|$)/i.test(clean)) {
    return clean + endpoint;
  }
  return `${clean}/v1${endpoint}`;
}

module.exports = { normalizeBaseUrl, buildApiUrl };
