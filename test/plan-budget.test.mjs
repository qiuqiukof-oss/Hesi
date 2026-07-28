// @ts-check
// 全局预算守卫单测
import test from 'node:test';
import assert from 'node:assert';
import { PlanBudget } from '../lib/plan-budget.js';

test('默认无上限：tick 不熔断', () => {
  const b = new PlanBudget();
  for (let i = 0; i < 50; i++) assert.deepStrictEqual(b.tickRound(), { ok: true });
});

test('超轮数熔断', () => {
  const b = new PlanBudget({ maxRounds: 3 });
  assert.deepStrictEqual(b.tickRound(), { ok: true });
  assert.deepStrictEqual(b.tickRound(), { ok: true });
  assert.deepStrictEqual(b.tickRound(), { ok: true });
  const r = b.tickRound();
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('轮数'));
});

test('超时间熔断（maxMinutes=0 不限，>0 才限）', () => {
  const b = new PlanBudget({ maxMinutes: 1 });
  // 注入一个过去很久的起始时间
  b._start = Date.now() - 61 * 1000;
  const r = b.tickRound();
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('时间'));
});

test('连续重复熔断（默认阈值 15）', () => {
  const b = new PlanBudget();
  for (let i = 0; i < 14; i++) assert.deepStrictEqual(b.checkLoop('same'), { ok: true });
  const r = b.checkLoop('same');
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('循环'));
});

test('不同签名重置重复计数', () => {
  const b = new PlanBudget({ loopGuard: 3 });
  assert.deepStrictEqual(b.checkLoop('a'), { ok: true });
  assert.deepStrictEqual(b.checkLoop('a'), { ok: true });
  assert.deepStrictEqual(b.checkLoop('b'), { ok: true }); // 重置
  assert.deepStrictEqual(b.checkLoop('a'), { ok: true }); // 重新计数
  assert.deepStrictEqual(b.checkLoop('a'), { ok: true });
  const r = b.checkLoop('a');
  assert.strictEqual(r.ok, false);
});

test('loopGuard=0 关闭熔断', () => {
  const b = new PlanBudget({ loopGuard: 0 });
  for (let i = 0; i < 100; i++) assert.deepStrictEqual(b.checkLoop('x'), { ok: true });
});

test('rounds/tokens getter 累计', () => {
  const b = new PlanBudget();
  b.tickRound(10);
  b.tickRound(5);
  assert.strictEqual(b.rounds, 2);
  assert.strictEqual(b.tokens, 15);
});
