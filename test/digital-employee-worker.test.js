/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Tests for the Digital Employee roundtable worker (Phase 2.1 key-gap fix).
//
// Historically assignTask() only pushed onto a queue nothing consumed. These
// tests pin down that the worker actually runs queued tasks through the shared
// agentPool, streams cleaned output, updates stats, and degrades safely.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createTaskRunner } = require('../ws/digital-employee-worker');
const { createDigitalEmployee, createDigitalEmployeeTeam } = require('../ws/digital-employee');

/** Build a fake agentPool driven by a scripted sequence of poll responses. */
function makeFakePool(pollScript, opts = {}) {
  const calls = { start: 0, poll: 0, cancel: 0, lastContext: null, lastTask: null };
  let i = 0;
  return {
    calls,
    async start(agentId, task, context) {
      calls.start++;
      calls.lastContext = context;
      calls.lastTask = task;
      if (opts.startFails) return JSON.stringify({ ok: false, error: 'boom' });
      return JSON.stringify({ ok: true, sessionId: 'sid-' + agentId });
    },
    async poll() {
      calls.poll++;
      const step = pollScript[Math.min(i, pollScript.length - 1)];
      i++;
      return JSON.stringify({ ok: true, ...step });
    },
    async cancel() { calls.cancel++; return JSON.stringify({ ok: true }); },
  };
}

test('runOne: completes a task, strips ANSI, updates stats, emits events', async () => {
  const events = [];
  const pool = makeFakePool([
    { status: 'running', output: '\x1b[32mHel', pendingCallbackCount: 0 },
    { status: 'done', output: 'lo\x1b[0m\r\nWorld', pendingCallbackCount: 0 },
  ]);
  const runner = createTaskRunner({ agentPool: pool, broadcast: (d) => events.push(d), pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });

  const r = await runner.runOne(emp, { id: 't1', label: 'demo', task: 'hi' });

  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'done');
  // ANSI colour codes and CR stripped; delta reassembled.
  assert.strictEqual(r.output, 'Hello\nWorld');
  assert.strictEqual(emp.stats.tasksCompleted, 1);
  assert.strictEqual(emp.stats.tasksFailed, 0);
  const types = events.map((e) => e.type);
  assert.deepStrictEqual(
    types.filter((t) => t === 'de:task-start' || t === 'de:task-done').sort(),
    ['de:task-done', 'de:task-start'],
  );
  assert.strictEqual(pool.calls.cancel, 1, 'session must be cancelled in finally');
});

test('runOne: injects persona + context into agentPool context', async () => {
  const pool = makeFakePool([{ status: 'done', output: 'ok', pendingCallbackCount: 0 }]);
  const runner = createTaskRunner({ agentPool: pool, pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'sales', agentId: 'a2' });
  emp.persona = 'PERSONA_LINE';

  await runner.runOne(emp, { id: 't', task: 'do it', context: 'EXTRA_CTX' });

  assert.ok(pool.calls.lastContext.includes('PERSONA_LINE'));
  assert.ok(pool.calls.lastContext.includes('EXTRA_CTX'));
  assert.strictEqual(pool.calls.lastTask, 'do it');
});

test('runOne: missing agentId fails fast without touching the pool', async () => {
  const events = [];
  const pool = makeFakePool([{ status: 'done', output: 'x' }]);
  const runner = createTaskRunner({ agentPool: pool, broadcast: (d) => events.push(d), pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'assistant', agentId: '' });

  const r = await runner.runOne(emp, { id: 't', task: 'hi' });

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(pool.calls.start, 0);
  assert.strictEqual(emp.stats.tasksFailed, 1);
  assert.ok(events.some((e) => e.type === 'de:task-error'));
});

test('runOne: start failure is reported, not thrown', async () => {
  const pool = makeFakePool([], { startFails: true });
  const runner = createTaskRunner({ agentPool: pool, pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });

  const r = await runner.runOne(emp, { id: 't', task: 'hi' });

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.error, 'boom');
  assert.strictEqual(emp.stats.tasksFailed, 1);
});

test('runOne: pending callback (cliq:ask) ends the turn as needs_human', async () => {
  const events = [];
  const pool = makeFakePool([
    { status: 'running', output: 'thinking', pendingCallbackCount: 0 },
    { status: 'running', output: '', pendingCallbackCount: 1, pendingCallbacks: [{ question: '需要密码？' }] },
  ]);
  const runner = createTaskRunner({ agentPool: pool, broadcast: (d) => events.push(d), pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });

  const r = await runner.runOne(emp, { id: 't', task: 'hi' });

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 'needs_human');
  assert.ok(events.some((e) => e.type === 'de:task-output' && /需要密码/.test(e.chunk)));
});

test('drain: serially runs the whole queue and is idempotent', async () => {
  const pool = makeFakePool([{ status: 'done', output: 'ok', pendingCallbackCount: 0 }]);
  const runner = createTaskRunner({ agentPool: pool, pollIntervalMs: 1 });
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });
  emp.taskQueue.push({ id: 't1', task: 'a' }, { id: 't2', task: 'b' }, { id: 't3', task: 'c' });

  // Kick two drains concurrently — the second must no-op (idempotent guard).
  await Promise.all([runner.drain(emp), runner.drain(emp)]);

  assert.strictEqual(emp.taskQueue.length, 0);
  assert.strictEqual(emp.stats.tasksCompleted, 3);
  assert.strictEqual(emp.status, 'idle');
  assert.strictEqual(emp._draining, false);
  assert.strictEqual(pool.calls.start, 3, 'each queued task started exactly once');
});

test('team: dispatchTask enqueues and triggers execution when agentPool wired', async () => {
  const pool = makeFakePool([{ status: 'done', output: 'done', pendingCallbackCount: 0 }]);
  const team = createDigitalEmployeeTeam({ agentPool: pool, runnerOpts: { pollIntervalMs: 1 } });
  assert.strictEqual(team.canExecute, true);
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });
  team.register(emp);

  await team.dispatchTask('assistant', { id: 't1', task: 'go' });
  // dispatchTask returns after enqueue; wait for the background drain to settle.
  await new Promise((r) => setTimeout(r, 30));

  assert.strictEqual(emp.stats.tasksCompleted, 1);
});

test('team: degrades to queue-only when no agentPool provided', async () => {
  const team = createDigitalEmployeeTeam({});
  assert.strictEqual(team.canExecute, false);
  assert.strictEqual(team.runner, null);
  const emp = createDigitalEmployee({ role: 'assistant', agentId: 'a1' });
  team.register(emp);

  const r = await team.dispatchTask('assistant', { id: 't1', task: 'go' });
  assert.strictEqual(r.status, 'queued');
  assert.strictEqual(emp.taskQueue.length, 1, 'task queued but not executed');
});
