/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider 配置加载（M0）
//
// 优先级：env（进程环境变量）优先 → data/llm-providers.json 覆盖（设置页写入）。
//   - env 是「部署级」配置（.env / 环境变量），始终优先，不落盘不泄露；
//   - data/llm-providers.json 是「用户级」配置（web 设置页写入），gitignore 覆盖不入库；
//   - 二者合并：env 有 → 用 env；env 无 → 用文件。
//
// R5 零配置迁移：旧环境变量自动映射到对应 provider——
//   OPENAI_API_KEY            → openai.apiKey
//   ANTHROPIC_API_KEY         → anthropic.apiKey
//   HESI_LLM_BASE_URL         → 本地 openai-compat 的 baseUrl 兜底（url.js 运行时读，保持兼容）
//   HESI_LLM_<ID>_BASE_URL    → 任意 provider 的 baseUrl 覆盖（杜绝硬编码红线）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { getRegistry } = require('./provider-registry');

// 配置文件路径：默认 data/llm-providers.json；HESI_LLM_PROVIDERS_CONFIG 可覆盖
// （测试隔离用：测试走临时文件，不碰真实用户配置，避免残留污染）
function getConfigFile() {
  return process.env.HESI_LLM_PROVIDERS_CONFIG || path.join(__dirname, '..', '..', 'data', 'llm-providers.json');
}

/** 从 env 读取某 provider 的 key。@param {import('./provider-registry').ProviderDef} def @returns {string} */
function readKeyFromEnv(def) {
  if (!def.apiKeyEnv) return '';
  return process.env[def.apiKeyEnv] || '';
}

/** 从 env 读取某 provider 的 baseUrl 覆盖（HESI_LLM_<ID>_BASE_URL）。@param {string} id @returns {string} */
function readBaseUrlFromEnv(id) {
  const key = `HESI_LLM_${id.toUpperCase()}_BASE_URL`;
  return process.env[key] || '';
}

