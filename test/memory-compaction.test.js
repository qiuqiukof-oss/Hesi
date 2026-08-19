/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Tests for automatic compaction (M5) and the chat-injection contract (M4):
//   - compactIfNeeded summarizes the old segment and trims raw messages
//   - degrades to "keep raw" when the LLM is unavailable
//   - after compaction, getSummaryBlock + recall surface the summary
// Uses an injected fake LLM so no network/API key is needed.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate to a temp dir + reset require cache for lib/memory.
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-mem-comp-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes('lib' + path.sep + 'memory')) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');
const llm = require('../lib/memory/llm-bridge');
const compaction = require('../lib/memory/compaction');

function makeMessages(n) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    ms.push({ id: 'm_' + i, role: i % 2 === 0 ? 'user' : 'assistant', content: '消息内容 ' + i + ' '.repeat(40) });
  }
  return ms;
}

test('compaction: summarizes old segment and trims raw messages', async () => {
  let calls = 0;
  llm.setLLMCaller(async (system, user) => {
    calls++;
    return '【摘要】这是压缩后的会话摘要，保留了关键决策与用户偏好。';
  });
  try {
    const id = 's_comp_' + Date.now().toString(36);
    MemoryStore.ensure(id, { title: '长会话' });
    await MemoryStore.append(id, makeMessages(40)); // > WORKING_WINDOW(24)
    const before = MemoryStore.get(id);
    assert.ok(before.messages.length > before.workingWindow, 'session exceeds working window');

    const result = await compaction.compactIfNeeded(id, {});
    assert.strictEqual(result.compacted, true, 'should report compacted');
    assert.strictEqual(calls, 1, 'LLM should be called exactly once');

    const after = MemoryStore.get(id);
    assert.strictEqual(after.messages.length, after.workingWindow, 'raw messages trimmed to window');
    assert.ok(after.summary.includes('摘要'), 'summary stored');

    // getSummaryBlock now yields a <session_summary> system block
    const sb = MemoryStore.getSummaryBlock(id);
    assert.ok(sb && sb.role === 'system' && sb.content.includes('<session_summary>'));

    // recall should surface the summary text for a related query
    const block = MemoryStore.recall('会话 摘要', { topK: 3 });
    assert.ok(block && block.content.includes('摘要'), 'recall surfaces summary');
  } finally {
    llm.setLLMCaller(null);
  }
});

test('compaction: degrades to keep-raw when LLM unavailable', async () => {
  llm.setLLMCaller(null); // force real path → no api key → null
  const id = 's_deg_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: '无LLM' });
  await MemoryStore.append(id, makeMessages(40));
  const result = await compaction.compactIfNeeded(id, {}); // no apiKey → llm returns null
  assert.strictEqual(result.degraded, true, 'should report degraded (llm-unavailable)');
  const s = MemoryStore.get(id);
  assert.strictEqual(s.messages.length, 40, 'raw messages preserved on degrade');
  assert.strictEqual(s.summary, '', 'no summary written on degrade');
});

// v0.3.1 A3：切点落在工具轮中间时自动顺延到下一条 user 边界
test('compaction A3: cut point defers to next user boundary (no orphan tool msg)', async () => {
  llm.setLLMCaller(async () => '【摘要】边界守卫测试摘要。');
  try {
    const id = 's_a3_' + Date.now().toString(36);
    MemoryStore.ensure(id, { title: '工具轮跨切点' });
    // 40 条（窗口 24 → 原始切点=16）。构造 15-19 为一个工具轮：
    // 15=assistant(发起工具), 16..18=tool 结果, 19=assistant(总结), 20=user。
    const ms = [];
    for (let i = 0; i < 40; i++) {
      let role;
      if (i === 15 || i === 19) role = 'assistant';
      else if (i >= 16 && i <= 18) role = 'tool';
      else if (i === 20) role = 'user';
      else role = i % 2 === 0 ? 'user' : 'assistant';
      ms.push({ id: 'm_' + i, role, content: '内容 ' + i + ' '.repeat(40), ts: 1700000000000 + i });
    }
    await MemoryStore.append(id, ms);

    const result = await compaction.compactIfNeeded(id, {});
    assert.strictEqual(result.compacted, true, 'should compact');
    assert.strictEqual(result.dropped, 20, 'cut deferred from 16 to 20 (user boundary)');

    const after = MemoryStore.get(id);
    assert.strictEqual(after.messages.length, 20, '40 - 20 dropped = 20 retained');
    assert.strictEqual(after.messages[0].role, 'user', 'retained segment starts at user');
    assert.strictEqual(after.messages[0].id, 'm_20', 'first retained is the boundary user msg');
  } finally {
    llm.setLLMCaller(null);
  }
});

// v0.3.1 A3：保留段内完全无 user 边界（极端全工具轮）→ 跳过本次压缩
test('compaction A3: skips when no user boundary after cut point', async () => {
  let calls = 0;
  llm.setLLMCaller(async () => { calls++; return '不该被调用'; });
  try {
    const id = 's_a3skip_' + Date.now().toString(36);
    MemoryStore.ensure(id, { title: '全工具轮' });
    // 前 16 条正常对话；16 以后全是 assistant/tool，无 user 边界。
    const ms = [];
    for (let i = 0; i < 40; i++) {
      let role;
      if (i < 16) role = i % 2 === 0 ? 'user' : 'assistant';
      else role = i % 2 === 0 ? 'tool' : 'assistant';
      ms.push({ id: 'm_' + i, role, content: '内容 ' + i + ' '.repeat(40), ts: 1700000000000 + i });
    }
    await MemoryStore.append(id, ms);

    const result = await compaction.compactIfNeeded(id, {});
    assert.strictEqual(result.skipped, true, 'should skip');
    assert.strictEqual(result.reason, 'no-user-boundary', 'reports no-user-boundary');
    assert.strictEqual(calls, 0, 'LLM not called');
    const s = MemoryStore.get(id);
    assert.strictEqual(s.messages.length, 40, 'messages untouched');
  } finally {
    llm.setLLMCaller(null);
  }
});

test('compaction: no-op when session is within working window', async () => {
  llm.setLLMCaller(null);
  const id = 's_small_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: '短会话' });
  await MemoryStore.append(id, makeMessages(10));
  const result = await compaction.compactIfNeeded(id, {});
  assert.strictEqual(result.skipped, true, 'should skip without compaction');
});
