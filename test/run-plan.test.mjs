/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  runPlan,
  parseVerifyFromSummary,
  checkInterception,
  runAcceptance,
  reflectPlan,
  stepRequiresApproval,
} from '../routes/ai-tools/run-plan.js';

// ── 测试辅助 ──

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-run-plan-'));
  const g = (a) =>
    execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

/** 假 workflowManager：start 一个单步任务，status 立刻返回指定终态 */
function makeWf(statusFor = 'completed', output = 'ok') {
  let taskId = 'task-1';
  return {
    async start(name, tasks) {
      taskId = tasks[0].id;
      return JSON.stringify({ ok: true, workflowId: 'wf-test', name, taskCount: tasks.length });
    },
    async status() {
      return JSON.stringify({
        ok: true,
        workflowId: 'wf-test',
        status: 'completed',
        tasks: [{ id: taskId, status: statusFor, output }],
      });
    },
  };
}

/** 假 roundtableFn：直接返回一条可验证命令 */
const mockRoundtable = async () => ({ kind: 'command', command: 'echo derived', expect: 'derived' });

function basePlan(over = {}) {
  return {
    objective: '示例目标',
    acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
    steps: [
      { id: 's1', goal: '做点事', action: 'echo s1' },
      { id: 's2', goal: '验证点', action: 'echo s2', checkpoint: true },
    ],
    allow_external: false,
    forbidden: [],
    scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
    ...over,
  };
}

// ── 测试 ──

