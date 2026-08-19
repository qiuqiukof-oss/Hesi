/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// LLM Provider 统一模块单元测试（M0-M2）
//   provider-registry 注册表完整性
//   provider-config  env 优先 / 文件覆盖 / 旧 env 映射 / 脱敏
//   provider-health   resolveWithFallback 降级路由
// ============================================================
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { getRegistry, getProvider } = require('../lib/llm-provider/provider-registry');
const providerConfig = require('../lib/llm-provider/provider-config');
const { resolveWithFallback } = require('../lib/llm-provider/provider-health');

const SAVED_ENV = { ...process.env };

// 测试隔离（修复 2026-08-04）：用临时配置文件，不碰真实 data/llm-providers.json——
// 此前直接操作真实文件，删除失败会残留污染（曾覆盖用户真实 lmstudio 配置）
const TMP_CONFIG = path.join(require('os').tmpdir(), `hesi-llm-test-${process.pid}.json`);

beforeEach(() => {
  // 清掉可能残留的 env，隔离测试
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.QWEN_API_KEY;
  delete process.env.GLM_API_KEY;
  delete process.env.KIMI_API_KEY;
  delete process.env.HESI_LLM_OPENAI_BASE_URL;
  delete process.env.HESI_LLM_DEEPSEEK_BASE_URL;
  // 指向临时配置文件（不碰真实 data/）
  process.env.HESI_LLM_PROVIDERS_CONFIG = TMP_CONFIG;
  try { fs.unlinkSync(TMP_CONFIG); } catch { /* ignore */ }
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  try { fs.unlinkSync(TMP_CONFIG); } catch { /* ignore */ }
});

// ── 注册表 ──
test('registry: 含 12 家 provider 且字段完整', () => {
  const reg = getRegistry();
  assert.strictEqual(reg.length, 12);
  const ids = reg.map((p) => p.id);
  for (const id of ['openai', 'anthropic', 'deepseek', 'qwen', 'glm', 'kimi', 'openrouter', 'opencode-zen', 'nvidia-nim', 'ollama', 'lmstudio', 'vllm']) {
    assert.ok(ids.includes(id), `missing provider ${id}`);
  }
  for (const p of reg) {
    assert.ok(p.id && p.name && p.kind && p.apiType && p.defaultBaseUrl, `provider ${p.id} 字段不完整`);
    assert.ok(['cloud', 'local'].includes(p.kind));
    assert.ok(['openai-compat', 'anthropic'].includes(p.apiType));
  }
});

