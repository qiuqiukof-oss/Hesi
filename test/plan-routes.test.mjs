/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRouter } from '../routes/ai-tools/plan-routes.js';

// 避免测试执行时把 plan 快照回流进仓库真实 index.json
process.env.HESI_PLAN_RAG_SINK = '0';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-plan-route-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 's');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

function makeWf(statusFor = 'completed') {
  let taskId = 'task-1';
  return {
    async start(name, tasks) {
      taskId = tasks[0].id;
      return JSON.stringify({ ok: true, workflowId: 'wf', name, taskCount: tasks.length });
    },
    async status() {
      return JSON.stringify({ ok: true, workflowId: 'wf', status: 'completed', tasks: [{ id: taskId, status: statusFor, output: 'ok' }] });
    },
  };
}

function startServer(router) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/plan', router);
  return new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

const goodPlan = {
  objective: 't',
  acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
  steps: [{ id: 's1', goal: 'g', action: 'echo hi' }],
  forbidden: [],
  scope_paths: [],
  budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
};

test('POST /api/plan/execute 全流程 → done', async () => {
  const dir = tmpRepo();
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf('completed') }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: goodPlan }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.status, 'done');
    assert.equal(data.branch, null); // P4-1：取消 auto 分支，runPlan 全程留用户当前分支
    assert.ok(data.steps.every((s) => s.status === 'done'));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/plan/execute 缺 plan → 400', async () => {
  const dir = tmpRepo();
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf() }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 1 }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.ok, false);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/plan/execute manual acceptance → 闸门拒收（rejected）', async () => {
  const dir = tmpRepo();
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf() }));
  try {
    const plan = { ...goodPlan, acceptance: [{ id: 'a1', kind: 'manual', description: '人工' }] };
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    // 严格闸门：manual acceptance 不可机器验证 → 拒收
    assert.equal(data.status, 'rejected');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P2.6 审批闸路由层 ──

function waitFor(pred, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (pred()) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor 超时'));
      setTimeout(poll, 20);
    })();
  });
}

