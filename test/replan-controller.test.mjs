/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P0 终止机制：ReplanController 确定性收敛判断器必停测试。
// 依据《协作工作流终止机制》5.3 测试策略——fixture 序列断言必停：
//   AAA / A→B→A→B / plan漂移 / 预算耗尽 / 正常完成 / acceptance篡改 / diverged震荡
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplanController, normBudget } from '../lib/replan-controller.js';

/** 造一轮 round 上下文（缺省：planHash 唯一、无 gitDiff、未验收通过） */
function round(overrides = {}) {
  return {
    planHash: 'p1',
    gitDiff: '',
    acceptanceAllPass: false,
    acceptanceResults: null,
    accHash: 'acc1',
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
    elapsedMs: 0,
    ...overrides,
  };
}

// ── 纯工具 ──

test('normBudget：只保留三上限字段，忽略其它噪声', () => {
  assert.equal(normBudget({ maxRounds: 5, maxTokens: 100, maxMinutes: 30, extra: 'x' }),
    normBudget({ maxRounds: 5, maxTokens: 100, maxMinutes: 30 }));
  assert.equal(normBudget(null), '{}');
});

// ── 五种终止信号 + 软收敛 ──

test('AAA（原地重复）→ STALL', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  const r = () => round();
  assert.equal(c.decide(r()).v, 'CONTINUE');
  assert.equal(c.decide(r()).v, 'STALL', '第二轮同签名应 STALL');
});

test('A→B→A→B（震荡）→ OSCILL', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  // 每轮带 gitDiff（地面在动），避免被 DRIFT 拦截；A 签名重现 → OSCILL
  assert.equal(c.decide(round({ planHash: 'A', gitDiff: 'a' })).v, 'CONTINUE');
  assert.equal(c.decide(round({ planHash: 'B', gitDiff: 'b' })).v, 'CONTINUE');
  const v = c.decide(round({ planHash: 'A', gitDiff: 'a' }));
  assert.equal(v.v, 'OSCILL', '窗口内重现历史签名应 OSCILL');
});

test('plan 漂移（计划变了但地面没动）→ DRIFT', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  assert.equal(c.decide(round()).v, 'CONTINUE');
  const v = c.decide(round({ planHash: 'p2', gitDiff: '' }));
  assert.equal(v.v, 'DRIFT', 'plan hash 变 + gitDiff 空应 DRIFT');
});

test('预算耗尽 → ESCALATE（partial）', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 1 } });
  const v = c.decide(round({ budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 1 }, elapsedMs: 61 * 1000 }));
  assert.equal(v.v, 'ESCALATE');
  assert.equal(v.partial, true);
});

test('acceptance 全过 → DONE', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  const v = c.decide(round({ acceptanceAllPass: true }));
  assert.equal(v.v, 'DONE');
});

test('acceptance 被篡改 → ESCALATE', () => {
  const c = new ReplanController({ accHash: 'frozen-acc', budgetFrozen: { maxMinutes: 0 } });
  const v = c.decide(round({ accHash: 'tampered-acc' }));
  assert.equal(v.v, 'ESCALATE');
  assert.match(v.why, /篡改/);
});

test('预算被篡改 → ESCALATE', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 30 } });
  const v = c.decide(round({ budget: { maxMinutes: 999, maxRounds: 0, maxTokens: 0 } }));
  assert.equal(v.v, 'ESCALATE');
  assert.match(v.why, /篡改/);
});

test('STALL 优先于 OSCILL（相邻同签名 vs 窗口重现）', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  const r = () => round({ planHash: 'pX', gitDiff: 'same' });
  assert.equal(c.decide(r()).v, 'CONTINUE');
  assert.equal(c.decide(r()).v, 'STALL', '相邻同签名 → STALL（而非 OSCILL）');
});

// ── 正常推进 → CONTINUE 后 DONE ──

test('正常推进（每次有进展）→ CONTINUE，验收全过后 DONE', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  assert.equal(c.decide(round({ planHash: 'p1', gitDiff: 'a' })).v, 'CONTINUE');
  assert.equal(c.decide(round({ planHash: 'p2', gitDiff: 'b' })).v, 'CONTINUE');
  assert.equal(c.decide(round({ planHash: 'p3', gitDiff: 'c', acceptanceAllPass: true })).v, 'DONE');
});

// ── freeze() 与构造等价 ──

test('freeze() 与构造器冻结语义一致', () => {
  const c = new ReplanController();
  c.freeze('frozen-acc', { maxMinutes: 10 });
  const base = { maxRounds: 0, maxTokens: 0, maxMinutes: 10 };
  assert.equal(c.decide(round({ accHash: 'frozen-acc', budget: base })).v, 'CONTINUE');
  assert.equal(c.decide(round({ accHash: 'other', budget: base })).v, 'ESCALATE');
});

// ── diverged 反复出现（方案 P1：不应无限重试）──

test('diverged 反复出现（签名重现）→ OSCILL/STALL 终止', () => {
  const c = new ReplanController({ accHash: 'acc1', budgetFrozen: { maxMinutes: 0 } });
  const d = (planHash, gitDiff) => round({ planHash, gitDiff, acceptanceAllPass: false });
  assert.equal(c.decide(d('v1', 'x')).v, 'CONTINUE');
  assert.equal(c.decide(d('v2', 'y')).v, 'CONTINUE');
  assert.equal(c.decide(d('v1', 'x')).v, 'OSCILL', 'diverged 震荡必须终止');
});