test('registry: 免费额度 provider 端点正确', () => {
  assert.strictEqual(getProvider('openrouter').defaultBaseUrl, 'https://openrouter.ai/api/v1');
  assert.strictEqual(getProvider('opencode-zen').defaultBaseUrl, 'https://opencode.ai/zen/v1');
  assert.strictEqual(getProvider('nvidia-nim').defaultBaseUrl, 'https://integrate.api.nvidia.com/v1');
  // env key 均登记
  assert.strictEqual(getProvider('openrouter').apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.strictEqual(getProvider('opencode-zen').apiKeyEnv, 'OPENCODE_API_KEY');
  assert.strictEqual(getProvider('nvidia-nim').apiKeyEnv, 'NVIDIA_API_KEY');
  // 默认免费模型存在
  assert.ok(getProvider('openrouter').models.some((m) => m.endsWith(':free')));
  assert.ok(getProvider('opencode-zen').models.length >= 1);
  assert.ok(getProvider('nvidia-nim').models.length >= 1);
});

test('registry: 本地 provider 无需 key（kind=local）', () => {
  assert.strictEqual(getProvider('ollama').kind, 'local');
  assert.strictEqual(getProvider('ollama').apiType, 'openai-compat');
});

// ── 配置：env 优先 ──
test('config: env 设 key → source=env 且 configured', () => {
  process.env.OPENAI_API_KEY = 'sk-test-1234';
  const cfg = providerConfig.getConfig('openai');
  assert.strictEqual(cfg.source, 'env');
  assert.strictEqual(cfg.configured, true);
  assert.strictEqual(cfg.apiKey, 'sk-test-1234');
  assert.strictEqual(cfg.baseUrl, 'https://api.openai.com/v1');
});

test('config: 无任何配置 → source=none 且未配置', () => {
  const cfg = providerConfig.getConfig('deepseek');
  assert.strictEqual(cfg.source, 'none');
  assert.strictEqual(cfg.configured, false);
});

test('config: 文件写入后 source=file，env 仍优先', () => {
  const r = providerConfig.setConfig('deepseek', { apiKey: 'sk-file-5678', baseUrl: 'https://api.deepseek.com/v1' });
  assert.strictEqual(r.ok, true);
  let cfg = providerConfig.getConfig('deepseek');
  assert.strictEqual(cfg.source, 'file');
  assert.strictEqual(cfg.apiKey, 'sk-file-5678');

  // env 来了 → 覆盖文件
  process.env.DEEPSEEK_API_KEY = 'sk-env-0000';
  cfg = providerConfig.getConfig('deepseek');
  assert.strictEqual(cfg.source, 'env');
  assert.strictEqual(cfg.apiKey, 'sk-env-0000');
});

test('config: 清空文件字段 → 回到 none', () => {
  providerConfig.setConfig('kimi', { apiKey: 'sk-tmp' });
  const r = providerConfig.setConfig('kimi', { apiKey: '' });
  assert.strictEqual(r.ok, true);
  const cfg = providerConfig.getConfig('kimi');
  assert.strictEqual(cfg.source, 'none');
  assert.strictEqual(cfg.configured, false);
});

test('config: baseUrl 可被 HESI_LLM_<ID>_BASE_URL 覆盖', () => {
  process.env.HESI_LLM_DEEPSEEK_BASE_URL = 'https://my-proxy.example.com/v1';
  const cfg = providerConfig.getConfig('deepseek');
  assert.strictEqual(cfg.baseUrl, 'https://my-proxy.example.com/v1');
});

test('config: 未知 provider 拒绝', () => {
  const r = providerConfig.setConfig('nope', { apiKey: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /unknown provider/);
});

test('config: getAllConfigs 脱敏（key 只留尾 4 位）', () => {
  process.env.OPENAI_API_KEY = 'sk-abcdef123456';
  const all = providerConfig.getAllConfigs();
  const openai = all.find((c) => c.id === 'openai');
  assert.strictEqual(openai.maskedKey, '****3456');
  assert.ok(!JSON.stringify(all).includes('sk-abcdef123456'), '脱敏失败：明文泄露');
});

// ── 降级路由 ──
test('health: 无配置时 resolveWithFallback 优先本地 provider', () => {
  // 无任何 key → 自动选择第一个本地（ollama）
  const r = resolveWithFallback();
  assert.strictEqual(r.providerId, 'ollama');
  assert.strictEqual(r.fallback, false);
});

test('health: 已配置云端优先于本地', () => {
  process.env.DEEPSEEK_API_KEY = 'sk-ds';
  const r = resolveWithFallback();
  // 注册表顺序 openai→anthropic→deepseek；openai 无 key 跳过，deepseek 有 key → 选它
  assert.strictEqual(r.providerId, 'deepseek');
});

test('health: 指定 provider 未配置 + allowFallback → 降级到已配置备用', () => {
  process.env.KIMI_API_KEY = 'sk-kimi';
  const r = resolveWithFallback('openai', { allowFallback: true });
  assert.strictEqual(r.providerId, 'kimi');
  assert.strictEqual(r.fallback, true);
});

test('health: 指定 provider 未配置 + 无备用 → 诚实失败（不降级）', () => {
  const r = resolveWithFallback('openai', { allowFallback: false });
  assert.strictEqual(r.providerId, 'openai');
  assert.strictEqual(r.fallback, false);
});

// ── M1: resolveForChat 主链路解析（零回归）──
const { resolveForChat } = require('../lib/llm-provider/provider-client');

test('M1: 请求级 key 优先于一切', () => {
  process.env.OPENAI_API_KEY = 'sk-env';
  const r = resolveForChat(undefined, 'sk-client', undefined);
  assert.strictEqual(r.apiKey, 'sk-client');
});

test('M1: 指定 provider → 用其 config（env key 自动映射）', () => {
  process.env.DEEPSEEK_API_KEY = 'sk-ds-env';
  const r = resolveForChat('deepseek', undefined, undefined);
  assert.strictEqual(r.providerId, 'deepseek');
  assert.strictEqual(r.apiKey, 'sk-ds-env');
  assert.strictEqual(r.baseUrl, 'https://api.deepseek.com/v1');
});

test('M1: 指定 provider + 文件配置 baseUrl → 用文件', () => {
  providerConfig.setConfig('qwen', { baseUrl: 'https://my-qwen-proxy.example.com/v1' });
  const r = resolveForChat('qwen', undefined, undefined);
  assert.strictEqual(r.baseUrl, 'https://my-qwen-proxy.example.com/v1');
});

test('M1: 未指定 provider 且无 key → 回落本地 ollama（apiKey 空但 baseUrl 有默认）', () => {
  const r = resolveForChat(undefined, undefined, undefined);
  assert.strictEqual(r.providerId, 'ollama');
  assert.strictEqual(r.apiKey, '');
  assert.ok(r.baseUrl);
});

test('M1: 未指定 provider 但 env 有 OPENAI key → 选 openai', () => {
  process.env.OPENAI_API_KEY = 'sk-openai';
  const r = resolveForChat(undefined, undefined, undefined);
  assert.strictEqual(r.providerId, 'openai');
  assert.strictEqual(r.apiKey, 'sk-openai');
});

test('M1: 未指定 provider 但只有 ANTHROPIC key → 选 anthropic（与旧行为一致）', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant';
  const r = resolveForChat(undefined, undefined, undefined);
  assert.strictEqual(r.providerId, 'anthropic');
  assert.strictEqual(r.apiKey, 'sk-ant');
});

// ── 回归：本地 provider 用户配置优先于裸默认（球总实测 bug，2026-08-04）──
test('health: 无云端 key 时优先选「用户配置过的本地 provider」（非裸 ollama）', () => {
  // 模拟球总场景：仅配置 lmstudio（source=file）
  providerConfig.setConfig('lmstudio', { apiKey: 'sk-lm-x', baseUrl: 'http://127.0.0.1:1234', model: 'qwen3.6-test' });
  const r = resolveWithFallback();
  assert.strictEqual(r.providerId, 'lmstudio');
  assert.strictEqual(r.fallback, false);
  // resolveForChat 应带出 lmstudio 的 baseUrl/model
  const c = resolveForChat(undefined, undefined, undefined);
  assert.strictEqual(c.providerId, 'lmstudio');
  assert.strictEqual(c.baseUrl, 'http://127.0.0.1:1234');
  assert.strictEqual(c.model, 'qwen3.6-test');
});

// ── 回归：本地 provider 默认 baseUrl 不含 /v1（球总要求）+ buildApiUrl 自动补全 ──
test('registry: lmstudio 默认 baseUrl 不含 /v1（服务根地址）', () => {
  const lm = getProvider('lmstudio');
  assert.strictEqual(lm.defaultBaseUrl, 'http://localhost:1234');
  assert.ok(!/\/v1$/.test(lm.defaultBaseUrl), 'lmstudio 默认不应含 /v1');
});

test('buildApiUrl: 不含 /v1 的 baseUrl 自动补 /v1（/models 与 /chat/completions 同规则）', () => {
  const { buildApiUrl } = require('../lib/llm/url');
  assert.strictEqual(buildApiUrl('http://127.0.0.1:1234', '', '/models'), 'http://127.0.0.1:1234/v1/models');
  assert.strictEqual(buildApiUrl('http://localhost:1234/v1', '', '/models'), 'http://localhost:1234/v1/models');
  assert.strictEqual(buildApiUrl('http://localhost:11434/v1', '', '/models'), 'http://localhost:11434/v1/models');
});

// ── 角色路由（v0.8.0 · Claude Code 式多模型分工）──
test('roles: 默认 provider 设置/读取', () => {
  providerConfig.setConfig('deepseek', { apiKey: 'sk-ds', model: 'deepseek-chat' });
  const r = providerConfig.setDefaultProvider('deepseek');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(providerConfig.getDefaultProvider(), 'deepseek');
});

test('roles: 未配置 provider 不能设为默认', () => {
  const r = providerConfig.setDefaultProvider('openai'); // 未配 key
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /未配置/);
});

