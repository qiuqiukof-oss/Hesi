// @ts-check
// Plan schema 校验单测
import test from 'node:test';
import assert from 'node:assert';
import {
  validatePlan,
  isMachineVerifiable,
  nonVerifiableAcceptanceIds,
  emptyPlan,
  AUTO_VERIFY_KINDS,
} from '../routes/ai-tools/plan-schema.js';

const validPlan = () => ({
  objective: '在聊天面板加导出按钮',
  acceptance: [{ id: 'a1', kind: 'command', command: 'npm test' }],
  steps: [{ id: 's1', goal: '注入按钮', action: 'edit chat-panel.js' }],
});

test('合法 plan 通过校验', () => {
  const r = validatePlan(validPlan());
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
});

test('非对象 plan 被拒', () => {
  assert.strictEqual(validatePlan(null).ok, false);
  assert.strictEqual(validatePlan('x').ok, false);
});

test('objective 缺失被拒', () => {
  const p = validPlan();
  delete p.objective;
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('objective')));
});

test('无 acceptance 被拒', () => {
  const p = validPlan();
  p.acceptance = [];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('acceptance')));
});

test('acceptance command 缺 command 字段被拒', () => {
  const p = validPlan();
  p.acceptance = [{ id: 'a1', kind: 'command' }];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('command')));
});

test('无 steps 被拒', () => {
  const p = validPlan();
  p.steps = [];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('steps')));
});

test('step 缺 goal/action 被拒', () => {
  const p = validPlan();
  p.steps = [{ id: 's1' }];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('goal')));
  assert.ok(r.errors.some((e) => e.includes('action')));
});

test('重复 step id 被拒', () => {
  const p = validPlan();
  p.steps = [
    { id: 's1', goal: 'g', action: 'a' },
    { id: 's1', goal: 'g2', action: 'a2' },
  ];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('重复')));
});

test('依赖不存在被拒', () => {
  const p = validPlan();
  p.steps = [{ id: 's1', goal: 'g', action: 'a', dependsOn: ['sX'] }];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('依赖')));
});

test('verify kind 非法被拒', () => {
  const p = validPlan();
  p.steps = [{ id: 's1', goal: 'g', action: 'a', verify: { kind: 'telepathy' } }];
  const r = validatePlan(p);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('verify')));
});

test('全机器可验证 → isMachineVerifiable=true', () => {
  assert.strictEqual(isMachineVerifiable(validPlan()), true);
});

test('含 manual acceptance → 不可机器验证', () => {
  const p = validPlan();
  p.acceptance.push({ id: 'a2', kind: 'manual', description: '人眼确认' });
  assert.strictEqual(isMachineVerifiable(p), false);
  assert.deepStrictEqual(nonVerifiableAcceptanceIds(p), ['a2']);
});

test('emptyPlan 默认不可机器验证（无 acceptance）', () => {
  assert.strictEqual(isMachineVerifiable(emptyPlan()), false);
});

test('AUTO_VERIFY_KINDS 不含 manual', () => {
  assert.ok(!AUTO_VERIFY_KINDS.includes('manual'));
});
