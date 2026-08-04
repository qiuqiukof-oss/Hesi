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

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'llm-providers.json');

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
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
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

  if (fields.apiKey !== undefined) next.apiKey = String(fields.apiKey).trim();
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
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (err) {
    return { ok: false, error: `failed to write config file: ${(err && err.message) || err}` };
  }

  const warnings = [];
  if (fields.apiKey && readKeyFromEnv(def)) {
    warnings.push(`env 中的 ${def.apiKeyEnv} 优先于设置页值，本次文件配置不生效`);
  }
  return { ok: true, ...(warnings.length ? { warning: warnings.join('；') } : {}) };
}

module.exports = { getConfig, getAllConfigs, setConfig, CONFIG_FILE };
