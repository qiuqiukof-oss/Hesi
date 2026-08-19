/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P1 S4 — 端到端：index.js 写回的 contextEstimate 应被 compaction 用于阈值判断，
// 让「真实完整上下文超小模型窗口」时即使历史 tokenEstimate 很小也能触发压缩
// （根治压缩永不触发的「幽灵截断」）。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离存储（同 memory-compaction.test.js 模式）
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-s4-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(`lib${path.sep}memory`)) delete require.cache[k];
}

const { test } = require('node:test');
const assert = require('node:assert');
const MemoryStore = require('../lib/memory');
const llm = require('../lib/memory/llm-bridge');

function makeMessages(n) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    ms.push({ id: 'm_' + i, role: i % 2 === 0 ? 'user' : 'assistant', content: '短消息 ' + i });
  }
  return ms;
}

test('facade exposes setContextEstimate', () => {
  assert.strictEqual(typeof MemoryStore.setContextEstimate, 'function');
});

test('written-back context estimate drives compaction under small-model threshold', async () => {
  let calls = 0;
  llm.setLLMCaller(async () => { calls++; return '【摘要】压缩后的会话摘要。'; });
  const id = 's_s4_' + Date.now().toString(36);
  // 25 条短消息：仅算历史时 tokenEstimate 极小（不触发），但真实完整上下文更大
  // 注意：append / setContextEstimate 经 withLock 异步落盘，必须 await 后再触发压缩。
  await MemoryStore.append(id, makeMessages(25), { model: 'qwen2.5-7b' });
  // 模拟 index.js S4 写回：真实完整上下文 30000 token（> 小模型 qwen2.5-7b 阈值 24000）
  await MemoryStore.setContextEstimate(id, 30000);
  const res = await MemoryStore.compactIfNeeded(id, {});
  assert.strictEqual(res.compacted, true, 'compaction triggered by written-back context estimate');
  assert.strictEqual(calls, 1, 'summary LLM called once');
});

test('without writeback, small history does NOT trigger compaction (legacy fallback)', async () => {
  llm.setLLMCaller(async () => '【摘要】x');
  const id = 's_s4_b_' + Date.now().toString(36);
  await MemoryStore.append(id, makeMessages(25), { model: 'qwen2.5-7b' });
  // 未写回 contextEstimate → 回落 tokenEstimate（短历史极小）→ 不应压缩
  const res = await MemoryStore.compactIfNeeded(id, {});
  assert.notStrictEqual(res.compacted, true, 'no writeback → no spurious compaction');
});
