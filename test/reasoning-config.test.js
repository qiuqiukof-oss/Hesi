'use strict';
// 永久回归测试：推理强度控制（v0.7.5 L3）
// 锁定 reasoning-config.js 的关键行为，防止双拓扑 / IPv6 边界 / 预算钳制回归。
// 覆盖：Qwen3 云端 vs 本地两套拓扑、[::1] IPv6 边界、OpenAI o-series、Anthropic 扩展思考。
const { test } = require('node:test');
const assert = require('node:assert');
const rc = require('../routes/chat/reasoning-config.js');

test('supportsReasoning 识别各 provider 拓扑', () => {
  assert.strictEqual(rc.supportsReasoning('qwen', 'qwen3-32b'), 'local-thinking');
  assert.strictEqual(rc.supportsReasoning('openai', 'o1-mini'), 'openai-reasoning');
  assert.strictEqual(rc.supportsReasoning('openai', 'o3'), 'openai-reasoning');
  assert.strictEqual(rc.supportsReasoning('deepseek', 'deepseek-r1'), 'openai-reasoning');
  assert.strictEqual(rc.supportsReasoning('anthropic', 'claude-3-7-sonnet'), 'anthropic');
  assert.strictEqual(rc.supportsReasoning('anthropic', 'claude-3-5-sonnet'), 'anthropic');
  // 不支持的模型
  assert.strictEqual(rc.supportsReasoning('openai', 'gpt-4o'), false);
  assert.strictEqual(rc.supportsReasoning('qwen', 'qwen2.5'), false);
});

test('isLocalBaseUrl 判定本地/云端拓扑（含 IPv6 [::1] 边界）', () => {
  // 本地
  assert.strictEqual(rc.isLocalBaseUrl('http://localhost:1234/v1'), true);
  assert.strictEqual(rc.isLocalBaseUrl('http://127.0.0.1:8000/v1'), true);
  assert.strictEqual(rc.isLocalBaseUrl('http://[::1]:8000/v1'), true); // IPv6 边界（v0.7.6 修复点）
  assert.strictEqual(rc.isLocalBaseUrl('http://192.168.1.10:1234/v1'), true);
  assert.strictEqual(rc.isLocalBaseUrl('http://10.0.0.5:1234/v1'), true);
  assert.strictEqual(rc.isLocalBaseUrl('http://172.16.0.1:1234/v1'), true);   // 私网下限
  assert.strictEqual(rc.isLocalBaseUrl('http://172.31.255.255:1234/v1'), true); // 私网上限
  assert.strictEqual(rc.isLocalBaseUrl('http://172.32.0.1:1234/v1'), false);    // 越界
  // 云端 SaaS
  assert.strictEqual(rc.isLocalBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'), false);
  assert.strictEqual(rc.isLocalBaseUrl('https://api.openai.com/v1'), false);
  assert.strictEqual(rc.isLocalBaseUrl('https://api.anthropic.com/v1'), false);
  // 异常输入
  assert.strictEqual(rc.isLocalBaseUrl(''), false);
  assert.strictEqual(rc.isLocalBaseUrl(undefined), false);
  assert.strictEqual(rc.isLocalBaseUrl('not a url'), false);
});

test('buildReasoningParams Qwen3 云端拓扑：顶层 enable_thinking + thinking_budget', () => {
  const r = rc.buildReasoningParams('qwen', 'qwen3-32b', 'deep', 20000, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.deepStrictEqual(r, { enable_thinking: true, thinking_budget: 16000 });
});

test('buildReasoningParams Qwen3 本地拓扑：包进 chat_template_kwargs', () => {
  const r = rc.buildReasoningParams('qwen', 'qwen3-32b', 'deep', 20000, 'http://localhost:1234/v1');
  assert.deepStrictEqual(r, { chat_template_kwargs: { enable_thinking: true, thinking_budget: 8192 } });
});

test('buildReasoningParams Qwen3 off：关闭思考（按拓扑分两种形态）', () => {
  assert.deepStrictEqual(
    rc.buildReasoningParams('qwen', 'qwen3-32b', 'off', null, 'http://localhost:1234/v1'),
    { chat_template_kwargs: { enable_thinking: false } }
  );
  assert.deepStrictEqual(
    rc.buildReasoningParams('qwen', 'qwen3-32b', 'off', null, 'https://dashscope.aliyuncs.com/v1'),
    { enable_thinking: false }
  );
});

test('buildReasoningParams Qwen3 standard → null（不注入，模型按默认强度）', () => {
  assert.strictEqual(rc.buildReasoningParams('qwen', 'qwen3-32b', 'standard', null, 'http://localhost:1234/v1'), null);
});

test('buildReasoningParams 预算钳制：budget 必须 < maxTokens-1024 且 >=1024 (R6)', () => {
  const local = rc.buildReasoningParams('qwen', 'qwen3-32b', 'deep', 2000, 'http://localhost:1234/v1');
  assert.strictEqual(local.chat_template_kwargs.thinking_budget, 1024);
  const cloud = rc.buildReasoningParams('qwen', 'qwen3-32b', 'deep', 2000, 'https://dashscope.aliyuncs.com/v1');
  assert.strictEqual(cloud.thinking_budget, 1024);
});

test('buildReasoningParams OpenAI o-series → reasoning_effort 三档枚举', () => {
  assert.deepStrictEqual(
    rc.buildReasoningParams('openai', 'o1-mini', 'deep', null, 'https://api.openai.com/v1'),
    { reasoning_effort: 'high' }
  );
  assert.deepStrictEqual(
    rc.buildReasoningParams('openai', 'o3', 'standard', null, 'https://api.openai.com/v1'),
    null
  );
  assert.deepStrictEqual(
    rc.buildReasoningParams('openai', 'o1-mini', 'off', null, 'https://api.openai.com/v1'),
    null
  );
});

test('buildReasoningParams Anthropic claude-3-7 → thinking.budget_tokens 钳制', () => {
  const r = rc.buildReasoningParams('anthropic', 'claude-3-7-sonnet', 'deep', 20000, null);
  assert.deepStrictEqual(r, { thinking: { type: 'enabled', budget_tokens: 16000 } });
  // 越界钳制
  const r2 = rc.buildReasoningParams('anthropic', 'claude-3-7-sonnet', 'deep', 2000, null);
  assert.strictEqual(r2.thinking.budget_tokens, 1024);
  // standard → null
  assert.strictEqual(rc.buildReasoningParams('anthropic', 'claude-3-7-sonnet', 'standard', null, null), null);
});

test('buildReasoningParams 不支持的模型返回 null；CONTROL_ENABLED 默认开启', () => {
  assert.strictEqual(rc.buildReasoningParams('openai', 'gpt-4o', 'deep', null, 'https://api.openai.com/v1'), null);
  assert.strictEqual(rc.CONTROL_ENABLED, true);
});