test('runPlan 全流程（mock workflow + mock roundtable + git 仓库）→ done', async () => {
  const dir = tmpRepo();
  const events = [];
  const res = await runPlan(basePlan(), {
    cwd: dir,
    workflowManager: makeWf('completed'),
    roundtableFn: mockRoundtable,
    onStep: (e) => events.push(e),
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'done');
  assert.match(res.branch, /^auto-/);
  assert.equal(res.steps.length, 2);
  assert.ok(res.steps.every((s) => s.status === 'done'));
  assert.equal(res.reflection.stepsDone, 2);
  assert.equal(res.reflection.stepsTotal, 2);
  assert.equal(res.reflection.acceptancePassRate, 1);
  assert.ok(events.length >= 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan 含 forbidden 命令 → 步被拦截（#34 真实前置拦截）', async () => {
  const dir = tmpRepo();
  const plan = basePlan({
    forbidden: ['rm -rf'],
    steps: [{ id: 's1', goal: '危险动作', action: 'rm -rf /' }],
  });
  const res = await runPlan(plan, { cwd: dir, workflowManager: makeWf(), roundtableFn: mockRoundtable });
  assert.equal(res.status, 'partial'); // 被拦 + 默认 stop → 步未完成
  assert.equal(res.steps[0].status, 'blocked');
  assert.match(res.steps[0].reason, /forbidden/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan checkpoint 步无 roundtableFn → 退回需人补充 acceptance（diverged）', async () => {
  const dir = tmpRepo();
  const plan = basePlan({ steps: [{ id: 's1', goal: '软断点', action: 'echo x', checkpoint: true }] });
  const res = await runPlan(plan, { cwd: dir, workflowManager: makeWf(), roundtableFn: undefined });
  assert.equal(res.status, 'diverged');
  assert.equal(res.steps[0].status, 'blocked');
  assert.equal(res.steps[0].needsAcceptance, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan 闸门拒收 manual acceptance → rejected', async () => {
  const plan = basePlan({
    acceptance: [{ id: 'a1', kind: 'manual', description: '人工确认' }],
  });
  const res = await runPlan(plan, { workflowManager: makeWf(), roundtableFn: mockRoundtable });
  assert.equal(res.status, 'rejected');
  assert.ok(res.missing.includes('a1'));
});

test('checkInterception：scope_paths 越界拦截', () => {
  const plan = { scope_paths: ['src'], forbidden: [] };
  assert.equal(checkInterception(plan, { action: 'edit src/a.js' }), null);
  assert.ok(checkInterception(plan, { action: 'edit vendor/x.js' }));
  assert.ok(checkInterception(plan, { action: 'cat ../../etc/passwd' }));
});

test('parseVerifyFromSummary：裸 JSON / 代码块 / 缺失', () => {
  assert.deepEqual(parseVerifyFromSummary('{"kind":"command","command":"ls","expect":"ok"}'), {
    kind: 'command',
    command: 'ls',
    expect: 'ok',
  });
  assert.deepEqual(
    parseVerifyFromSummary('前文...\n```json\n{"kind":"http","command":"https://x","expect":"p"}\n```'),
    { kind: 'http', command: 'https://x', expect: 'p' }
  );
  assert.equal(parseVerifyFromSummary('no json here'), null);
});

test('runAcceptance：命令通过 / 不通过', async () => {
  const pass = await runAcceptance({ acceptance: [{ id: 'a', kind: 'command', command: 'echo ok', expect: 'ok' }] });
  assert.equal(pass.allPass, true);
  const fail = await runAcceptance({ acceptance: [{ id: 'b', kind: 'command', command: 'echo no', expect: 'yes' }] });
  assert.equal(fail.allPass, false);
});

test('reflectPlan：done / partial / diverged 判定', () => {
  const plan = basePlan();
  const done = reflectPlan(plan, [{ status: 'done' }, { status: 'done' }], null, { results: [{ pass: true }], allPass: true });
  assert.equal(done.status, 'done');
  const partial = reflectPlan(plan, [{ status: 'done' }, { status: 'failed' }], null, null);
  assert.equal(partial.status, 'partial');
  const diverged = reflectPlan(plan, [{ status: 'blocked', needsAcceptance: true }], null, null);
  assert.equal(diverged.status, 'diverged');
  const loop = reflectPlan(plan, [{ status: 'loop', reason: 'x' }], null, null);
  assert.equal(loop.status, 'diverged');
});

test('runPlan dryRun：不真正执行 workflow，步标记为 skipped', async () => {
  const plan = basePlan();
  const res = await runPlan(plan, { dryRun: true, roundtableFn: mockRoundtable });
  assert.equal(res.status, 'partial'); // skipped 不算 done
  assert.ok(res.steps.every((s) => s.status === 'skipped'));
});

// ── P2.6 审批闸 ──

test('stepRequiresApproval：标记步 / approvalPolicy=all / 普通步', () => {
  assert.equal(stepRequiresApproval({ approvalPolicy: 'marked' }, { requireApproval: true }), true);
  assert.equal(stepRequiresApproval({ approvalPolicy: 'all' }, { action: 'x' }), true);
  assert.equal(stepRequiresApproval({ approvalPolicy: 'marked' }, { action: 'x' }), false);
  assert.equal(stepRequiresApproval({}, { requireApproval: false }), false);
});

test('runPlan 审批闸：requireApproval 步人工通过 → 继续执行到 done', async () => {
  const dir = tmpRepo();
  const events = [];
  const plan = basePlan({
    steps: [
      { id: 's1', goal: '普通步', action: 'echo s1' },
      { id: 's2', goal: '需审批', action: 'echo s2', requireApproval: true },
    ],
  });
  const res = await runPlan(plan, {
    cwd: dir,
    workflowManager: makeWf('completed'),
    roundtableFn: mockRoundtable,
    onStep: (e) => events.push({ ...e }),
    requestApproval: async () => true,
  });
  assert.equal(res.status, 'done');
  assert.equal(res.steps.length, 2);
  assert.equal(res.steps[1].status, 'done');
  const awaitEv = events.find((e) => e.status === 'await-approval');
  assert.ok(awaitEv, '应发出 await-approval 事件');
  assert.equal(awaitEv.requiresApproval, true);
  assert.equal(awaitEv.id, 's2');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan 审批闸：requireApproval 步人工驳回 → 该步 rejected 且计划中止', async () => {
  const dir = tmpRepo();
  const plan = basePlan({
    steps: [
      { id: 's1', goal: '普通步', action: 'echo s1' },
      { id: 's2', goal: '需审批', action: 'echo s2', requireApproval: true },
      { id: 's3', goal: '后续步', action: 'echo s3' },
    ],
  });
  const res = await runPlan(plan, {
    cwd: dir,
    workflowManager: makeWf('completed'),
    roundtableFn: mockRoundtable,
    requestApproval: async () => false,
  });
  assert.equal(res.status, 'diverged');          // 人工驳回 = 人为中止（diverged）
  assert.equal(res.steps[0].status, 'done');     // 第一步正常完成
  assert.equal(res.steps[1].status, 'rejected'); // 第二步被驳回
  assert.equal(res.steps.length, 2);             // 第三步未执行（中止）
  assert.match(res.steps[1].reason, /驳回/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan 审批闸：approvalPolicy=all 时每步都触发审批', async () => {
  const dir = tmpRepo();
  const calls = [];
  const plan = basePlan({
    approvalPolicy: 'all',
    steps: [
      { id: 's1', goal: '步1', action: 'echo 1' },
      { id: 's2', goal: '步2', action: 'echo 2' },
    ],
  });
  const res = await runPlan(plan, {
    cwd: dir,
    workflowManager: makeWf('completed'),
    roundtableFn: mockRoundtable,
    requestApproval: async (req) => { calls.push(req.id); return true; },
  });
  assert.equal(res.status, 'done');
  assert.deepEqual(calls, ['s1', 's2']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runPlan 审批闸：未提供 requestApproval → 默认通过（不阻断自动执行）', async () => {
  const dir = tmpRepo();
  const plan = basePlan({ steps: [{ id: 's1', goal: '需审批', action: 'echo s1', requireApproval: true }] });
  const res = await runPlan(plan, { cwd: dir, workflowManager: makeWf('completed'), roundtableFn: mockRoundtable });
  assert.equal(res.status, 'done');
  assert.equal(res.steps[0].status, 'done');
  fs.rmSync(dir, { recursive: true, force: true });
});
