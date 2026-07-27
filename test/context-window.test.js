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