test('roles: setRole/getRole 读写 + 清空回落', () => {
  const r = providerConfig.setRole('plan', { provider: 'openrouter', model: 'gpt-oss:free' });
  assert.strictEqual(r.ok, true);
  const g = providerConfig.getRole('plan');
  assert.strictEqual(g.provider, 'openrouter');
  assert.strictEqual(g.model, 'gpt-oss:free');
  // 清空 → 回落默认
  providerConfig.setRole('plan', { provider: '', model: '' });
  assert.deepStrictEqual(providerConfig.getRole('plan'), { provider: '', model: '' });
});

test('roles: 未知角色/未知 provider 拒绝', () => {
  assert.strictEqual(providerConfig.setRole('nope', {}).ok, false);
  assert.strictEqual(providerConfig.setRole('chat', { provider: 'nope' }).ok, false);
});

test('roles: resolveForChat 优先级 = 请求级 > 角色 > 默认 > 自动', () => {
  const { resolveForChat } = require('../lib/llm-provider/provider-client');
  providerConfig.setConfig('deepseek', { apiKey: 'sk-ds' });
  providerConfig.setConfig('openrouter', { apiKey: 'sk-or' });
  providerConfig.setConfig('nvidia-nim', { apiKey: 'nvapi-x' });
  // ① 角色 plan → openrouter
  providerConfig.setRole('plan', { provider: 'openrouter', model: 'gpt-oss:free' });
  const r1 = resolveForChat(undefined, undefined, undefined, 'plan');
  assert.strictEqual(r1.providerId, 'openrouter');
  assert.strictEqual(r1.model, 'gpt-oss:free');
  // ② 默认 provider → nvidia-nim（角色 chat 未配置时）
  providerConfig.setDefaultProvider('nvidia-nim');
  const r2 = resolveForChat(undefined, undefined, undefined, 'chat');
  assert.strictEqual(r2.providerId, 'nvidia-nim');
  // ③ 请求级 provider 覆盖一切
  const r3 = resolveForChat('deepseek', undefined, undefined, 'plan');
  assert.strictEqual(r3.providerId, 'deepseek');
  // ④ 角色 provider 未配置 → 回落默认
  providerConfig.setRole('discuss', { provider: 'openai', model: '' }); // openai 无 key
  const r4 = resolveForChat(undefined, undefined, undefined, 'discuss');
  assert.strictEqual(r4.providerId, 'nvidia-nim'); // 回落默认
});