/** 读取 data/llm-providers.json（不存在返回 {}）。@returns {Record<string, object>} */
function readFileConfig() {
  try {
    const raw = fs.readFileSync(getConfigFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 合并某 provider 的生效配置（env 优先 → 文件覆盖）。
 * 支持注册表 + 自定义 provider（自定义的 apiKey/baseUrl/model 直接来自 _custom 条目）。
 * @param {string} id
 * @returns {{ apiKey: string, baseUrl: string, model?: string, source: 'env'|'file'|'custom'|'none', configured: boolean }}
 */
function getConfig(id) {
  const def = getProviderDef(id);
  if (!def) return { apiKey: '', baseUrl: '', source: 'none', configured: false };

  const fileCfg = readFileConfig()[id] || {};
  const envKey = readKeyFromEnv(def);
  const envBase = readBaseUrlFromEnv(id);

  const apiKey = envKey || fileCfg.apiKey || def._customApiKey || '';
  const baseUrl = envBase || fileCfg.baseUrl || def.defaultBaseUrl;
  const model = fileCfg.model || def._customModel || (def.models && def.models[0]) || '';

  const hasEnv = !!(envKey || envBase);
  const hasFile = !!(fileCfg.apiKey || fileCfg.baseUrl || fileCfg.model);
  const hasCustom = !!(def._custom && (def._customApiKey || def.defaultBaseUrl));
  return {
    apiKey,
    baseUrl,
    model,
    source: hasEnv ? 'env' : (hasFile ? 'file' : (hasCustom ? 'custom' : 'none')),
    configured: !!apiKey || def.kind === 'local' || hasCustom, // 自定义有 baseUrl 即视为可配置
  };
}

/**
 * 全部 provider 的生效配置（脱敏：key 只留尾 4 位，供设置页展示）。
 * @returns {Array<{ id: string, name: string, kind: string, apiType: string, configured: boolean, source: string, maskedKey: string, baseUrl: string, model?: string }>}
 */
function getAllConfigs() {
  return getAllDefs().map((def) => {
    const cfg = getConfig(def.id);
    const key = cfg.apiKey;
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      apiType: def.apiType,
      configured: cfg.configured,
      source: cfg.source,
      maskedKey: key ? `****${key.slice(-4)}` : '',
      baseUrl: cfg.baseUrl,
      model: cfg.model || '',
      custom: !!def._custom,
    };
  });
}

/**
 * 写入某 provider 的用户级配置（data/llm-providers.json）。
 * 只允许写文件字段（apiKey/baseUrl/model），env 始终优先，不覆盖。
 * @param {string} id
 * @param {{ apiKey?: string, baseUrl?: string, model?: string }} fields
 * @returns {{ ok: boolean, error?: string, warning?: string }}
 */
function setConfig(id, fields) {
  const def = getProviderDef(id);
  if (!def) return { ok: false, error: `unknown provider: ${id}` };
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'fields required' };

  const all = readFileConfig();
  const prev = all[id] || {};
  const next = { ...prev };

  // bug 修复（2026-08-04）：脱敏占位符（****xxxx）不应作为真实 key 写入——
  // 前端回显 masked 后若原样提交，会污染文件配置（env 优先时虽不生效但会造成困惑）
  const MASK_RE = /^\*{4,}/;
  if (fields.apiKey !== undefined) {
    const v = String(fields.apiKey).trim();
    if (MASK_RE.test(v)) {
      return { ok: false, error: '检测到脱敏占位符：请粘贴完整 API Key（留空则保持原配置）' };
    }
    next.apiKey = v;
  }
  if (fields.baseUrl !== undefined) next.baseUrl = String(fields.baseUrl).trim();
  if (fields.model !== undefined) next.model = String(fields.model).trim();

  // 全部为空 → 删除该 provider 的文件配置（回到 env/none）
  const hasAny = !!next.apiKey || !!next.baseUrl || !!next.model;
  if (!hasAny) {
    delete all[id];
  } else {
    all[id] = next;
  }

  try {
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    return { ok: false, error: `failed to write config file: ${(err && err.message) || err}` };
  }

  const warnings = [];
  if (fields.apiKey && readKeyFromEnv(def)) {
    warnings.push(`env 中的 ${def.apiKeyEnv} 优先于设置页值，本次文件配置不生效`);
  }
  return { ok: true, ...(warnings.length ? { warning: warnings.join('；') } : {}) };
}

// ── 角色路由（v0.8.0 · Claude Code 式多模型分工）──
// 每个角色可独立指定 { provider, model }；不指定则回落 ⭐ 默认 provider → 自动选择。
// 存储：data/llm-providers.json 顶层保留字段 _default / _roles（provider id 不会冲突）。

/** 角色清单（与消费方对应）。 */
const ROLES = ['chat', 'plan', 'discuss', 'memory'];

/** 读取 ⭐ 默认 provider id。@returns {string} */
function getDefaultProvider() {
  const all = readFileConfig();
  const id = all._default;
  if (!id) return '';
  const def = getProviderDef(id);
  return def ? id : '';
}

/**
 * 设置 ⭐ 默认 provider（须为已注册且已配置的 provider）。
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
function setDefaultProvider(id) {
  if (!id) return { ok: false, error: 'provider required' };
  const def = getProviderDef(id);
  if (!def) return { ok: false, error: `unknown provider: ${id}` };
  const cfg = getConfig(id);
  if (!cfg.configured && def.kind === 'cloud') {
    return { ok: false, error: `provider ${def.name} 未配置，不能设为默认` };
  }
  const all = readFileConfig();
  all._default = id;
  try {
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `failed to write config file: ${(err && err.message) || err}` };
  }
}

/**
 * 读取某角色的分工配置。
 * @param {string} role — 'chat' | 'plan' | 'discuss' | 'memory'
 * @returns {{ provider: string, model: string }}
 */
function getRole(role) {
  if (!ROLES.includes(role)) return { provider: '', model: '' };
  const all = readFileConfig();
  const r = (all._roles && all._roles[role]) || {};
  return { provider: String(r.provider || ''), model: String(r.model || '') };
}

/**
 * 设置某角色的分工（provider/model 可留空表示回落默认）。
 * @param {string} role
 * @param {{ provider?: string, model?: string }} fields
 * @returns {{ ok: boolean, error?: string }}
 */
function setRole(role, fields) {
  if (!ROLES.includes(role)) return { ok: false, error: `unknown role: ${role}（可选 ${ROLES.join('/')}）` };
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'fields required' };
  if (fields.provider) {
    const def = getProviderDef(fields.provider);
    if (!def) return { ok: false, error: `unknown provider: ${fields.provider}` };
  }
  const all = readFileConfig();
  if (!all._roles || typeof all._roles !== 'object') all._roles = {};
  const next = { ...(all._roles[role] || {}) };
  if (fields.provider !== undefined) next.provider = String(fields.provider).trim();
  if (fields.model !== undefined) next.model = String(fields.model).trim();
  // 两者皆空 → 删除该角色（回落默认）
  if (!next.provider && !next.model) {
    delete all._roles[role];
  } else {
    all._roles[role] = next;
  }
  try {
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `failed to write config file: ${(err && err.message) || err}` };
  }
}

