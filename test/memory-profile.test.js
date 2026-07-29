/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Tests for Layer A (profile/facts, M6) and the optional vector module (M7).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-mem-prof-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes('lib' + path.sep + 'memory')) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');
const llm = require('../lib/memory/llm-bridge');
const profile = require('../lib/memory/profile');
const embed = require('../lib/memory/embed');

test('profile: extracts + de-duplicates facts and regenerates profile.md', async () => {
  llm.setLLMCaller(async (system, user) => '- 用户偏好中文回复\n- 在做 Hesi 本地 AI 终端项目\n- 用户偏好中文回复'); // duplicate on purpose
  try {
    const id = 's_prof_' + Date.now().toString(36);
    MemoryStore.ensure(id, { title: '画像测试' });
    await MemoryStore.append(id, [
      { id: 'p1', role: 'user', content: '我喜欢用中文交流，正在做 Hesi 这个项目。' },
      { id: 'p2', role: 'assistant', content: '好的。' },
    ]);
    const r = await profile.extractFacts(id, {});
    assert.strictEqual(r.extracted, 3);
    assert.strictEqual(r.added, 2, 'duplicate fact should not be added twice');

    const facts = profile.getFacts();
    assert.strictEqual(facts.length, 2);
    const dup = facts.find((f) => f.fact.includes('中文回复'));
    assert.ok(dup && dup.confidence > 1, 'duplicate fact confidence should accumulate');

    const md = profile.getProfile();
    assert.ok(md.includes('用户画像'), 'profile.md should be regenerated');
    assert.ok(md.includes('中文回复'), 'profile should list the fact');
  } finally {
    llm.setLLMCaller(null);
  }
});

test('profile: removeFact deletes by id', async () => {
  llm.setLLMCaller(null);
  const before = profile.getFacts().length;
  const facts = profile.getFacts();
  if (facts.length) {
    const removed = profile.removeFact(facts[0].id);
    assert.strictEqual(removed, 1);
    assert.strictEqual(profile.getFacts().length, before - 1);
  } else {
    assert.ok(true, 'no facts to remove (skipped)');
  }
});

test('embed: disabled by default → null, no error', async () => {
  assert.strictEqual(embed.enabled(), false);
  const v = await embed.embed('anything');
  assert.strictEqual(v, null);
});

test('embed: cosine similarity sanity', () => {
  assert.ok(embed.cosine([1, 0], [1, 0]) > 0.99);
  assert.ok(embed.cosine([1, 0], [0, 1]) < 0.01);
  assert.strictEqual(embed.cosine([1, 0], [1, 0, 0]), 0); // length mismatch
});

test('recall: works with embeddings disabled (pure BM25)', async () => {
  llm.setLLMCaller(null);
  const id = 's_rec_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: '召回测试' });
  await MemoryStore.append(id, [
    { id: 'r1', role: 'user', content: '记得帮我配置 Hesi 的 MCP 连接器。' },
  ]);
  const block = MemoryStore.recall('MCP 连接器', { topK: 3 });
  assert.ok(block && block.content.includes('召回测试'), 'BM25 recall should surface the session');
});
