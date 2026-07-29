/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P0.6 S2：context-usage 纯函数单测（色阶边界 / pct 计算 / 几何 / 文案）
import test from 'node:test';
import assert from 'node:assert';
import { computeContextUsage, RING_CIRCUMFERENCE } from '../public/components/context-usage.js';

function pctOf(used, win) {
  return computeContextUsage({ contextEstimate: used, windowTokens: win });
}

test('色阶边界：59.x%→绿 / 60%→黄 / 84.x%→黄 / 85%→橙 / 94.x%→橙 / 95%→红 / 96%→红', () => {
  const cases = [
    [599, 1000, 'normal', '#2e7d32'],
    [600, 1000, 'warn', '#f9a825'],
    [849, 1000, 'warn', '#f9a825'],
    [850, 1000, 'danger', '#ef6c00'],
    [949, 1000, 'danger', '#ef6c00'],
    [950, 1000, 'critical', '#c62828'],
    [960, 1000, 'critical', '#c62828'],
  ];
  for (const [used, win, level, color] of cases) {
    const r = pctOf(Number(used), Number(win));
    assert.strictEqual(r.level, level, `${used}/${win} 应为 ${level}，实际 ${r.level}(${r.pct}%)`);
    assert.strictEqual(r.color, color);
  }
});

test('pct 计算保留 1 位小数，圆环填充按 100% 截断', () => {
  const r = pctOf(12300, 32000);
  assert.strictEqual(r.pct, 38.4);
  // 超窗：pct 可 >100，但 dashoffset 不为负（填满即止）
  const over = pctOf(40000, 32000);
  assert.ok(over.pct > 100);
  assert.strictEqual(over.strokeDashoffset, '0.00');
  assert.strictEqual(over.level, 'critical');
});

test('几何与 savings-icon 共享同一圆环周长', () => {
  const r = pctOf(500, 1000);
  assert.strictEqual(r.strokeDasharray, RING_CIRCUMFERENCE.toFixed(2));
  const expectedOffset = (RING_CIRCUMFERENCE * 0.5).toFixed(2);
  assert.strictEqual(r.strokeDashoffset, expectedOffset);
});

test('tooltip：包含占用/窗口/阈值/模型/来源；critical 追加警示', () => {
  const r = computeContextUsage({
    contextEstimate: 31000, windowTokens: 32000,
    compactThreshold: 16000, model: 'qwen2.5-3b', source: 'model-map',
  });
  assert.ok(r.title.includes('31.0k'));
  assert.ok(r.title.includes('32.0k'));
  assert.ok(r.title.includes('压缩阈值 16.0k'));
  assert.ok(r.title.includes('已达标'));
  assert.ok(r.title.includes('qwen2.5-3b'));
  assert.ok(r.title.includes('模型映射表'));
  assert.ok(r.title.includes('接近窗口上限'));
});

test('无数据：不激活、pct=0、绿色', () => {
  const r = computeContextUsage();
  assert.strictEqual(r.pct, 0);
  assert.strictEqual(r.active, false);
  assert.strictEqual(r.level, 'normal');
  assert.ok(r.title.includes('暂无'));
});
