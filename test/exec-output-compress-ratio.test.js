/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// v0.3.1 A2「CLI 压缩」压缩率契约补充测试（对 exec 长输出的 30/70 截断）。
//
// exec-output-truncate.test.js 已覆盖 30k 输入（≈60% 压缩）与 env 阈值控制，
// 但未覆盖「压缩率 >80%」的极端长输出（>60k 字符）场景。本文件补齐：
//   1. 100k 字符长管道输出 → 截断后压缩率 >80%（12k/100k ≈ 88%）；
//   2. 头 30% / 尾 70% 与原文逐字节一致（保真 = 结果可追踪的等价性代理，
//      截断仅影响喂给 LLM 的呈现，不影响命令真实执行结果）；
//   3. 省略标记携带准确的省略字符数。
//
// 说明：truncateExecOutput 是 routes/chat/tools.js 模块私有函数（未导出），
// 与 exec-output-truncate.test.js 相同，此处复刻其文档化算法契约做黑盒校验。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const EXEC_OUTPUT_MAX = parseInt(process.env.HESI_EXEC_OUTPUT_MAX, 10) || 12000;

// 与 routes/chat/tools.js:32-40 逐行一致的算法复刻（生产代码私有，未导出）。
function truncateExecOutput(text) {
  if (typeof text !== 'string' || text.length <= EXEC_OUTPUT_MAX) return text;
  const headLen = Math.floor(EXEC_OUTPUT_MAX * 0.3);
  const tailLen = EXEC_OUTPUT_MAX - headLen;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const omitted = text.length - EXEC_OUTPUT_MAX;
  return `${head}\n\n... [中间省略 ${omitted} 字符] ...\n\n${tail}`;
}

test('CLI 压缩：100k 长输出压缩率 >80% 且头尾逐字节保真', () => {
  const long = 'y'.repeat(100000); // 模拟超长管道命令输出
  const out = truncateExecOutput(long);
  const ratio = 1 - out.length / long.length;
  assert.ok(ratio > 0.8, `压缩率 ${(ratio * 100).toFixed(1)}% 应 > 80%`);

  const headLen = Math.floor(EXEC_OUTPUT_MAX * 0.3);
  const tailLen = EXEC_OUTPUT_MAX - headLen;
  assert.strictEqual(out.slice(0, headLen), long.slice(0, headLen), '头部 30% 与原文逐字节一致');
  assert.ok(out.endsWith(long.slice(-tailLen)), '尾部 70% 与原文逐字节一致');
  assert.ok(out.length <= EXEC_OUTPUT_MAX + 80, '压缩后长度贴近阈值（含标记）');
});

test('CLI 压缩：省略标记携带准确省略字符数（信息不丢量）', () => {
  const n = 50000;
  const out = truncateExecOutput('z'.repeat(n));
  const m = out.match(/中间省略 (\d+) 字符/);
  assert.ok(m, '存在省略计数标记');
  assert.strictEqual(Number(m[1]), n - EXEC_OUTPUT_MAX, '省略计数 = 原文长 - 阈值，准确');
});

test('CLI 压缩：未超阈值的长命令输出原样返回（压缩率为 0，无损伤）', () => {
  const s = 'cat a.txt | grep x | sort -u\n'.repeat(100); // 10*100=1000 字符 < 12k
  assert.strictEqual(truncateExecOutput(s), s, '阈值内不压缩、不损伤');
});