test('审批闸：广播 plan:await-approval 且 approve 端点放行 → done', async () => {
  const dir = tmpRepo();
  const events = [];
  const router = createRouter({ cwd: dir, workflowManager: makeWf('completed'), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  try {
    const plan = { ...goodPlan, steps: [
      { id: 's1', goal: 'g1', action: 'echo 1' },
      { id: 's2', goal: '需审批', action: 'echo 2', requireApproval: true },
    ] };
    const execP = fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
    });
    await waitFor(() => events.some((e) => e.type === 'plan:await-approval'));
    const aw = events.find((e) => e.type === 'plan:await-approval');
    assert.ok(aw);
    assert.equal(aw.step.id, 's2');
    const execId = aw.execId;
    const ap = await fetch(`http://127.0.0.1:${port}/api/plan/${execId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(ap.status, 200);
    const data = await (await execP).json();
    assert.equal(data.status, 'done');
    assert.ok(data.steps.every((s) => s.status === 'done'));
    assert.ok(events.some((e) => e.type === 'plan:approval-resolved' && e.approved === true));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('审批闸：reject 端点 → 计划 diverged（第二步被驳回，第三步不执行）', async () => {
  const dir = tmpRepo();
  const events = [];
  const router = createRouter({ cwd: dir, workflowManager: makeWf('completed'), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  try {
    const plan = { ...goodPlan, steps: [
      { id: 's1', goal: 'g1', action: 'echo 1' },
      { id: 's2', goal: '需审批', action: 'echo 2', requireApproval: true },
      { id: 's3', goal: 'g3', action: 'echo 3' },
    ] };
    const execP = fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
    });
    await waitFor(() => events.some((e) => e.type === 'plan:await-approval'));
    const execId = events.find((e) => e.type === 'plan:await-approval').execId;
    const rj = await fetch(`http://127.0.0.1:${port}/api/plan/${execId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(rj.status, 200);
    const data = await (await execP).json();
    assert.equal(data.status, 'diverged');
    assert.equal(data.steps.length, 2);
    assert.equal(data.steps[1].status, 'rejected');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('审批闸：approve 不存在的 execId → 404', async () => {
  const dir = tmpRepo();
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf() }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/nonexistent/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 404);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('审批闸：超时未操作 → 视为驳回（plan:approval-resolved timedOut），计划 diverged', async () => {
  const dir = tmpRepo();
  const events = [];
  // 注入极小超时（80ms）以覆盖超时路径，无需等待真实 30min
  const router = createRouter({ cwd: dir, workflowManager: makeWf('completed'), broadcastFn: (d) => events.push(d), approvalTimeoutMs: 80 });
  const { srv, port } = await startServer(router);
  try {
    const plan = { ...goodPlan, steps: [
      { id: 's1', goal: 'g1', action: 'echo 1' },
      { id: 's2', goal: '需审批', action: 'echo 2', requireApproval: true },
      { id: 's3', goal: 'g3', action: 'echo 3' },
    ] };
    const data = await (await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
    })).json();
    assert.equal(data.status, 'diverged');          // 超时驳回 = 人为中止（diverged）
    assert.equal(data.steps.length, 2);             // 第三步未执行
    assert.equal(data.steps[1].status, 'rejected'); // 第二步被超时驳回
    // 广播应带 timedOut 标记
    await waitFor(() => events.some((e) => e.type === 'plan:approval-resolved' && e.timedOut === true));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('审批闸：body.approvalTimeoutMs 覆盖默认 30min（per-plan 配置生效）', async () => {
  const dir = tmpRepo();
  const events = [];
  // 注意：createRouter 不注入 approvalTimeoutMs（回退 30min 默认），
  // 仅靠 body.approvalTimeoutMs=80 驱动超时路径，验证 per-plan 覆盖已接入。
  const router = createRouter({ cwd: dir, workflowManager: makeWf('completed'), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  try {
    const plan = { ...goodPlan, steps: [
      { id: 's1', goal: 'g1', action: 'echo 1' },
      { id: 's2', goal: '需审批', action: 'echo 2', requireApproval: true },
      { id: 's3', goal: 'g3', action: 'echo 3' },
    ] };
    const data = await (await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, approvalTimeoutMs: 80 }),
    })).json();
    assert.equal(data.status, 'diverged');          // 超时驳回 = 人为中止（diverged）
    assert.equal(data.steps.length, 2);             // 第三步未执行
    assert.equal(data.steps[1].status, 'rejected'); // 第二步被超时驳回
    await waitFor(() => events.some((e) => e.type === 'plan:approval-resolved' && e.timedOut === true));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── P1 事件通道抽象：步骤级实时事件 ──
// 回归背景：runPlan 一直支持 opts.onStep(ev)，但 plan-routes 调用时从未传入，
// 每个步骤的 start/done 全被丢弃 —— 用户只能等 res.json 一次性返回（黑盒根源）。
// 该用例锁死「执行过程必须逐步发出 plan:step 事件」这一契约。

test('P1 事件通道：执行过程逐步发出 plan:step 实时事件', async () => {
  const dir = tmpRepo();
  const events = [];
  const { srv, port } = await startServer(createRouter({
    cwd: dir,
    workflowManager: makeWf('completed'),
    broadcastFn: (d) => events.push(d),
  }));
  try {
    const plan = {
      objective: 't',
      acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
      steps: [
        { id: 's1', goal: '第一步', action: 'echo one' },
        { id: 's2', goal: '第二步', action: 'echo two' },
      ],
      forbidden: [],
      scope_paths: [],
      budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
    };
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);

    const steps = events.filter((e) => e.type === 'plan:step');
    assert.ok(steps.length >= 2, `应至少收到 2 条 plan:step，实收 ${steps.length}`);
    // 每条事件都必须能定位到具体步骤与本次执行
    for (const ev of steps) {
      assert.equal(ev.execId, data.execId, 'plan:step 必须带 execId 以关联本次执行');
      assert.ok(typeof ev.id === 'string' && ev.id, 'plan:step 必须带步骤 id');
      assert.ok(typeof ev.status === 'string' && ev.status, 'plan:step 必须带 status');
    }
    // 事件应覆盖两个步骤，而非只报告最后一步
    const ids = new Set(steps.map((e) => e.id));
    assert.ok(ids.has('s1') && ids.has('s2'), `事件应覆盖 s1/s2，实际=${[...ids].join(',')}`);
  } finally { srv.close(); }
});

test('P1 事件通道：未注入 broadcastFn 时静默降级，不影响执行', async () => {
  const dir = tmpRepo();
  // 不传 broadcastFn → emit 应为 NOOP，执行流程完全不受影响
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf('completed') }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: goodPlan }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
  } finally { srv.close(); }
});

// ── ④ 运行时逐工具强制拦截（路由层） ──

test('POST /api/plan/execute runtimeIntercept：危险 action 被拦截', async () => {
  const dir = tmpRepo();
  const { srv, port } = await startServer(createRouter({ cwd: dir, workflowManager: makeWf('completed') }));
  try {
    const plan = { ...goodPlan, runtimeIntercept: true, steps: [{ id: 's1', goal: '危险', action: 'rm -rf /tmp/x' }] };
    const res = await fetch(`http://127.0.0.1:${port}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.steps[0].status, 'blocked');
    assert.match(data.steps[0].reason, /拦截/);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