// ── 自定义 provider（v0.8.0 · 模型广场「➕ 自定义」入口）──
test('custom: addCustomProvider 新增并参与解析', () => {
  const r = providerConfig.addCustomProvider({ id: 'my-proxy', name: '中转', baseUrl: 'https://one-api.example.com/v1', apiKey: 'sk-custom-1', model: 'gpt-4o' });
  assert.strictEqual(r.ok, true);
  const defs = providerConfig.getAllDefs();
  assert.ok(defs.some((d) => d.id === 'my-proxy'), '自定义在 getAllDefs 中');
  const cfg = providerConfig.getConfig('my-proxy');
  assert.strictEqual(cfg.source, 'custom');
  assert.strictEqual(cfg.configured, true);
  assert.strictEqual(cfg.apiKey, 'sk-custom-1');
  assert.strictEqual(cfg.baseUrl, 'https://one-api.example.com/v1');
  const all = providerConfig.getAllConfigs();
  const c = all.find((x) => x.id === 'my-proxy');
  assert.ok(c && c.custom === true && c.maskedKey === '****om-1');
  const d = providerConfig.setDefaultProvider('my-proxy');
  assert.strictEqual(d.ok, true);
});

test('custom: 非法 id / 与内置冲突拒绝', () => {
  assert.strictEqual(providerConfig.addCustomProvider({ id: 'Bad ID', baseUrl: 'http://x' }).ok, false);
  assert.strictEqual(providerConfig.addCustomProvider({ id: 'openai', baseUrl: 'http://x' }).ok, false);
  assert.strictEqual(providerConfig.addCustomProvider({ id: 'x', baseUrl: 'not-a-url' }).ok, false);
});

test('custom: update/remove 与删除默认清空', () => {
  // beforeEach 清空配置 → 本测试独立创建
  providerConfig.addCustomProvider({ id: 'my-proxy', name: '中转', baseUrl: 'https://one-api.example.com/v1', apiKey: 'sk-custom-1', model: 'gpt-4o' });
  providerConfig.setDefaultProvider('my-proxy');
  const u = providerConfig.updateCustomProvider('my-proxy', { model: 'gpt-4o-mini' });
  assert.strictEqual(u.ok, true);
  assert.strictEqual(providerConfig.getConfig('my-proxy').model, 'gpt-4o-mini');
  const rm = providerConfig.removeCustomProvider('my-proxy');
  assert.strictEqual(rm.ok, true);
  assert.strictEqual(providerConfig.getDefaultProvider(), '');
  assert.strictEqual(providerConfig.getConfig('my-proxy').configured, false);
});

