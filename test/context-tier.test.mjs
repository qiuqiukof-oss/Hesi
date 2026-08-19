import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierMessages, tierSavings, DEFAULT_L0_ROUNDS, DEFAULT_L1_ROUNDS } from '../lib/context-tier.js';

function mkRounds(n, textLen = 200) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `round${i} ` + 'x'.repeat(textLen),
    ts: i,
  }));
}

test('少于 L0 轮数 → 全部 L0，无回收', () => {
  const rounds = mkRounds(2);
  const t = tierMessages(rounds);
  assert.equal(t.l0.length, 2);
  assert.equal(t.l1.length, 0);
  assert.equal(t.l2.length, 0);
  assert.equal(t.dropped, 0);
});

test('L0=3 保留最近 3 轮全文；其前 5 轮进 L1 摘要；更早进 L2', () => {
  const rounds = mkRounds(12);
  const t = tierMessages(rounds);
  // 最近 3 轮 → L0（round9/10/11）
  assert.equal(t.l0.length, 3);
  assert.deepEqual(t.l0.map((r) => r.content.slice(0, 7)), ['round9 ', 'round10', 'round11']);
  // 前 5 轮 → L1 摘要（round4..8）
  assert.equal(t.l1.length, 5);
  assert.ok(t.l1.every((m) => m._tier === 'L1'));
  // 更早 4 轮 → L2 引用
  assert.equal(t.l2.length, 4);
  assert.ok(t.l2.every((m) => m._tier === 'L2'));
  assert.equal(t.dropped, 4);
});

test('L1 摘要超长被截断到 l1MaxChars + hint 标注', () => {
  const rounds = mkRounds(10, 5000); // 每轮 5000 字符
  const t = tierMessages(rounds, { l1MaxChars: 300 });
  for (const m of t.l1) {
    assert.ok(m.content.length <= 300 + 40, `L1 摘要应受限，实际 ${m.content.length}`);
    assert.ok(m._fullLength >= 5000);
  }
  assert.ok(t.l0.length >= 1);
});

test('有 summary 时 L1 优先用 summary', () => {
  const rounds = [
    { role: 'user', content: 'x'.repeat(2000), summary: '用户问了 A' },
    { role: 'assistant', content: 'y'.repeat(2000), summary: '助手答了 B' },
    { role: 'user', content: '最新问题' },
  ];
  const t = tierMessages(rounds, { l0Rounds: 1, l1Rounds: 2 });
  assert.equal(t.l1.length, 2);
  assert.ok(t.l1[0].content.includes('用户问了 A'), 'L1 应用 summary 而非原文');
});

test('tierSavings：回收率与节省 token 估算', () => {
  const rounds = mkRounds(20, 100); // 20 轮 × ~108 字符
  const t = tierMessages(rounds);
  const s = tierSavings(t);
  assert.ok(s.savedTokens > 0);
  assert.ok(s.savedPct > 0, `应省 >0%，实际 ${s.savedPct}%`);
  assert.ok(s.keptTokens > 0);
  // 全量字符 > 保留字符
  assert.ok(t.totalChars > t.keptChars);
});

test('默认阈值常量可读', () => {
  assert.equal(DEFAULT_L0_ROUNDS, 3);
  assert.equal(DEFAULT_L1_ROUNDS, 5);
});

test('空输入安全', () => {
  const t = tierMessages([]);
  assert.equal(t.l0.length, 0);
  assert.equal(t.l1.length, 0);
  assert.equal(t.l2.length, 0);
  assert.equal(t.totalChars, 0);
});
