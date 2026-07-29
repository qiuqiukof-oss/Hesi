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

test('决策①：含 manual acceptance → 拒收并要人补', () => {
  const r = gatePlan(manualPlan());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.deepStrictEqual(r.missing, ['a2']);
  assert.ok(r.reason.includes('机器'));
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

test('决策②：无 roundtableFn → 直接兜底回决策①', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' }; // 无 verify
  const r = await resolveCheckpoint(machinePlan(), step, { rounds: 3 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.strictEqual(r.fellBack, true);
});

test('决策②：roundtable 首轮即推导成功 → 通过，记录轮数', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => ({ kind: 'command', command: 'npm run lint', expect: '0 error' }),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.usedRoundtable, true);
  assert.strictEqual(r.roundsUsed, 1);
  assert.ok(r.derivedVerify && r.derivedVerify.kind === 'command');
});

test('决策②：roundtable 第 2 轮成功', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  let n = 0;
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => {
      n++;
      return n < 2 ? null : { kind: 'script', command: 'node check.js' };
    },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.roundsUsed, 2);
});

test('决策②：roundtable 始终 null → 耗尽轮数兜底回决策①', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 3,
    roundtableFn: async () => null,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.needsAcceptance, true);
  assert.strictEqual(r.fellBack, true);
  assert.strictEqual(r.roundsUsed, 3);
});

test('决策②：roundtable 返回 manual → 不算成功，耗尽后兜底', async () => {
  const step = { id: 's2', goal: 'g', action: 'a' };
  const r = await resolveCheckpoint(machinePlan(), step, {
    rounds: 2,
    roundtableFn: async () => ({ kind: 'manual', description: '人确认' }),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fellBack, true);
});
