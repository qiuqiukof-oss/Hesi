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
  // 移除测试配置文件
  try { fs.unlinkSync(providerConfig.CONFIG_FILE); } catch { /* ignore */ }
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  try { fs.unlinkSync(providerConfig.CONFIG_FILE); } catch { /* ignore */ }
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
