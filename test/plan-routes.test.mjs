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
    assert.match(data.branch, /^auto-/);
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

test('POST /api/plan/execute manual acceptance → rejected + missing', async () => {
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
    assert.equal(data.status, 'rejected');
    assert.ok(data.missing.includes('a1'));
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