test('custom: resolveForChat 支持自定义 provider 显式路由', () => {
  providerConfig.addCustomProvider({ id: 'my-proxy', name: '中转', baseUrl: 'https://p.example.com/v1', apiKey: 'sk-p', model: 'm1' });
  const { resolveForChat } = require('../lib/llm-provider/provider-client');
  const r = resolveForChat('my-proxy', undefined, undefined, 'chat');
  assert.strictEqual(r.providerId, 'my-proxy');
  assert.strictEqual(r.apiKey, 'sk-p');
  assert.strictEqual(r.baseUrl, 'https://p.example.com/v1');
  providerConfig.removeCustomProvider('my-proxy');
});

// ── 回归：本地 provider 空 key 判定（2026-08-04 讨论/自动执行走不通 LM Studio）──
test('llm-bridge: 本地 provider（lmstudio）kind=local，云端（deepseek）kind=cloud', () => {
  const { getProviderDef } = require('../lib/llm-provider/provider-config');
  assert.strictEqual(getProviderDef('lmstudio').kind, 'local');
  assert.strictEqual(getProviderDef('ollama').kind, 'local');
  assert.strictEqual(getProviderDef('deepseek').kind, 'cloud');
  // 模拟 llm-bridge 的 isCloud 判定：本地无 key 不报 NO_API_KEY
  const isCloud = (prov) => {
    const def = getProviderDef(prov);
    return !def || def.kind !== 'local';
  };
  assert.strictEqual(isCloud('lmstudio'), false, '本地不应视为需 key');
  assert.strictEqual(isCloud('deepseek'), true, '云端应视为需 key');
});

test('discuss resolveConfig: 本地 provider 带出 kind=local', () => {
  // resolveConfig 未导出——通过 provider-config 判定层间接验证（与 discuss 同源）
  const { getProviderDef } = require('../lib/llm-provider/provider-config');
  const def = getProviderDef('lmstudio');
  assert.strictEqual(def.kind, 'local');
  assert.strictEqual(def.apiType, 'openai-compat');
});

// ── 回归：defNeedsKey 判定（2026-08-04 自定义端点/本地不强制 key）──
test('defNeedsKey: 内置云端需要 key；本地与自定义不强制', () => {
  const { defNeedsKey, getProviderDef } = require('../lib/llm-provider/provider-config');
  // 内置云端 → 需要
  assert.strictEqual(defNeedsKey(getProviderDef('deepseek')), true);
  assert.strictEqual(defNeedsKey(getProviderDef('openai')), true);
  assert.strictEqual(defNeedsKey(getProviderDef('anthropic')), true);
  // 本地 → 不强制
  assert.strictEqual(defNeedsKey(getProviderDef('lmstudio')), false);
  assert.strictEqual(defNeedsKey(getProviderDef('ollama')), false);
  assert.strictEqual(defNeedsKey(getProviderDef('vllm')), false);
  // 自定义 provider（用户配置端点，即使无 key）→ 不强制
  providerConfig.addCustomProvider({ id: 'my-proxy', name: '中转', baseUrl: 'https://x.example.com/v1' });
  const def = getProviderDef('my-proxy');
  assert.ok(def && def._custom === true, '自定义标记');
  assert.strictEqual(defNeedsKey(def), false, '自定义无 key 不报错');
  providerConfig.removeCustomProvider('my-proxy');
});

test('custom: 无 key 自定义 provider 的 getConfig 仍 configured（有 baseUrl）', () => {
  providerConfig.addCustomProvider({ id: 'no-key-proxy', name: '无key中转', baseUrl: 'https://inner.example.com/v1' });
  const cfg = providerConfig.getConfig('no-key-proxy');
  assert.strictEqual(cfg.configured, true, '有 baseUrl 即视为可配置');
  assert.strictEqual(cfg.apiKey, '');
  assert.strictEqual(cfg.source, 'custom');
  providerConfig.removeCustomProvider('no-key-proxy');
});
