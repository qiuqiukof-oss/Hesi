/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Tests for orchestrator concurrent-workflow support (Phase 2.4).
//
// Before this change a single ws mapped to ONE runState, so a second run() on
// the same client silently overwrote the first (orphaning it and corrupting
// activeRuns cleanup). Now a ws maps to Map<wfId, runState>, so multiple
// workflows run concurrently and route/cancel independently.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createOrchestrator } = require('../ws/orchestrator');

/**
 * Build an orchestrator whose agent PTYs never exit on their own — they only
 * finish when kill() is called (which fires onExit, clearing the internal step
 * timeout so the test process can exit cleanly). This keeps started runs "alive"
 * so we can observe concurrency, routing, and cancellation.
 */
function makeOrchestrator() {
  const noopStore = {
    set() {}, get() { return null; }, delete() {},
    subscribe() { return () => {}; },
  };
  return createOrchestrator({
    createHeadlessPTY: (_cmd, _args, opts) => {
      let done = false;
      return {
        write() {},
        kill() { if (!done) { done = true; if (opts.onExit) opts.onExit({ exitCode: 0 }); } },
      };
    },
    getAgentCommand: () => 'fake-agent',
    lookupCommand: () => ({ cmd: 'fake-agent' }), // no errorCode → task starts & stays running
    contextStore: noopStore,
  });
}

const def = (name) => ({
  name,
  tasks: [{ id: 't1', label: name + '-t1', agentId: 'a1', task: 'do work', type: 'agent' }],
});

test('two runs on the same ws coexist (no silent overwrite)', () => {
  const orch = makeOrchestrator();
  const ws = {};

  orch.run(ws, def('wf-A'));               // fire-and-forget; registers synchronously
  const wfA = orch.latestRun(ws).wfId;
  orch.run(ws, def('wf-B'));
  const wfB = orch.latestRun(ws).wfId;

  assert.notStrictEqual(wfA, wfB, 'each run gets a distinct wfId');
  assert.strictEqual(orch.runsFor(ws).size, 2, 'both runs are active concurrently');
  assert.strictEqual(orch.latestRun(ws).wfId, wfB, 'latestRun returns most-recent');

  // cleanup so no timers/promises linger
  orch.cleanupWorkflows(ws);
});

test('cancel targets a specific wfId, leaving the other running', () => {
  const orch = makeOrchestrator();
  const ws = {};

  orch.run(ws, def('wf-A'));
  const wfA = orch.latestRun(ws).wfId;
  orch.run(ws, def('wf-B'));
  const wfB = orch.latestRun(ws).wfId;

  orch.cancel(ws, wfA);

  const runs = orch.runsFor(ws);
  assert.strictEqual(runs.size, 1, 'only the cancelled run is removed');
  assert.ok(runs.has(wfB), 'the other run keeps running');
  assert.ok(!runs.has(wfA), 'cancelled run is gone');

  orch.cleanupWorkflows(ws);
});

test('cleanupWorkflows cancels every run for a ws', () => {
  const orch = makeOrchestrator();
  const ws = {};

  orch.run(ws, def('wf-A'));
  orch.run(ws, def('wf-B'));
  orch.run(ws, def('wf-C'));
  assert.strictEqual(orch.runsFor(ws).size, 3);

  orch.cleanupWorkflows(ws);
  assert.strictEqual(orch.runsFor(ws), undefined, 'ws entry pruned after cleanup');
});

test('addTask/sendMessage without wfId route to the most-recent run', () => {
  const orch = makeOrchestrator();
  const ws = {};

  orch.run(ws, def('wf-A'));
  orch.run(ws, def('wf-B'));
  const wfB = orch.latestRun(ws).wfId;

  const r = orch.addTask(ws, { id: 'dyn1', label: 'dyn', agentId: 'a1', task: 'more', type: 'agent' });
  assert.deepStrictEqual(r, { added: ['dyn1'] });
  // the dynamic task landed in the most-recent run (wf-B), not wf-A
  assert.ok(orch.runsFor(ws).get(wfB).tasks.has('dyn1'));

  orch.cleanupWorkflows(ws);
});

test('addTask with no active run returns an error', () => {
  const orch = makeOrchestrator();
  const ws = {};
  const r = orch.addTask(ws, { id: 'x', agentId: 'a1', task: 't', type: 'agent' });
  assert.deepStrictEqual(r, { error: 'no active run' });
});
