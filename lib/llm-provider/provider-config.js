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
 * @param {string} id
 * @returns {{ apiKey: string, baseUrl: string, model?: string, source: 'env'|'file'|'none', configured: boolean }}
 */
function getConfig(id) {
  const def = getRegistry().find((p) => p.id === id);
  if (!def) return { apiKey: '', baseUrl: '', source: 'none', configured: false };

  const fileCfg = readFileConfig()[id] || {};
  const envKey = readKeyFromEnv(def);
  const envBase = readBaseUrlFromEnv(id);

  const apiKey = envKey || fileCfg.apiKey || '';
  const baseUrl = envBase || fileCfg.baseUrl || def.defaultBaseUrl;
  const model = fileCfg.model || (def.models && def.models[0]) || '';

  const hasEnv = !!(envKey || envBase);
  const hasFile = !!(fileCfg.apiKey || fileCfg.baseUrl || fileCfg.model);
  return {
    apiKey,
    baseUrl,
    model,
    source: hasEnv ? 'env' : (hasFile ? 'file' : 'none'),
    configured: !!apiKey || def.kind === 'local', // 本地 provider 无需 key 即视为可配置
  };
}

/**
 * 全部 provider 的生效配置（脱敏：key 只留尾 4 位，供设置页展示）。
 * @returns {Array<{ id: string, name: string, kind: string, apiType: string, configured: boolean, source: string, maskedKey: string, baseUrl: string, model?: string }>}
 */
function getAllConfigs() {
  return getRegistry().map((def) => {
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
  const def = getRegistry().find((p) => p.id === id);
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
  const def = getRegistry().find((p) => p.id === id);
  return def ? id : '';
}

/**
 * 设置 ⭐ 默认 provider（须为已注册且已配置的 provider）。
 * @param {string} id
 * @returns {{ ok: boolean, error?: string }}
 */
function setDefaultProvider(id) {
  if (!id) return { ok: false, error: 'provider required' };
  const def = getRegistry().find((p) => p.id === id);
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
    const def = getRegistry().find((p) => p.id === fields.provider);
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

module.exports = { getConfig, getAllConfigs, setConfig, getConfigFile, getDefaultProvider, setDefaultProvider, getRole, setRole, ROLES };
