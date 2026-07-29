// @ts-check
// 回滚改良（P2）：每轮 user + assistant 消息在 append 时按「当前轮检查点 seq」打戳，
// 使「该轮的用户提问」消息气泡下可渲染「重新编辑 / 重新生成」（按钮锚点在用户消息，
// 前端 rollbackTo(seq) 恢复到该轮之前状态）。
// 覆盖：①user/assistant 消息按轮次同 seq；②重复 append 同条消息保留已存 seq（幂等）；
// ③rollbackTo(seq) 恢复到该轮之前状态（消息数正确）。隔离到临时目录 HESI_MEMORY_DIR。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-rollback-seq-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(path.join('lib', 'memory'))) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');

// 模拟真实服务端流程：每轮开始先 checkpoint（建立该轮 seq 检查点），再 append 该轮对话。
async function turn(id, seq, userMsg, assistantMsg) {
  MemoryStore.checkpoint(id); // 轮开始：ckpt.<seq>，topSeq = seq
  await MemoryStore.append(id, [userMsg, assistantMsg]);
}

test('rollback redesign: user+assistant of each turn stamped with the same turn seq', async () => {
  const id = 's_seq_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: 'seq' });

  await turn(id, 1, { id: 'u1', role: 'user', content: 'Q1', ts: 1 }, { id: 'a1', role: 'assistant', content: 'A1', ts: 2 });
  await turn(id, 2, { id: 'u2', role: 'user', content: 'Q2', ts: 3 }, { id: 'a2', role: 'assistant', content: 'A2', ts: 4 });
  await turn(id, 3, { id: 'u3', role: 'user', content: 'Q3', ts: 5 }, { id: 'a3', role: 'assistant', content: 'A3', ts: 6 });

  const s = MemoryStore.get(id);
  assert.strictEqual(s.messages.length, 6, '应有 6 条消息（3 轮 × 2）');

  // 每轮 user + assistant 同 seq（按钮锚点在用户消息）
  const u1 = s.messages.find((m) => m.id === 'u1'); const a1 = s.messages.find((m) => m.id === 'a1');
  const u2 = s.messages.find((m) => m.id === 'u2'); const a2 = s.messages.find((m) => m.id === 'a2');
  const u3 = s.messages.find((m) => m.id === 'u3'); const a3 = s.messages.find((m) => m.id === 'a3');
  assert.strictEqual(u1.seq, 1, '第1轮 user 应打 seq=1（与 assistant 同）');
  assert.strictEqual(a1.seq, 1, '第1轮 assistant 应打 seq=1');
  assert.strictEqual(u2.seq, 2, '第2轮 user 应打 seq=2');
  assert.strictEqual(a2.seq, 2, '第2轮 assistant 应打 seq=2');
  assert.strictEqual(u3.seq, 3, '第3轮 user 应打 seq=3');
  assert.strictEqual(a3.seq, 3, '第3轮 assistant 应打 seq=3');
});

test('rollback redesign: re-appending same assistant message preserves stored seq (idempotent)', async () => {
  const id = 's_seq_idem_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: 'idem' });

  await turn(id, 1, { id: 'u1', role: 'user', content: 'Q1', ts: 1 }, { id: 'a1', role: 'assistant', content: 'A1', ts: 2 });
  await turn(id, 2, { id: 'u2', role: 'user', content: 'Q2', ts: 3 }, { id: 'a2', role: 'assistant', content: 'A2', ts: 4 });

  // 客户端会重复 PUT（无 seq）同条消息；必须保留已存 seq=2 并更新内容
  await MemoryStore.append(id, [{ id: 'a2', role: 'assistant', content: 'A2-edited', ts: 4 }]);

  const s = MemoryStore.get(id);
  const a2 = s.messages.find((m) => m.id === 'a2');
  assert.strictEqual(a2.seq, 2, '重复 append 必须保留已存 seq=2');
  assert.strictEqual(a2.content, 'A2-edited', '重复 append 应更新内容');

  // 其它轮次 seq 不受影响
  const a1 = s.messages.find((m) => m.id === 'a1');
  assert.strictEqual(a1.seq, 1, '第1轮 seq 不受第2轮重发影响');
});

test('rollback redesign: rollbackTo(seq) restores pre-turn state for regenerate/edit', async () => {
  const id = 's_seq_rb_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: 'rb' });

  await turn(id, 1, { id: 'u1', role: 'user', content: 'Q1', ts: 1 }, { id: 'a1', role: 'assistant', content: 'A1', ts: 2 });
  await turn(id, 2, { id: 'u2', role: 'user', content: 'Q2', ts: 3 }, { id: 'a2', role: 'assistant', content: 'A2', ts: 4 });
  await turn(id, 3, { id: 'u3', role: 'user', content: 'Q3', ts: 5 }, { id: 'a3', role: 'assistant', content: 'A3', ts: 6 });

  // 重新生成第2轮：rollbackTo(2) → 恢复到第2轮之前（仅第1轮 2 条消息）
  const restored = MemoryStore.rollbackTo(id, 2);
  assert.ok(restored, 'rollbackTo(2) 应成功');
  const s = MemoryStore.get(id);
  assert.strictEqual(s.messages.length, 2, 'rollbackTo(2) → 仅保留第1轮消息');
  assert.strictEqual(s.messages[0].id, 'u1');
  assert.strictEqual(s.messages[1].id, 'a1');
  assert.strictEqual(s.messages[1].seq, 1, '恢复后第1轮 assistant 仍带 seq=1');

  // seq>2 的未来态检查点应被丢弃（重新生成走新轮次，不会撞历史 seq）
  const after = MemoryStore.listCheckpoints(id);
  assert.ok(after.every((c) => c.seq <= 2), 'seq>2 的检查点应被丢弃');

  // 重新生成：从恢复态再走一轮 → 新 assistant 得到 seq=3（max+1）
  await turn(id, 3, { id: 'u2', role: 'user', content: 'Q2-regen', ts: 7 }, { id: 'a2', role: 'assistant', content: 'A2-regen', ts: 8 });
  const s2 = MemoryStore.get(id);
  const a2re = s2.messages.find((m) => m.id === 'a2');
  assert.strictEqual(a2re.seq, 3, '重新生成的新轮次应打 seq=3（非旧 2）');
});