module.exports = { getConfig, getAllConfigs, setConfig, getConfigFile, getDefaultProvider, setDefaultProvider, getRole, setRole, ROLES, getProviderDef, getAllDefs, getCustomProviders, addCustomProvider, updateCustomProvider, removeCustomProvider, defNeedsKey };

/**
 * provider 是否强制需要 API Key。
 * 内置云端（openai/deepseek/...）→ 需要；本地（lmstudio/ollama/vllm）与
 * 自定义 provider（用户显式配置端点，_custom）→ 不强制（内网中转/自建网关
 * 常见无 key 或 key 随意，有 key 用 key、无 key 直接调）。
 * @param {import('./provider-registry').ProviderDef} def
 * @returns {boolean}
 */
function defNeedsKey(def) {
  return !!(def && def.kind === 'cloud' && !def._custom);
}

// ── 自定义 provider（v0.8.0 · 模型广场「➕ 自定义」入口）──
// 存储：data/llm-providers.json 顶层 `_custom` 数组（id 不与注册表冲突）。
// 支持私有/自建 OpenAI 兼容端点（one-api / new-api / 内网中转等）。
// 解析：getProviderDef/getAllDefs 合并注册表 + 自定义，消费方统一走这两个视图。

/**
 * 自定义条目转 ProviderDef（视图用，不落注册表）。
 * @param {object} c — { id, name, baseUrl, apiKey, model }
 * @returns {import('./provider-registry').ProviderDef}
 */
function customToDef(c) {
  return {
    id: String(c.id || ''),
    name: String(c.name || c.id || 'custom'),
    kind: 'cloud',
    apiType: 'openai-compat',
    defaultBaseUrl: String(c.baseUrl || ''),
    envKeys: [],
    apiKeyEnv: '',
    models: c.model ? [String(c.model)] : [],
    _custom: true,
    _customApiKey: String(c.apiKey || ''),
    _customModel: String(c.model || ''),
  };
}

/** 读取全部自定义 provider（_custom 数组，校验字段）。@returns {Array<{ id: string, name: string, baseUrl: string, apiKey: string, model: string }>} */
function getCustomProviders() {
  const all = readFileConfig();
  const arr = Array.isArray(all._custom) ? all._custom : [];
  return arr
    .filter((c) => c && typeof c === 'object' && /^[a-z0-9-]{2,40}$/.test(String(c.id || '')))
    .map((c) => ({
      id: String(c.id),
      name: String(c.name || c.id),
      baseUrl: String(c.baseUrl || ''),
      apiKey: String(c.apiKey || ''),
      model: String(c.model || ''),
    }));
}

