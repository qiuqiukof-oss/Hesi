// @ts-check
// P2.1 记忆时间轴：computeTimeline 纯函数单测
import test from 'node:test';
import assert from 'node:assert';
import { computeTimeline } from '../public/components/memory-timeline.js';

test('空数据：total=0 / checkpoints=0 / 无时间跨度', () => {
  const r = computeTimeline({ events: [], turns: [] });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.checkpoints, 0);
  assert.strictEqual(r.firstTs, 0);
  assert.strictEqual(r.lastTs, 0);
});

test('统计消息角色分布与压缩点计数', () => {
  const events = [
    { kind: 'message', role: 'user', ts: 1000 },
    { kind: 'message', role: 'assistant', ts: 2000 },
    { kind: 'message', role: 'assistant', ts: 3000 },
    { kind: 'checkpoint', ts: 2500, seq: 1 },
  ];
  const r = computeTimeline({ events });
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.checkpoints, 1);
  assert.strictEqual(r.byRole.user, 1);
  assert.strictEqual(r.byRole.assistant, 2);
  assert.strictEqual(r.firstTs, 1000);
  assert.strictEqual(r.lastTs, 3000);
});

test('缺失字段不抛错（容错）', () => {
  const r = computeTimeline({});
  assert.strictEqual(r.total, 0);
  const r2 = computeTimeline({ events: [null, undefined, { kind: 'message' }] });
  assert.strictEqual(r2.total, 3);
});
