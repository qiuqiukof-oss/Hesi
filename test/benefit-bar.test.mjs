/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// P2.1 render-snapshot: lock the pure benefit-bar builder extracted from
// chat-panel.renderRoundBenefit. No DOM needed — pure string/number output.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildBenefitBar, fmtTokens } from '../public/components/benefit-bar.js';

test('fmtTokens: k-suffix above 1000', () => {
  assert.strictEqual(fmtTokens(999), '999');
  assert.strictEqual(fmtTokens(1000), '1.0k');
  assert.strictEqual(fmtTokens(1500), '1.5k');
});

test('all-zero metrics render nothing (null)', () => {
  assert.strictEqual(buildBenefitBar({}), null);
  assert.strictEqual(buildBenefitBar({ cacheReadTokens: 0, toolCacheHits: 0 }), null);
  assert.strictEqual(buildBenefitBar(/** @type {any} */ (null)), null);
});

test('estSaved = cacheRead + toolHits*800 + expHits*1500', () => {
  const b = buildBenefitBar({ cacheReadTokens: 1000, toolCacheHits: 2, experienceHits: 1 });
  assert.ok(b);
  assert.strictEqual(b.estSaved, 1000 + 2 * 800 + 1 * 1500); // 4100
});

test('innerHtml contains the enabled parts and detail block', () => {
  const b = buildBenefitBar({ cacheReadTokens: 1200, toolCacheHits: 3, compactCount: 2 });
  assert.ok(b);
  assert.ok(b.innerHtml.includes('本轮回合收益'), 'title');
  assert.ok(b.innerHtml.includes('缓存命中 1.2k tokens'), 'cache hit part (k-formatted)');
  assert.ok(b.innerHtml.includes('工具复用 3 次'), 'tool reuse part');
  assert.ok(b.innerHtml.includes('上下文压缩 2 次'), 'compaction part');
  assert.ok(b.innerHtml.includes('rb-detail-toggle'), 'detail toggle');
  assert.ok(b.innerHtml.includes('≈ 节省'), 'estSaved summary shown when > 0');
});

test('skills-only shows count but no estSaved summary (skills not counted as saved)', () => {
  const b = buildBenefitBar({ skillsInjected: 2 });
  assert.ok(b);
  assert.ok(b.innerHtml.includes('注入技能 2'), 'skills count shown');
  assert.strictEqual(b.estSaved, 0);
  assert.ok(!b.innerHtml.includes('≈ 节省'), 'no estSaved summary when 0');
});
