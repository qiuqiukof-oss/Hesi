/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider 注册表（M0）
//
// 单一事实源：接入新 provider = 这里加一行 + env key，主链路零改动。
// 协议约定：
//   - apiType 'openai-compat' → OpenAI Chat Completions 兼容端点（事实标准，
//     DeepSeek/千问/GLM/Kimi/Ollama/LM Studio/vLLM 全部走这个）
//   - apiType 'anthropic'     → Anthropic Messages API（唯一非兼容大厂）
// baseURL 均可被 env 覆盖（HESI_LLM_<ID>_BASE_URL），杜绝硬编码红线。
// 旧环境变量自动映射见 provider-config.js（R5 零配置迁移）。
// ============================================================
'use strict';

/**
 * @typedef {Object} ProviderDef
 * @property {string} id
 * @property {string} name
 * @property {'cloud'|'local'} kind
 * @property {'openai-compat'|'anthropic'} apiType
 * @property {string} defaultBaseUrl
 * @property {string[]} envKeys — 读 key 的 env 变量名（本地无 key 为空数组）
 * @property {string} [modelListUrl] — 本地 provider 拉模型列表的路径
 * @property {string[]} [models] — 云端 provider 静态模型列表
 * @property {string} [apiKeyEnv] — 显式 key env（openai 用 OPENAI_API_KEY 等）
 */

/** @type {ProviderDef[]} */
const REGISTRY = [
  {
    id: 'openai', name: 'OpenAI', kind: 'cloud', apiType: 'openai-compat',
    defaultBaseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o4-mini'],
  },
  {
    id: 'anthropic', name: 'Anthropic', kind: 'cloud', apiType: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  },
  {
    id: 'deepseek', name: 'DeepSeek', kind: 'cloud', apiType: 'openai-compat',
    defaultBaseUrl: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'qwen', name: '通义千问', kind: 'cloud', apiType: 'openai-compat',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'QWEN_API_KEY',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
  },
  {
    id: 'glm', name: '智谱GLM', kind: 'cloud', apiType: 'openai-compat',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'GLM_API_KEY',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  },
  {
    id: 'kimi', name: 'Kimi', kind: 'cloud', apiType: 'openai-compat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1', apiKeyEnv: 'KIMI_API_KEY',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'ollama', name: 'Ollama(本地)', kind: 'local', apiType: 'openai-compat',
    defaultBaseUrl: 'http://localhost:11434/v1', modelListUrl: '/models', models: [],
  },
  {
    id: 'lmstudio', name: 'LM Studio(本地)', kind: 'local', apiType: 'openai-compat',
    defaultBaseUrl: 'http://localhost:1234/v1', modelListUrl: '/models', models: [],
  },
  {
    id: 'vllm', name: 'vLLM(本地)', kind: 'local', apiType: 'openai-compat',
    defaultBaseUrl: 'http://localhost:8000/v1', modelListUrl: '/models', models: [],
  },
];

/**
 * 取全部注册表（副本，防外部改坏）。
 * @returns {ProviderDef[]}
 */
function getRegistry() {
  return REGISTRY.map((p) => ({ ...p }));
}

/**
 * 按 id 取 provider 定义。
 * @param {string} id
 * @returns {ProviderDef|undefined}
 */
function getProvider(id) {
  return REGISTRY.find((p) => p.id === id);
}

module.exports = { getRegistry, getProvider, REGISTRY };
