/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider 统一出口（M1）
//
// 薄路由层：按 providerId → apiType 分派到对应适配器。
// 适配器直接复用既有 stream-openai.js / stream-anthropic.js 的
// 核心实现（迁移非重写，R1），本文件只负责「配置解析 + 路由」。
//
// stream()    — 流式（带工具调用），供 chat 主链路/Plan 消费
// chat()      — 非流式纯文本，供 memory/llm-bridge/discuss 摘要消费
// listModels()— 本地 /models 探测（惰性），云端返回静态列表
// ============================================================
'use strict';

const { getConfig, getRole: getRoleCfg, getDefaultProvider, getProviderDef } = require('./provider-config');
const { checkHealth, resolveWithFallback } = require('./provider-health');
const { buildApiUrl } = require('../llm/url');
// 适配器 = 既有实现（复用，不复制）
const { streamOpenAIWithTools, streamOpenAICore } = require('../../routes/chat/stream-openai');
const { streamAnthropicWithTools, streamAnthropicCore } = require('../../routes/chat/stream-anthropic');

/**
 * 解析调用的 provider/apiKey/baseUrl/model（v0.8.0 角色路由）。
 *
 * 优先级（每请求只命中一层，单一事实源不冲突）：
 *   1. 请求级显式值：clientProvider / clientKey / clientBaseUrl——最高优先；
 *   2. 角色级配置（_roles[role]，Claude Code 式分工：chat/plan/discuss/memory）；
 *   3. ⭐ 默认 provider（_default，用户指定）；
 *   4. 自动选择（resolveWithFallback：已配置云端优先 → 用户配置过的本地 → 裸默认）。
 * 返回的 apiKey 若为空，调用方仍可再兜底 process.env（旧行为完全保留）。
 *
 * @param {string|undefined} clientProvider — 请求带的 provider（'openai'|'anthropic'|'deepseek'...）
 * @param {string|undefined} clientKey — 请求带的 apiKey
 * @param {string|undefined} clientBaseUrl — 请求带的 baseUrl
 * @param {string} [role] — 角色（'chat'|'plan'|'discuss'|'memory'），缺省 'chat'
 * @returns {{ providerId: string, apiKey: string, baseUrl: string, model: string, fallback: boolean }}
 */
function resolveForChat(clientProvider, clientKey, clientBaseUrl, role) {
  // 1. 请求级显式 provider（最高优先）
  if (clientProvider) {
    const def = getProviderDef(clientProvider);
    // bug 修复（2026-08-04）：未知 provider 白名单校验——此前原样透传导致空 baseUrl
    if (!def) {
      return { providerId: 'openai', apiKey: clientKey || '', baseUrl: clientBaseUrl || '', model: '', fallback: false, unknownProvider: clientProvider };
    }
    const cfg = getConfig(clientProvider);
    return {
      providerId: def.id,
      apiKey: clientKey || cfg.apiKey || '',
      baseUrl: clientBaseUrl || cfg.baseUrl || def.defaultBaseUrl,
      model: cfg.model || '',
      fallback: false,
    };
  }

  // 2. 角色级配置（Claude Code 式分工）
  if (role) {
    const roleCfg = getRoleCfg(role);
    if (roleCfg && roleCfg.provider) {
      const def = getProviderDef(roleCfg.provider);
      const cfg = getConfig(roleCfg.provider);
      if (def && cfg.configured) {
        return {
          providerId: roleCfg.provider,
          apiKey: cfg.apiKey || '',
          baseUrl: cfg.baseUrl || def.defaultBaseUrl,
          model: roleCfg.model || cfg.model || '',
          fallback: false,
        };
      }
    }
  }

  // 3. ⭐ 默认 provider（用户指定）
  const defId = getDefaultProvider();
  if (defId) {
    const def = getProviderDef(defId);
    const cfg = getConfig(defId);
    if (def && cfg.configured) {
      return {
        providerId: defId,
        apiKey: cfg.apiKey || '',
        baseUrl: cfg.baseUrl || def.defaultBaseUrl,
        model: cfg.model || '',
        fallback: false,
      };
    }
  }

  // 4. 自动选择（已配置云端优先 → 用户配置过的本地 → 裸默认本地）
  const auto = resolveWithFallback();
  const def = getProviderDef(auto.providerId);
  const cfg = getConfig(auto.providerId);
  return {
    providerId: auto.providerId,
    apiKey: clientKey || cfg.apiKey || '',
    baseUrl: clientBaseUrl || cfg.baseUrl || (def ? def.defaultBaseUrl : ''),
    model: cfg.model || '',
    fallback: auto.fallback,
  };
}

/**
 * 统一流式入口（带工具调用）。
 * @param {object} opts
 * @param {string} [opts.providerId] — 指定 provider；缺省用 resolveWithFallback 选默认
 * @param {string} [opts.model]
 * @param {Array} opts.messages
 * @param {Array} [opts.tools] — 传 tools 视为「工具型调用」：失败不静默降级（R9 诚实失败）
 * @param {object} opts.res — Express res（流式写 SSE）
 * @param {Function} [opts.broadcastFn]
 * @param {object} [opts.req]
 * @param {number} [opts.maxRounds]
 * @param {string} [opts.reasoningEffort]
 * @returns {Promise<{ ok: boolean, providerId: string, fallback: boolean, error?: string }>}
 */
