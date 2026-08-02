/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// M4 自动重试打磨单测：
// - attempts 轨迹结构（n/status/kind/reason/revised）
// - retryable 失败触发 autoReplan + 时间线 + 恢复成功
// - fatal 失败（权限/语法/逻辑）→ 不重试，直接 rejected
// - 无进展早停（连续修订结构相同 → 终止）
// - C6：同一 runPlan 内已审批步骤在重试时复用审批结论（仅 1 次审批）
// - maxRetries 封顶（不无限重试）
//
// 说明：命令型步骤（action 像 shell 命令）会被 runPlan 走「直执模式」真正执行，
// 无法用 mock workflow 注入失败。故本文件用「自然语言 action + 外部 agentId」驱动
// 轨道B（workflowManager mock）以精确注入每轮每步状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPlan } from '../routes/ai-tools/run-plan.js';

const FAKE_AGENT = 'fake-agent';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-retry-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

const mockRoundtable = async () => ({ kind: 'command', command: 'echo derived', expect: 'derived' });

// 自然语言步骤 + 外部 agentId → 走轨道B（workflowManager mock）
function nlPlan(over = {}) {
  return {
    objective: '示例目标',
    acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
    steps: [
      { id: 's1', goal: '做点事', action: '请帮我完成第一步', agentId: FAKE_AGENT },
      { id: 's2', goal: '验证点', action: '请帮我验证', agentId: FAKE_AGENT, checkpoint: true },
    ],
    allow_external: false, forbidden: [], scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
    ...over,
  };
}

/** 状态随「尝试次数」变化的假 workflowManager：statuses[i] 是第 i 次尝试各步状态。
 *  stepsPerAttempt = 每次尝试的步数（runOneAttempt 每步各调一次 start/status，
 *  故用 start 累计次数推导当前是第几次尝试）。 */
function makeWfByAttempt(statuses, stepsPerAttempt) {
  let startCount = 0;
  return {
    async start(name, tasks) {
      startCount += 1;
      return JSON.stringify({ ok: true, workflowId: 'wf', name, taskCount: tasks.length });
    },
    async status() {
      const attemptIdx = Math.floor((startCount - 1) / stepsPerAttempt);
      const map = statuses[Math.min(attemptIdx, statuses.length - 1)];
      const tasks = Object.entries(map).map(([id, s]) => ({ id, status: s.status, output: s.output || '' }));
      return JSON.stringify({ ok: true, workflowId: 'wf', status: 'completed', tasks });
    },
  };
}

