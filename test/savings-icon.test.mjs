/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// P2.1 render-snapshot: lock the pure savings-icon computation extracted from
// chat-panel.updateSavingsIcon. Pure math/string — no DOM.
import { test } from 'node:test';
import assert from 'node:assert';
import { computeSavings, RING_CIRCUMFERENCE } from '../public/components/savings-icon.js';

test('no savings -> 0%, dim ring, placeholder title, inactive', () => {
  const v = computeSavings(undefined);
  assert.strictEqual(v.pct, 0);
  assert.strictEqual(v.fillOpacity, '0.25');
  assert.strictEqual(v.active, false);
  assert.strictEqual(v.title, '本会话暂无缓存命中记录');
  assert.strictEqual(v.strokeDasharray, RING_CIRCUMFERENCE.toFixed(2));
  // pct 0 => offset == full circumference
  assert.strictEqual(v.strokeDashoffset, RING_CIRCUMFERENCE.toFixed(2));
});

test('pct rounds saved/(saved+used); dashoffset scales with pct', () => {
  const v = computeSavings({ saved: 300, used: 100 }); // 300/400 = 75%
  assert.strictEqual(v.pct, 75);
  assert.strictEqual(v.active, true);
  assert.strictEqual(v.fillOpacity, '1');
  assert.strictEqual(v.strokeDashoffset, (RING_CIRCUMFERENCE * (1 - 75 / 100)).toFixed(2));
});

test('title includes k-formatted saved/used and compaction suffix when present', () => {
  const v = computeSavings({ saved: 4100, used: 2000, compact: 3 });
  assert.ok(v.title.includes('≈4.1k tokens'), 'saved k-formatted');
  assert.ok(v.title.includes('实际消耗 2.0k tokens'), 'used k-formatted');
  assert.ok(v.title.includes('上下文压缩 3 次'), 'compaction suffix');
});

test('no compaction -> no compaction suffix', () => {
  const v = computeSavings({ saved: 100, used: 100, compact: 0 });
  assert.ok(!v.title.includes('上下文压缩'), 'no compaction suffix when 0');
});