async function stream(opts) {
  const {
    providerId, model, messages, tools, res, broadcastFn, req,
    maxRounds, reasoningEffort,
  } = opts;

  // bug 修复（2026-08-04）：工具型调用（tools 非空）不静默降级（R9 诚实失败）——
  // 主 provider 未配置时直接报错，避免工具 schema/能力不一致
  const resolved = resolveWithFallback(providerId, { allowFallback: !(tools && tools.length) });
  const def = getProviderDef(resolved.providerId);
  if (!def) return { ok: false, providerId: resolved.providerId, fallback: false, error: `unknown provider: ${resolved.providerId}` };
  const cfg = getConfig(resolved.providerId);
  if (!cfg.configured && def.kind === 'cloud') {
    return { ok: false, providerId: resolved.providerId, fallback: resolved.fallback, error: `provider ${def.name} 未配置 key（env ${def.apiKeyEnv || '?'} 或设置页）` };
  }

  const modelName = model || cfg.model || (def.models && def.models[0]) || '';
  try {
    if (def.apiType === 'anthropic') {
      await streamAnthropicWithTools(res, messages, cfg.apiKey, modelName, cfg.baseUrl, tools, broadcastFn, req, maxRounds, reasoningEffort);
    } else {
      await streamOpenAIWithTools(res, messages, cfg.apiKey, modelName, cfg.baseUrl, tools, broadcastFn, req, maxRounds, reasoningEffort);
    }
    return { ok: true, providerId: resolved.providerId, fallback: resolved.fallback };
  } catch (err) {
    return { ok: false, providerId: resolved.providerId, fallback: resolved.fallback, error: (err && err.message) || String(err) };
  }
}

/**
 * 统一非流式纯文本（memory 摘要/discuss 汇总等）。
 * @param {object} opts
 * @param {string} [opts.providerId]
 * @param {string} [opts.model]
 * @param {Array} opts.messages
 * @param {Function} [opts.onToken]
 * @returns {Promise<{ ok: boolean, text?: string, providerId: string, fallback: boolean, error?: string }>}
 */
async function chat(opts) {
  const { providerId, model, messages, onToken } = opts;
  const resolved = resolveWithFallback(providerId);
  const def = getProviderDef(resolved.providerId);
  if (!def) return { ok: false, providerId: resolved.providerId, fallback: false, error: `unknown provider: ${resolved.providerId}` };
  const cfg = getConfig(resolved.providerId);
  if (!cfg.configured && def.kind === 'cloud') {
    return { ok: false, providerId: resolved.providerId, fallback: resolved.fallback, error: `provider ${def.name} 未配置 key` };
  }
  const modelName = model || cfg.model || (def.models && def.models[0]) || '';
  try {
    const cbs = { onToken };
    const text = def.apiType === 'anthropic'
      ? await streamAnthropicCore(cfg.baseUrl, cfg.apiKey, modelName, '', messages, cbs)
      : await streamOpenAICore(cfg.baseUrl, cfg.apiKey, modelName, messages, cbs);
    return { ok: true, text, providerId: resolved.providerId, fallback: resolved.fallback };
  } catch (err) {
    return { ok: false, providerId: resolved.providerId, fallback: resolved.fallback, error: (err && err.message) || String(err) };
  }
}

/**
 * 列出某 provider 的可用模型。
 * 本地（ollama/lmstudio/vllm）：惰性 GET {base}/models（2s 超时，探测失败返回静态空+down）
 * 云端：返回注册表静态模型列表。
 * @param {string} providerId
 * @returns {Promise<{ ok: boolean, models: string[], providerId: string, status?: string, error?: string }>}
 */
async function listModels(providerId) {
  const def = getProviderDef(providerId);
  if (!def) return { ok: false, models: [], providerId, error: `unknown provider: ${providerId}` };
  if (def.kind === 'cloud') {
    return { ok: true, models: def.models || [], providerId, status: 'static' };
  }
  const cfg = getConfig(providerId);
  const health = await checkHealth(providerId);
  if (health.status !== 'ok') {
    return { ok: false, models: [], providerId, status: health.status, error: health.error || `本地服务未运行（${cfg.baseUrl}）` };
  }
  try {
    // 用 buildApiUrl 拼接：baseUrl 含 /v1 → {base}/v1/models；不含 → 自动补 /v1（同类 bug 修复 2026-08-04）
    const url = buildApiUrl(cfg.baseUrl, def.defaultBaseUrl, '/models');
    const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) {
      return { ok: false, models: [], providerId, status: 'down', error: `HTTP ${resp.status}` };
    }
    const data = await resp.json().catch(() => ({}));
    const models = Array.isArray(data.data) ? data.data.map((m) => m.id || m.model || '').filter(Boolean) : [];
    return { ok: true, models, providerId, status: 'ok' };
  } catch (err) {
    return { ok: false, models: [], providerId, status: 'down', error: (err && err.message) || String(err) };
  }
}

module.exports = { stream, chat, listModels, resolveForChat };
