// @ts-check
// 多轮回滚栈模型：checkpoint 多次 → listCheckpoints 数量递增 → rollbackTo 恢复到指定轮 →
// seq 之后的「未来态」检查点被丢弃。隔离到临时目录 HESI_MEMORY_DIR。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-rollback-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(path.join('lib', 'memory'))) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');

test('multi-turn rollback: checkpoint stack + rollbackTo + discard future', async () => {
  const id = 's_rb_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: 'rb' });
  const rounds = ['第一轮', '第二轮', '第三轮', '第四轮'];
  for (let i = 0; i < rounds.length; i++) {
    // 注意：MemoryStore.append 经 storage.withLock 异步落盘，必须 await 才能紧接 checkpoint
    await MemoryStore.append(id, [{ id: 'm' + i, role: 'user', content: rounds[i], ts: Date.now() + i }]);
    MemoryStore.checkpoint(id);
  }

  const list = MemoryStore.listCheckpoints(id);
  assert.ok(list.length >= 4, '应有至少 4 个检查点, got ' + list.length);
  // 最新应在最后、seq 最大
  assert.strictEqual(list[list.length - 1].seq, list.length, 'seq 应连续自增');

  // rollbackTo 第 2 轮 → 会话恢复到第 2 轮结束态
  const restored = MemoryStore.rollbackTo(id, 2);
  assert.ok(restored, 'rollbackTo(2) 应成功');
  const session = MemoryStore.get(id);
  const userMsgs = (session.messages || []).filter((m) => m.role === 'user').map((m) => m.content);
  assert.deepStrictEqual(userMsgs, ['第一轮', '第二轮'], '应恢复到第2轮: ' + JSON.stringify(userMsgs));

  // seq>2 的检查点（未来态）应被丢弃
  const after = MemoryStore.listCheckpoints(id);
  assert.ok(after.every((c) => c.seq <= 2), 'seq>2 的检查点应被丢弃');

  // 兼容 ⏪ 无参 rollback：回滚到 maxSeq-1（此处 maxSeq=2 → 回到 seq=1）
  const msgs = MemoryStore.rollback(id);
  assert.ok(Array.isArray(msgs), 'rollback() 应返回消息数组');
});
