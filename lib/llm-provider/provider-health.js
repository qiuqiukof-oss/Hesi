/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider 健康探测 + fallback 降级路由（M2）
//
// 惰性探测：首次调用才 GET {base}/models（2s 超时），不阻塞启动（R8）。
// 状态：ok / degraded（key 无效 401）/ down / unconfigured（云端无 key）/ unknown（未探）
//
// fallback 策略（R9 诚实失败）：
//   - 工具型调用（tools 非空）→ 不降级，直接报错（避免模型能力不一致）；
//   - 纯文本调用（chat/摘要）→ 主 provider 失败自动降级到备用 provider，打标 fallback。
// ============================================================
'use strict';

const { getRegistry, getProvider } = require('./provider-registry');
const { getConfig } = require('./provider-config');
const { buildApiUrl } = require('../llm/url');

/** @type {Map<string, { status: string, checkedAt: number, error?: string }>} */
const healthCache = new Map();
const HEALTH_TTL_MS = 30000; // 30s 缓存，POST /api/llm-providers/health 可强制刷新

/**
 * 探测单 provider 健康状态（openai-compat 打 {base}/models；anthropic 打 /v1/models）。
 * @param {string} providerId
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ status: string, providerId: string, error?: string, checkedAt: number }>}
 */
async function checkHealth(providerId, opts = {}) {
  const def = getProvider(providerId);
  if (!def) return { status: 'unknown', providerId, error: `unknown provider: ${providerId}`, checkedAt: 0 };

  const cached = healthCache.get(providerId);
  if (!opts.force && cached && (Date.now() - cached.checkedAt) < HEALTH_TTL_MS) {
    return { ...cached, providerId };
  }

  const cfg = getConfig(providerId);
  const result = { providerId, checkedAt: Date.now() };

  // 云端无 key → unconfigured（不探测，省调用）
  if (def.kind === 'cloud' && !cfg.apiKey) {
    result.status = 'unconfigured';
    healthCache.set(providerId, result);
    return result;
  }

  // 本地 provider 未配置 baseUrl（理论不会，有 defaultBaseUrl）→ down
  if (!cfg.baseUrl) {
    result.status = 'down';
    result.error = 'baseUrl 未配置';
    healthCache.set(providerId, result);
    return result;
  }

  try {
    // 端点：openai-compat / anthropic 统一用 buildApiUrl 拼 /models——
    // baseUrl 含 /v1 → {base}/v1/models；不含 → 自动补 /v1（同类 bug 修复 2026-08-04）
    const url = buildApiUrl(cfg.baseUrl, def.defaultBaseUrl, '/models');
    const headers = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      result.status = 'ok';
    } else if (resp.status === 401 || resp.status === 403) {
      result.status = 'degraded';
      result.error = `key 无效（HTTP ${resp.status}）`;
    } else {
      result.status = 'down';
      result.error = `HTTP ${resp.status}`;
    }
  } catch (err) {
    result.status = 'down';
    result.error = (err && err.name === 'AbortError') ? '连接超时(2s)' : ((err && err.message) || String(err));
  }

  healthCache.set(providerId, result);
  return result;
}

/**
 * 全部 provider 状态（设置页可视化）。
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<Array<{ id: string, name: string, kind: string, status: string, error?: string }>>}
 */
async function healthAll(opts = {}) {
  const defs = getRegistry();
  const results = await Promise.all(defs.map((d) => checkHealth(d.id, opts)));
  return results.map((r) => {
    const def = getProvider(r.providerId);
    return { id: r.providerId, name: def ? def.name : r.providerId, kind: def ? def.kind : '', status: r.status, error: r.error };
  });
}

/**
 * 解析本次调用应使用的 provider（主 → 降级）。
 * @param {string} [preferredId] — 调用方指定的 provider；缺省自动选（已配置云端优先，其次本地 ok）
 * @param {{ allowFallback?: boolean }} [opts] — allowFallback=false（工具型调用）→ 不降级
 * @returns {{ providerId: string, fallback: boolean }}
 */
function resolveWithFallback(preferredId, opts = {}) {
  const allowFallback = opts.allowFallback !== false;
  if (preferredId) {
    const def = getProvider(preferredId);
    if (def) {
      const cfg = getConfig(preferredId);
      if (cfg.configured || def.kind === 'local') return { providerId: preferredId, fallback: false };
      if (allowFallback) return pickFallback(preferredId);
      return { providerId: preferredId, fallback: false }; // 诚实失败：调用方会拿到未配置错误
    }
  }

  // 自动选择：已配置云端 provider 优先（按注册表顺序）
  for (const def of getRegistry()) {
    const cfg = getConfig(def.id);
    if (def.kind === 'cloud' && cfg.configured) return { providerId: def.id, fallback: false };
  }
  // 本地：优先「用户配置过的」（设置页/env 写过 key/baseUrl/model，如 LM Studio 1234），
  // 其次才回落到裸默认本地（ollama 11434）——避免无视用户配置（bug 修复 2026-08-04）
  for (const def of getRegistry()) {
    if (def.kind !== 'local') continue;
    const cfg = getConfig(def.id);
    if (cfg.source !== 'none') return { providerId: def.id, fallback: false };
  }
  for (const def of getRegistry()) {
    if (def.kind === 'local') return { providerId: def.id, fallback: false };
  }
  return { providerId: 'openai', fallback: false };
}

/** 主 provider 不可用时的备用选择（跳过主，取第一个已配置的其它 provider）。 */
function pickFallback(mainId) {
  for (const def of getRegistry()) {
    if (def.id === mainId) continue;
    const cfg = getConfig(def.id);
    if (def.kind === 'cloud' && cfg.configured) return { providerId: def.id, fallback: true };
  }
  // 本地备用同理：用户配置过的优先
  for (const def of getRegistry()) {
    if (def.id === mainId || def.kind !== 'local') continue;
    const cfg = getConfig(def.id);
    if (cfg.source !== 'none') return { providerId: def.id, fallback: true };
  }
  for (const def of getRegistry()) {
    if (def.id === mainId) continue;
    if (def.kind === 'local') return { providerId: def.id, fallback: true };
  }
  return { providerId: mainId, fallback: false }; // 无备用 → 诚实失败
}

module.exports = { checkHealth, healthAll, resolveWithFallback, HEALTH_TTL_MS };
