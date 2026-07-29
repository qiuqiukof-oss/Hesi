/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Digital Employee Worker — real task execution for the roundtable
// ------------------------------------------------------------
// Historically createDigitalEmployee().assignTask() only pushed the task onto a
// queue that nothing ever consumed — the "team" looked alive but never actually
// did work. This module is the missing consumer: it drains an employee's queue
// by running each task through the SHARED agentPool (the same engine used by the
// chat "discuss" flow and the workflow manager, so global concurrency limits are
// respected), streams cleaned output over the WebSocket broadcast channel, and
// updates the employee's status/stats.
//
// Kept as its own module (not folded into digital-employee.js) to keep each file
// focused: digital-employee.js owns role/team *state*, this file owns *execution*.
// ============================================================
'use strict';

const { createStreamCleaner } = require('../lib/terminal-clean');

const DEFAULTS = {
  pollIntervalMs: 800,     // matches the discuss flow cadence
  turnTimeoutMs: 5 * 60_000, // hard cap per task
  maxOutputChars: 8000,    // cap the final output payload we broadcast/store
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a task runner bound to an execution engine + broadcast sink.
 *
 * @param {object} deps
 * @param {object} deps.agentPool           — shared AgentPoolManager (start/poll/cancel)
 * @param {(data:object)=>void} [deps.broadcast] — WS broadcast fn (optional; no-op safe)
 * @param {number} [deps.pollIntervalMs]
 * @param {number} [deps.turnTimeoutMs]
 * @param {number} [deps.maxOutputChars]
 * @returns {{ drain: (employee:object)=>Promise<void>, runOne: (employee:object, task:object)=>Promise<object> }}
 */
function createTaskRunner(deps = {}) {
  const agentPool = deps.agentPool;
  const broadcast = typeof deps.broadcast === 'function' ? deps.broadcast : null;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
  const turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULTS.turnTimeoutMs;
  const maxOutputChars = deps.maxOutputChars ?? DEFAULTS.maxOutputChars;

  if (!agentPool || typeof agentPool.start !== 'function') {
    throw new Error('createTaskRunner requires an agentPool with start/poll/cancel');
  }

  const emit = (type, payload) => {
    if (!broadcast) return;
    try { broadcast({ type, ...payload }); } catch { /* broadcast must never throw into the worker */ }
  };

  /** Safely JSON.parse an agentPool response string. */
  const parse = (s) => {
    try { return JSON.parse(s); } catch { return { ok: false, error: 'invalid agentPool response' }; }
  };

  /**
   * Run a single task to completion via the agentPool. Never throws — failures
   * are reported through events + return value.
   * @returns {Promise<{ ok:boolean, status:string, output:string, error?:string }>}
   */
  async function runOne(employee, task) {
    const taskId = task.id || `task-${Date.now()}`;
    const label = task.label || '';
    const rawTask = task.task || task.label || '';

    emit('de:task-start', {
      employeeId: employee.id, role: employee.role, name: employee.name,
      taskId, label, task: String(rawTask).slice(0, 500),
    });

    if (!employee.agentId) {
      employee.status = 'error';
      employee.stats.tasksFailed++;
      const error = '该数字员工未绑定 Agent（agentId 为空）';
      emit('de:task-error', { employeeId: employee.id, taskId, error });
      return { ok: false, status: 'error', output: '', error };
    }

    // persona + optional per-task context become the agentPool "context"; the
    // agentPool wraps rawTask into its own execution prompt (+ ask protocol).
    const context = [employee.persona, task.context].filter(Boolean).join('\n\n');

    let started;
    try {
      started = parse(await agentPool.start(employee.agentId, rawTask, context, broadcast));
    } catch (e) {
      started = { ok: false, error: e?.message || String(e) };
    }
    if (!started.ok) {
      employee.status = 'error';
      employee.stats.tasksFailed++;
      emit('de:task-error', { employeeId: employee.id, taskId, error: started.error });
      return { ok: false, status: 'error', output: '', error: started.error };
    }

    const sid = started.sessionId;
    const deadline = Date.now() + turnTimeoutMs;
    const cleaner = createStreamCleaner();
    let full = '';
    let lastDelta = '';
    let finalStatus = 'timeout';

    try {
      while (Date.now() < deadline) {
        const r = parse(await agentPool.poll(sid));
        if (!r.ok) { finalStatus = 'error'; break; }

        const delta = r.output || '';
        if (delta && delta !== lastDelta) {
          const addedRaw = delta.startsWith(lastDelta) ? delta.slice(lastDelta.length) : delta;
          const added = cleaner(addedRaw).replace(/\r/g, '');
          if (added) {
            full += added;
            emit('de:task-output', { employeeId: employee.id, taskId, chunk: added });
          }
          lastDelta = delta;
        }

        if (r.status === 'done') { finalStatus = 'done'; break; }
        if (r.status === 'error') { finalStatus = 'error'; break; }
        if (r.status === 'timeout' || r.status === 'cancelled') { finalStatus = r.status; break; }
        if (r.pendingCallbackCount > 0) {
          // The roundtable is non-interactive: a CLI agent asking <cliq:ask>
          // cannot be answered here. Surface it and end this turn.
          const qs = (r.pendingCallbacks || []).map((c) => c.question).join('; ');
          emit('de:task-output', { employeeId: employee.id, taskId, chunk: `\n> [需人工介入] ${qs}\n` });
          finalStatus = 'needs_human';
          break;
        }
        await sleep(pollIntervalMs);
      }
    } finally {
      try { await agentPool.cancel(sid); } catch { /* session may already be gone */ }
    }

    const output = full.trim().slice(-maxOutputChars);
    if (finalStatus === 'done') {
      employee.stats.tasksCompleted++;
      emit('de:task-done', { employeeId: employee.id, taskId, ok: true, status: finalStatus, output });
      return { ok: true, status: finalStatus, output };
    }

    employee.stats.tasksFailed++;
    const error = `任务未正常完成（${finalStatus}）`;
    emit('de:task-error', { employeeId: employee.id, taskId, error, output });
    return { ok: false, status: finalStatus, output, error };
  }

  /**
   * Serially drain an employee's task queue. Idempotent: if a drain is already
   * in flight for this employee, returns immediately (the running drain will
   * pick up newly-enqueued tasks).
   */
  async function drain(employee) {
    if (employee._draining) return;
    employee._draining = true;
    emit('de:employee-busy', { employeeId: employee.id });
    try {
      while (employee.taskQueue.length > 0) {
        const task = employee.taskQueue.shift();
        employee.currentTask = task;
        employee.status = 'working';
        await runOne(employee, task);
      }
    } finally {
      employee._draining = false;
      employee.currentTask = null;
      // Reset to idle so the employee is ready for the next dispatch. Per-task
      // failures are reported via events + stats, not by wedging status.
      employee.status = 'idle';
      emit('de:employee-idle', { employeeId: employee.id });
    }
  }

  return { drain, runOne };
}

module.exports = { createTaskRunner, DEFAULTS };
