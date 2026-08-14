/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P1 S1 — ContextWindowManager 单测（纯逻辑，注入 env 便于断言，不依赖真实 process.env）
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextWindowManager } = require('../lib/context-window');

test('default: no env, unknown model → legacy 60K / 32768 (zero behavior change)', () => {
  const m = new ContextWindowManager({ modelMap: {} });
  assert.strictEqual(m.effectiveContext('gpt-4o'), 200000);
  assert.strictEqual(m.compactThreshold('gpt-4o'), 60000);
  assert.strictEqual(m.maxOutputTokens('gpt-4o'), 32768);
});

test('Layer①: HESI_EFFECTIVE_CONTEXT overrides model map', () => {
  const m = new ContextWindowManager({
    effectiveContextEnv: '40000',
    modelMap: { 'qwen2.5-7b': 48000 },
  });
  assert.strictEqual(m.effectiveContext('qwen2.5-7b'), 40000, 'manual overrides model map');
  assert.strictEqual(m.compactThreshold('qwen2.5-7b'), 20000); // 40000 * 0.5
  assert.strictEqual(m.maxOutputTokens('qwen2.5-7b'), 32000); // min(32768, 32000)
});

test('Layer②: model name map matches base and suffix variants', () => {
  const m = new ContextWindowManager({
    modelMap: { 'qwen2.5-7b': 48000, 'local-model': 32000 },
  });
  assert.strictEqual(m.effectiveContext('qwen2.5-7b-instruct-q4'), 48000);
  assert.strictEqual(m.effectiveContext('local-model'), 32000);
  assert.strictEqual(m.compactThreshold('qwen2.5-7b-instruct-q4'), 24000); // min(60000, 24000)
  assert.strictEqual(m.maxOutputTokens('qwen2.5-7b-instruct-q4'), 32768); // min(32768, 38400)
});

test('HESI_COMPACT_THRESHOLD min-combined with derived threshold', () => {
  const hi = new ContextWindowManager({
    compactThresholdEnv: '100000',
    modelMap: { 'qwen2.5-7b': 48000 },
  });
  // derived = 24000; explicit 100000 → min = 24000
  assert.strictEqual(hi.compactThreshold('qwen2.5-7b'), 24000);

  const lo = new ContextWindowManager({
    compactThresholdEnv: '10000',
    modelMap: { 'qwen2.5-7b': 48000 },
  });
  // explicit 10000, derived 24000 → min = 10000
  assert.strictEqual(lo.compactThreshold('qwen2.5-7b'), 10000);
});

test('maxOutputTokens clamps small models under 32768', () => {
  const tiny = new ContextWindowManager({ modelMap: { tiny: 8000 } });
  assert.strictEqual(tiny.maxOutputTokens('tiny'), 6400); // 8000 * 0.8
  const mid = new ContextWindowManager({ modelMap: { mid: 10000 } });
  assert.strictEqual(mid.maxOutputTokens('mid'), 8000);
});

test('invalid env values fall back gracefully (no crash, legacy behavior)', () => {
  const m = new ContextWindowManager({
    effectiveContextEnv: 'not-a-number',
    compactThresholdEnv: 'abc',
    modelMap: {},
  });
  assert.strictEqual(m.effectiveContext('x'), 200000);
  assert.strictEqual(m.compactThreshold('x'), 60000);
  assert.strictEqual(m.maxOutputTokens('x'), 32768);
});

// ── 2026-07 新增：本地模型 + 云端热门模型映射（覆盖球总指定清单 + 检索结果）──
test('LOCAL 新增：Qwen3.6 / Qwen3.5 系列检测为 128K（含无连字符别名）', () => {
  const m = new ContextWindowManager();
  assert.strictEqual(m.effectiveContext('qwen3.6-35b-a3b'), 128000);
  assert.strictEqual(m.effectiveContext('qwen3.6-35ba3b'), 128000, '无连字符别名');
  assert.strictEqual(m.effectiveContext('qwen3.6-27b'), 128000);
  assert.strictEqual(m.effectiveContext('qwen3.5-27b'), 128000);
  assert.strictEqual(m.effectiveContext('qwen3-72b'), 128000, 'qwen3 家族通配');
  assert.strictEqual(m.effectiveContext('qwen3.6-35b-a3b-instruct-q4'), 128000, '后缀兼容');
});

test('LOCAL 新增：gamma4 系列（估参，待校准）', () => {
  const m = new ContextWindowManager();
  assert.strictEqual(m.effectiveContext('gamma4-12b'), 32768);
  assert.strictEqual(m.effectiveContext('gamma4-26b'), 32768);
  assert.strictEqual(m.effectiveContext('gamma4-31b'), 32768);
  assert.strictEqual(m.effectiveContext('gamma4-e4b'), 16384);
  assert.strictEqual(m.effectiveContext('gamma4-7b'), 32768, 'gamma4 家族通配');
});

test('CLOUD 新增：最新热门大模型上下文检测（2026-07 检索）', () => {
  const m = new ContextWindowManager();
  assert.strictEqual(m.effectiveContext('gpt-5'), 400000);
  assert.strictEqual(m.effectiveContext('gpt-5.5-thinking'), 400000, 'gpt-5 同族');
  assert.strictEqual(m.effectiveContext('claude-opus-4'), 200000);
  assert.strictEqual(m.effectiveContext('claude-sonnet-4-20250514'), 200000, 'claude 同族');
  assert.strictEqual(m.effectiveContext('gemini-2.5-pro'), 1000000);
  assert.strictEqual(m.effectiveContext('gemini-3.1-pro'), 1000000, 'gemini 同族');
  assert.strictEqual(m.effectiveContext('deepseek-v3'), 128000);
  assert.strictEqual(m.effectiveContext('deepseek-v4'), 1000000);
  assert.strictEqual(m.effectiveContext('deepseek-r1'), 128000);
  assert.strictEqual(m.effectiveContext('llama-4-maverick'), 1000000);
  assert.strictEqual(m.effectiveContext('mistral-large'), 128000);
  assert.strictEqual(m.effectiveContext('command-r-plus'), 128000, 'command-r 同族');
  assert.strictEqual(m.effectiveContext('grok-3'), 131072);
  assert.strictEqual(m.effectiveContext('qwen-max'), 32768);
  assert.strictEqual(m.effectiveContext('qwen-plus'), 128000);
  assert.strictEqual(m.effectiveContext('qwen-long'), 1000000);
  assert.strictEqual(m.effectiveContext('doubao-pro'), 256000, 'doubao 同族');
  assert.strictEqual(m.effectiveContext('kimi-k2'), 256000, 'kimi 同族');
  assert.strictEqual(m.effectiveContext('glm-4-plus'), 128000, 'glm-4 同族');
  assert.strictEqual(m.effectiveContext('glm-4-long'), 1000000);
});

test('主流 OpenAI 精确键：gpt-4o 系列 128K（不再高估到 200K）；完全未知模型走 200K 回退', () => {
  const m = new ContextWindowManager();
  assert.strictEqual(m.effectiveContext('gpt-4o'), 128000, 'gpt-4o 真实 128K，不再高估到 200K');
  assert.strictEqual(m.effectiveContext('gpt-4o-mini'), 128000);
  assert.strictEqual(m.effectiveContext('gpt-4'), 128000);
  assert.strictEqual(m.effectiveContext('gpt-4-turbo'), 128000);
  // 完全未知且不含任何家族前缀 → 走大窗口回退
  assert.strictEqual(m.effectiveContext('some-completely-unknown-model'), 200000);
});
