/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// 可验证性闸门 + checkpoint 兜底单测
import test from 'node:test';
import assert from 'node:assert';
import { gatePlan, resolveCheckpoint, assessVerifiability } from '../routes/ai-tools/plan-contract.js';

const machinePlan = () => ({
  objective: '加导出按钮',
  acceptance: [{ id: 'a1', kind: 'command', command: 'npm test' }],
  steps: [{ id: 's1', goal: 'g', action: 'a' }],
});

const manualPlan = () => {
  const p = machinePlan();
  p.acceptance.push({ id: 'a2', kind: 'manual', description: '人眼确认' });
  return p;
};

test('决策①：机器可验证 plan 通过闸门', () => {
  const r = gatePlan(machinePlan());
  assert.strictEqual(r.ok, true);
  assert.ok(r.verifiable.overall);
});

test('决策①：含 manual acceptance → 拒收（需机器可查 acceptance）', () => {
  const r = gatePlan(manualPlan());
  // 严格模式：manual acceptance 导致不可机器验证 → 闸门拒收
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
});

test('assessVerifiability 报告结构正确', () => {
  const a = assessVerifiability(machinePlan());
  assert.strictEqual(a.overall, true);
  assert.strictEqual(a.acceptance.length, 1);
  assert.strictEqual(a.acceptance[0].machine, true);
  assert.strictEqual(a.steps[0].machine, false); // 无 verify
});

test('决策②：本步已机器可验证 → 直接通过，不进讨论', async () => {
  const step = { id: 's2', goal: 'g', action: 'a', verify: { kind: 'command', command: 'echo ok' } };
  const called = { n: 0 };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => {
      called.n++;
      return null;
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.usedRoundtable, false);
  assert.strictEqual(called.n, 0); // 不应调用 roundtable
});

test('决策②：无 roundtableFn → 严格退回需人补 acceptance', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' }; // 无 verify
  const r = await resolveCheckpoint(machinePlan(), step, { rounds: 3 });
  // 严格模式：无 roundtable 直接退回，阻塞执行
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.strictEqual(r.fellBack, true);
  assert.ok(r.reason.includes('acceptance'));
});

// 契约（现行）：一次「多轮圆桌」调用（maxTurns=rounds），而不是 rounds 次单轮调用。
// 一次多轮更易收敛出 verify，且单次失败即快速回退，不再空转烧资源。
test('决策②：一次多轮圆桌推导成功 → 通过，rounds 作为轮数预算传下去', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  let calls = 0;
  let passedRounds = null;
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async (arg) => {
      calls++;
      passedRounds = arg.rounds;
      return { kind: 'command', command: 'npm run lint', expect: '0 error' };
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.usedRoundtable, true);
  assert.strictEqual(calls, 1, '只应发起一次多轮圆桌，而非逐轮重试');
  assert.strictEqual(passedRounds, 3, '轮数预算应整体交给圆桌');
  assert.ok(r.derivedVerify && r.derivedVerify.kind === 'command');
});

// 契约（现行）：command 与 expect 必须同时具备——缺 expect 则机器无从判定成功，
// 等同不可验证，必须退回人工补 acceptance，绝不放行。
test('决策②：圆桌产出缺 expect → 视为不可验证，退回需人补 acceptance', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => ({ kind: 'script', command: 'node check.js' }), // 无 expect
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.strictEqual(r.fellBack, true);
  assert.ok(r.reason.includes('expect'), `退回原因应点明缺 expect，实际：${r.reason}`);
});

test('决策②：roundtable 始终 null → 耗尽轮数退回需人补', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => null,
  });
  // 圆桌无法推导可验证标准 → 严格退回，阻塞执行
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.strictEqual(r.roundsUsed, 3);
  assert.ok(r.reason.includes('acceptance'));
});

test('决策②：roundtable 返回 manual → 不算成功，耗尽后退回', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 2,
    roundtableFn: async () => ({ kind: 'manual', description: '人确认' }),
  });
  // roundtable 返回 manual（非机器可验证）→ 耗尽后退回需人补 acceptance
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
});