test('retryable 失败触发 autoReplan → 修订后重试成功，时间线 attempts 结构正确', async () => {
  const dir = tmpRepo();
  let reviseCalls = 0;
  const wf = makeWfByAttempt([
    { s1: { status: 'failed', output: 'boom' } },
    { s1: { status: 'completed' } },
  ], 1);
  const res = await runPlan(nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我完成', agentId: FAKE_AGENT }] }), {
    cwd: dir, workflowManager: wf, roundtableFn: mockRoundtable, defaultAgentId: FAKE_AGENT,
    maxRetries: 1,
    revisePlanFn: async () => { reviseCalls += 1; return nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我修好', agentId: FAKE_AGENT }] }); },
  });
  assert.equal(res.status, 'done');
  assert.equal(res.revised, true);
  assert.equal(reviseCalls, 1);
  assert.equal(res.attempts.length, 2);
  assert.equal(res.attempts[0].n, 1);
  assert.equal(res.attempts[0].status, 'partial'); // 第 1 轮 reflection=partial
  assert.equal(res.attempts[0].kind, 'retryable');
  assert.equal(res.attempts[0].revised, true);     // 第 1 轮后触发了修订
  assert.equal(res.attempts[1].n, 2);
  assert.equal(res.attempts[1].status, 'done');
  assert.equal(res.attempts[1].kind, 'terminal');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fatal 失败（语法错误）不重试，直接 rejected 且带 fatal 原因', async () => {
  const dir = tmpRepo();
  let reviseCalls = 0;
  const wf = makeWfByAttempt([
    { s1: { status: 'failed', output: 'SyntaxError: unexpected token' } },
  ], 1);
  const res = await runPlan(nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我执行', agentId: FAKE_AGENT }] }), {
    cwd: dir, workflowManager: wf, roundtableFn: mockRoundtable, defaultAgentId: FAKE_AGENT,
    maxRetries: 3,
    revisePlanFn: async () => { reviseCalls += 1; return nlPlan(); },
  });
  assert.equal(res.status, 'rejected');
  assert.equal(res.revised, false);
  assert.equal(reviseCalls, 0);                          // 致命失败不应触发修订
  assert.equal(res.attempts.length, 1);
  assert.equal(res.attempts[0].kind, 'fatal');
  assert.ok(/致命/.test(res.reason || ''));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('无进展早停：连续修订结构相同 → 终止并 rejected（防烧 token）', async () => {
  const dir = tmpRepo();
  let reviseCalls = 0;
  const samePlan = nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我做', agentId: FAKE_AGENT }] });
  const wf = makeWfByAttempt([
    { s1: { status: 'failed', output: 'boom' } },
    { s1: { status: 'failed', output: 'boom' } },
  ], 1);
  const res = await runPlan(nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我做', agentId: FAKE_AGENT }] }), {
    cwd: dir, workflowManager: wf, roundtableFn: mockRoundtable, defaultAgentId: FAKE_AGENT,
    maxRetries: 5,
    revisePlanFn: async () => { reviseCalls += 1; return JSON.parse(JSON.stringify(samePlan)); },
  });
  assert.equal(res.status, 'rejected');
  // P0：无进展早停现由 ReplanController 的 STALL（原地重复）确定性判定承担，语义等价
  // 且更早停：第 2 轮 decide 即判 STALL，不再发起第 2 次修订（reviseCalls=1）
  assert.ok(/原地重复|无进展/.test(res.reason || ''));
  assert.equal(reviseCalls, 1);
  assert.equal(res.attempts.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C6：同一 runPlan 内已审批步骤在重试时复用审批结论（仅 1 次审批）', async () => {
  const dir = tmpRepo();
  const approvals = [];
  const plan = nlPlan({
    steps: [
      { id: 's1', goal: '可能失败', action: '请帮我做第一步', agentId: FAKE_AGENT, on_fail: 'continue' },
      { id: 's2', goal: '需审批', action: '请帮我做第二步', agentId: FAKE_AGENT, requireApproval: true },
    ],
  });
  const wf = makeWfByAttempt([
    { s1: { status: 'failed', output: 'boom' }, s2: { status: 'completed' } },
    { s1: { status: 'completed' }, s2: { status: 'completed' } },
  ], 2);
  const res = await runPlan(plan, {
    cwd: dir, workflowManager: wf, roundtableFn: mockRoundtable, defaultAgentId: FAKE_AGENT,
    maxRetries: 1,
    requestApproval: async (req) => { approvals.push(req.id); return true; },
    revisePlanFn: async (p) => ({ ...p, _rev: Math.random() }), // 结构变化避免 noProgress
  });
  assert.equal(res.status, 'done');
  assert.deepEqual(approvals, ['s2']);                   // 两轮仅 1 次审批（重试复用）
  fs.rmSync(dir, { recursive: true, force: true });
});

test('maxRetries 封顶：始终失败也不无限重试', async () => {
  const dir = tmpRepo();
  let reviseCalls = 0;
  const wf = makeWfByAttempt([
    { s1: { status: 'failed', output: 'boom' } },
    { s1: { status: 'failed', output: 'boom' } },
    { s1: { status: 'failed', output: 'boom' } },
  ], 1);
  const res = await runPlan(nlPlan({ steps: [{ id: 's1', goal: 'g', action: '请帮我做', agentId: FAKE_AGENT }] }), {
    cwd: dir, workflowManager: wf, roundtableFn: mockRoundtable, defaultAgentId: FAKE_AGENT,
    maxRetries: 2,
    // 每次修订都改变 step 签名（action 文本），避免触发「无进展早停」（那是 test 3 的覆盖范围）
    revisePlanFn: async () => {
      reviseCalls += 1;
      return nlPlan({ steps: [{ id: 's1', goal: 'g', action: `请帮我做第${reviseCalls}次修订`, agentId: FAKE_AGENT }] });
    },
  });
  assert.equal(reviseCalls, 2);                          // cap=2，无第 3 次修订
  assert.equal(res.attempts.length, 3);                  // 首轮 + 2 次重试
  assert.ok(res.attempts.every((a) => a.kind === 'retryable'));
  fs.rmSync(dir, { recursive: true, force: true });
});
