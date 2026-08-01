#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/test-cli-compact.js
// ------------------------------------------------------------
// Regression for the CLI transcript compaction in the AI discussion
// coordinator (routes/chat/discuss.js):
//   compactTranscriptForCli(transcript)
//
// Guards the pure-function contract:
//   1. module loads; compactTranscriptForCli / splitTranscriptRounds exported
//   2. null / undefined / empty input → ''
//   3. ≤ CLI_KEEP_RECENT_ROUNDS (2) rounds → returned verbatim, no header
//   4. >2 rounds → early rounds digested under a header, recent 2 verbatim
//   5. early round > CLI_EARLY_ROUND_CHARS (240) → truncated to 240 + …
//   6. early segment exactly 240 chars → NOT truncated
//   7. early round newlines collapsed to single spaces
//   8. recent rounds kept verbatim even when very long
//   9. compressed output preserves every round boundary
//   10. many rounds → total size shrinks
//
// It intentionally does NOT run a live discussion — this guards only the
// deterministic pure functions (compactTranscriptForCli / splitTranscriptRounds).
// ============================================================
'use strict';

const assert = require('node:assert');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`  ✓ ${name}`);
}

const mod = require('../routes/chat/discuss');
const { compactTranscriptForCli, splitTranscriptRounds } = mod;

// ── 测试数据助手 ──
// 轮次行形如「【第1轮 · AI 助手】\n正文」；splitTranscriptRounds 以「【第N轮」为界切分。
function round(n, speaker, text) {
  return `【第${n}轮 · ${speaker}】\n${text}`;
}

// 切分后第 1 段 = 「【第1轮 · AI 助手】」前缀 + 正文；压缩时 \n 会被折叠为一个空格。
const HEADER_LEN = '【第1轮 · AI 助手】'.length; // 13

check('module loads and exports the compaction functions', () => {
  assert.strictEqual(typeof compactTranscriptForCli, 'function');
  assert.strictEqual(typeof splitTranscriptRounds, 'function');
});

check('null / undefined / empty input → empty string', () => {
  assert.strictEqual(compactTranscriptForCli(null), '');
  assert.strictEqual(compactTranscriptForCli(undefined), '');
  assert.strictEqual(compactTranscriptForCli(''), '');
});

check('1 round → returned verbatim (no header)', () => {
  const t = round(1, 'AI 助手', '分析框架：先评估模块边界。');
  assert.strictEqual(compactTranscriptForCli(t), t);
});

check('2 rounds → returned verbatim (no header)', () => {
  const t = round(1, 'AI 助手', '第一轮发言。') + '\n' + round(2, 'opencode', '第二轮回应。');
  assert.strictEqual(compactTranscriptForCli(t), t);
});

check('3 rounds → early 1 compressed, recent 2 verbatim', () => {
  const t = [
    round(1, 'AI 助手', '早期轮内容'),
    round(2, 'opencode', '中间轮内容'),
    round(3, 'AI 助手', '最近轮内容'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  assert.ok(out.startsWith('【早期轮次摘要（1 轮，已压缩）】'), `header missing: ${out.slice(0, 60)}`);
  assert.ok(out.includes('早期轮内容'), 'early round should appear in the digest');
  assert.ok(out.includes('中间轮内容'), 'recent round 1 should be verbatim');
  assert.ok(out.includes('最近轮内容'), 'recent round 2 should be verbatim');
});

check('5 rounds → early 3 compressed, header counts 3', () => {
  const t = [
    round(1, 'AI 助手', '甲'), round(2, 'opencode', '乙'), round(3, 'AI 助手', '丙'),
    round(4, 'opencode', '丁'), round(5, 'AI 助手', '戊'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  assert.ok(out.startsWith('【早期轮次摘要（3 轮，已压缩）】'));
});

check('early round > 240 chars → truncated to 240 + …', () => {
  const t = [
    round(1, 'AI 助手', 'x'.repeat(300)),
    round(2, 'opencode', '乙'),
    round(3, 'AI 助手', '丙'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  const first = out.split('\n')[1]; // 第一条 digest 行
  assert.strictEqual(first.length, 241, `expected 240 + …, got ${first.length}`);
  assert.ok(first.endsWith('…'), 'digest should end with ellipsis');
});

check('early segment exactly 240 chars → NOT truncated', () => {
  // 前缀(13) + 折叠空格(1) + 正文 = 240 时，`> 240` 为假 → 原样保留
  const body = 'y'.repeat(240 - HEADER_LEN - 1);
  const t = [
    round(1, 'AI 助手', body),
    round(2, 'opencode', '乙'),
    round(3, 'AI 助手', '丙'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  const first = out.split('\n')[1];
  assert.strictEqual(first.length, 240);
  assert.ok(!first.endsWith('…'), 'exactly-240 segment should pass through untouched');
});

check('early round newlines collapsed to single spaces', () => {
  const t = [
    round(1, 'AI 助手', '第一行\n第二行\n\n第三行'),
    round(2, 'opencode', '乙'),
    round(3, 'AI 助手', '丙'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  const first = out.split('\n')[1];
  assert.ok(!first.includes('\n'), 'digest must be a single line');
  assert.ok(first.includes('第一行 第二行 第三行'), `whitespace should collapse, got: ${first}`);
});

check('recent rounds kept verbatim even when very long (> 240 chars)', () => {
  const longRecent = 'z'.repeat(300);
  const t = [
    round(1, 'AI 助手', '早期'),
    round(2, 'opencode', longRecent),
    round(3, 'AI 助手', '丙'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  assert.ok(out.includes(longRecent), 'recent long round must survive verbatim');
});

check('compressed output preserves all 3 round boundaries', () => {
  const t = [
    round(1, 'AI 助手', '甲'), round(2, 'opencode', '乙'), round(3, 'AI 助手', '丙'),
  ].join('\n');
  const out = compactTranscriptForCli(t);
  const marks = out.match(/【第\d+轮/g) || [];
  assert.strictEqual(marks.length, 3, `expected 3 round markers, got ${marks.length}`);
});

check('many rounds → total size shrinks', () => {
  const rounds = Array.from({ length: 10 }, (_, i) => round(i + 1, 'AI 助手', 'x'.repeat(300)));
  const t = rounds.join('\n');
  const out = compactTranscriptForCli(t);
  assert.ok(out.length < t.length, `compressed ${t.length} → ${out.length} should shrink`);
  assert.ok(out.startsWith('【早期轮次摘要（8 轮，已压缩）】'));
});

check('splitTranscriptRounds: empty / null → []', () => {
  assert.deepStrictEqual(splitTranscriptRounds(''), []);
  assert.deepStrictEqual(splitTranscriptRounds(null), []);
});

check('splitTranscriptRounds: 3 rounds → 3 trimmed segments', () => {
  const t = [
    round(1, 'AI 助手', '甲'), round(2, 'opencode', '乙'), round(3, 'AI 助手', '丙'),
  ].join('\n');
  const segs = splitTranscriptRounds(t);
  assert.strictEqual(segs.length, 3);
  segs.forEach((s) => assert.strictEqual(s, s.trim(), 'segment should be trimmed'));
});

console.log(`\n✅ test-cli-compact.js: ${checks} checks passed`);
