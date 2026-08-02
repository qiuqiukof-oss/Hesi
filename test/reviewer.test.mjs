import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review, QUALITY_GATES } from '../lib/reviewer.js';

const PLAN = {
  goal: '为 X 增加 JWT 登录',
  artifactsRequired: ['src/auth.js', 'tests/auth.spec.ts'],
};

test('质量 OK + 无漂移 → CONTINUE', () => {
  const r = review({
    plan: PLAN,
    verifierDelta: [],
    artifacts: ['src/auth.js', 'tests/auth.spec.ts'],
  });
  assert.equal(r.quality.v, 'OK');
  assert.equal(r.drift.v, 'ON_TRACK');
  assert.equal(r.verdict, 'CONTINUE');
});

test('质量 WARN（delta ≥ 3）→ CONTINUE 带警告', () => {
  const delta = Array.from({ length: 3 }, (_, i) => ({ itemId: `i${i}`, missing: [{ type: 'functional', check: `c${i}`, reason: 'expect 未命中' }] }));
  const r = review({ plan: PLAN, verifierDelta: delta, artifacts: PLAN.artifactsRequired });
  assert.equal(r.quality.v, 'WARN');
  assert.equal(r.verdict, 'CONTINUE');
  assert.ok(r.why.includes('质量警告'));
});

test('质量 POOR（delta ≥ 8）→ STOP（不无目标重做）', () => {
  const delta = Array.from({ length: 8 }, (_, i) => ({ itemId: `i${i}`, missing: [{ type: 'functional', check: `c${i}`, reason: 'x' }] }));
  const r = review({ plan: PLAN, verifierDelta: delta, artifacts: PLAN.artifactsRequired });
  assert.equal(r.quality.v, 'POOR');
  assert.equal(r.verdict, 'STOP');
});

test('质量 POOR + plan 未修订（原地打转）→ STOP 且 why 说明原地打转', () => {
  const delta = Array.from({ length: 9 }, (_, i) => ({ itemId: `i${i}`, missing: [{ type: 'functional', check: `c${i}`, reason: 'x' }] }));
  const r = review({ plan: PLAN, verifierDelta: delta, artifacts: PLAN.artifactsRequired, planRevised: false });
  assert.equal(r.verdict, 'STOP');
  assert.ok(r.why.includes('原地打转'));
});

test('缺失工件 → WARN/POOR 并按数量分级', () => {
  const r1 = review({ plan: PLAN, verifierDelta: [], artifacts: ['src/auth.js'] }); // 缺 1 个 → WARN
  assert.equal(r1.quality.v, 'WARN');
  const r2 = review({ plan: PLAN, verifierDelta: [], artifacts: [] }); // 缺 2 个（≥3 才 POOR，2 仍 WARN）
  assert.equal(r2.quality.v, 'WARN');
  const r3 = review({
    plan: { goal: 'x', artifactsRequired: ['a', 'b', 'c'] },
    verifierDelta: [],
    artifacts: [],
  });
  assert.equal(r3.quality.v, 'POOR'); // 缺 3 个 → POOR
});

test('漂移（driftEvidence 非空）→ ESCALATE 人工介入，绝不自动续跑', () => {
  const r = review({
    plan: PLAN,
    verifierDelta: [],
    artifacts: PLAN.artifactsRequired,
    driftEvidence: ['修订后 goal 从「JWT 登录」变为「OAuth 改造」'],
  });
  assert.equal(r.drift.v, 'DRIFTED');
  assert.equal(r.verdict, 'ESCALATE');
  assert.ok(r.why.includes('目标漂移'));
});

test('漂移即使质量 OK 也 ESCALATE（漂移优先）', () => {
  const r = review({
    plan: PLAN,
    verifierDelta: [],
    artifacts: PLAN.artifactsRequired,
    driftEvidence: ['commit msg 偏离目标词'],
  });
  assert.equal(r.verdict, 'ESCALATE');
});

test('QUALITY_GATES 可读', () => {
  assert.equal(QUALITY_GATES.warnDeltaItems, 3);
  assert.equal(QUALITY_GATES.poorDeltaItems, 8);
});