/** 按 id 查定义（注册表优先，其次自定义）。@param {string} id @returns {import('./provider-registry').ProviderDef|undefined} */
function getProviderDef(id) {
  if (!id) return undefined;
  const builtin = getRegistry().find((p) => p.id === id);
  if (builtin) return builtin;
  const c = getCustomProviders().find((x) => x.id === id);
  return c ? customToDef(c) : undefined;
}

/** 全部定义（注册表 + 自定义）。@returns {import('./provider-registry').ProviderDef[]} */
function getAllDefs() {
  return getRegistry().concat(getCustomProviders().map(customToDef));
}

/** 持久化 _custom 数组（原子写）。@param {Array} custom @returns {{ ok: boolean, error?: string }} */
function persistCustom(custom) {
  try {
    const all = readFileConfig();
    all._custom = custom;
    const file = getConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `failed to write config file: ${(err && err.message) || err}` };
  }
}

/**
 * 新增自定义 provider。
 * @param {{ id: string, name?: string, baseUrl: string, apiKey?: string, model?: string }} fields
 * @returns {{ ok: boolean, error?: string, warning?: string }}
 */
function addCustomProvider(fields) {
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'fields required' };
  const id = String(fields.id || '').trim();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) {
    return { ok: false, error: 'id 须为 2-40 位小写字母/数字/连字符（kebab-case）' };
  }
  if (getRegistry().some((p) => p.id === id)) {
    return { ok: false, error: `id "${id}" 与内置 provider 冲突，请换一个` };
  }
  const existing = getCustomProviders();
  if (existing.some((c) => c.id === id)) {
    return { ok: false, error: `自定义 provider "${id}" 已存在，可更新或删除` };
  }
  const baseUrl = String(fields.baseUrl || '').trim();
  if (!baseUrl) return { ok: false, error: 'baseUrl 必填' };
  if (!/^https?:\/\//.test(baseUrl)) return { ok: false, error: 'baseUrl 须以 http(s):// 开头' };

  const entry = {
    id,
    name: String(fields.name || id).trim().slice(0, 40),
    baseUrl,
    apiKey: String(fields.apiKey || '').trim(),
    model: String(fields.model || '').trim(),
  };
  const r = persistCustom(existing.concat(entry));
  return r.ok ? { ok: true, provider: entry } : r;
}

/**
 * 更新自定义 provider。
 * @param {string} id
 * @param {{ name?: string, baseUrl?: string, apiKey?: string, model?: string }} fields
 * @returns {{ ok: boolean, error?: string }}
 */
function updateCustomProvider(id, fields) {
  const list = getCustomProviders();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return { ok: false, error: `自定义 provider "${id}" 不存在` };
  if (!fields || typeof fields !== 'object') return { ok: false, error: 'fields required' };
  const cur = list[idx];
  if (fields.baseUrl !== undefined) {
    const b = String(fields.baseUrl).trim();
    if (b && !/^https?:\/\//.test(b)) return { ok: false, error: 'baseUrl 须以 http(s):// 开头' };
    if (b) cur.baseUrl = b;
  }
  if (fields.name !== undefined) cur.name = String(fields.name).trim().slice(0, 40) || cur.name;
  if (fields.apiKey !== undefined) cur.apiKey = String(fields.apiKey).trim();
  if (fields.model !== undefined) cur.model = String(fields.model).trim();
  const r = persistCustom(list);
  return r.ok ? { ok: true } : r;
}

/**
 * 删除自定义 provider。
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
function removeCustomProvider(id) {
  const list = getCustomProviders();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return { ok: false, error: `自定义 provider "${id}" 不存在` };
  const all = readFileConfig();
  if (all._default === id) delete all._default; // 清掉默认指向
  if (all._roles) {
    for (const role of Object.keys(all._roles)) {
      if (all._roles[role] && all._roles[role].provider === id) delete all._roles[role];
    }
  }
  const r = persistCustom(next);
  return r.ok ? { ok: true } : r;
}
