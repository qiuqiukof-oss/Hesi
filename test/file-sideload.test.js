// @ts-check
// v0.3.1 A1 — read_file 大文件侧载单测（纯函数，无网络/文件依赖）
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { shouldSideload, sideloadFileResult, SIDELOAD_THRESHOLD } = require('../lib/file-sideload');

function makeBigSource(lines = 3000) {
  const out = ['File: src/big.js', 'Language: javascript', 'Size: 99999 bytes', ''];
  for (let i = 0; i < lines; i++) {
    if (i % 100 === 0) out.push(`function handler${i}() { // 第 ${i} 个处理器`);
    else if (i % 100 === 50) out.push(`class Widget${i} {`);
    else out.push(`  const v${i} = compute(${i}); // 填充内容使行足够长——${'x'.repeat(30)}`);
  }
  return out.join('\n');
}

test('sideload: triggers only above threshold and respects env kill-switch', () => {
  assert.strictEqual(shouldSideload('short text'), false, 'short text not sideloaded');
  const big = makeBigSource();
  assert.ok(big.length > SIDELOAD_THRESHOLD, 'fixture exceeds threshold');
  assert.strictEqual(shouldSideload(big), true, 'big text sideloaded');
  process.env.HESI_FILE_SIDELOAD = '0';
  try {
    assert.strictEqual(shouldSideload(big), false, 'kill-switch falls back to truncation');
  } finally {
    delete process.env.HESI_FILE_SIDELOAD;
  }
});

test('sideload: output has head + outline with line numbers + paging hint', () => {
  const big = makeBigSource();
  const out = sideloadFileResult(big, 'src/big.js');
  assert.ok(out.includes('已启用侧载模式'), 'has sideload banner');
  assert.ok(out.includes('read_file(path="src/big.js", offset='), 'has paging hint with path');
  assert.ok(out.includes('── 头部内容 ──'), 'has head section');
  assert.ok(out.includes('── 结构摘要'), 'has outline section');
  assert.ok(/L\d+: function handler\d+/.test(out), 'outline lists functions with line numbers');
  assert.ok(/L\d+: class Widget\d+/.test(out), 'outline lists classes');
  assert.ok(out.length < big.length / 2, 'sideloaded output significantly smaller than原文');
});

test('sideload: outline caps at 80 entries and skips super-long lines', () => {
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(`function f${i}() {}`);
  lines.push('function longline() {' + 'y'.repeat(500)); // >400 字符不算结构
  const text = lines.join('\n') + '\n' + 'z'.repeat(25000);
  const out = sideloadFileResult(text);
  const outlineCount = (out.match(/^L\d+: /gm) || []).length;
  assert.strictEqual(outlineCount, 80, 'outline capped at 80');
  assert.ok(!out.includes('longline'), 'super-long line excluded from outline');
});

test('sideload: threshold ~10K lets ~18KB file trigger (regression for big-file bomb)', () => {
  // 18KB 文件：旧 20K 阈值下不触发（整文件进上下文），新 10K 阈值下必须触发。
  const midFile = 'File: src/large.js\nLanguage: javascript\n\n' + 'const x = 1;\n'.repeat(1400);
  assert.ok(midFile.length > 12000 && midFile.length < 20000, 'fixture is ~18KB-range');
  assert.ok(midFile.length > SIDELOAD_THRESHOLD, '~18KB exceeds new 10K threshold');
  assert.strictEqual(shouldSideload(midFile), true, '~18KB file is sideloaded at 10K threshold');
  // 5KB 小文件仍不触发
  const small = 'a'.repeat(5000);
  assert.strictEqual(shouldSideload(small), false, '5KB file not sideloaded');
});
