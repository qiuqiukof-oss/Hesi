/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// autoResumeOnTimeout (方案 A) 专项测试。
//
// 行为：
//   1. autoResumeOnTimeout=true + 超时后 agent 才退出 → 不判失败，产出后 resolve 成功
//   2. autoResumeOnTimeout=true + 超时后 agent 始终不退出 → 最终兜底 finalTimeout kill + 失败
//   3. autoResumeOnTimeout 缺省/关闭 → 保持原行为（超时 kill + 失败）
//   4. RESUMING 状态在超时瞬间推送给前端
//
// 实现：orchestrator 模块在加载时读 HESI_AGENT_STEP_TIMEOUT_MS，测试在 require 前
// 注入短超时（60ms），再用可编程 PTY 控制在超时后才产出/退出。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── 短超时注入：必须在 require orchestrator 之前设置 ──
process.env.HESI_AGENT_STEP_TIMEOUT_MS = '60';   // 60ms 单步超时
process.env.HESI_AGENT_FINAL_TIMEOUT_MS = '120'; // 120ms 最终兜底

const { createOrchestrator } = require('../ws/orchestrator');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 可编程 PTY：测试控制何时产出/退出 */
function makePtyCtrl(opts) {
  const ctrl = { killCount: 0, exited: false, opts };
  ctrl.finish = (code) => {
    if (ctrl.exited) return;
    ctrl.exited = true;
    if (ctrl.opts.onExit) ctrl.opts.onExit({ exitCode: code });
  };
  return ctrl;
}

function makeOrchestrator() {
  const noopStore = {
    set() {}, get() { return null; }, delete() {}, subscribe() { return () => {}; },
    query() { return []; }, publish() {},
  };
  const ptys = [];
  const events = [];
  const orch = createOrchestrator({
    createHeadlessPTY: (_cmd, _args, opts) => {
      const ctrl = makePtyCtrl(opts);
      ptys.push(ctrl);
      return {
        write() {},
        kill() { ctrl.killCount++; ctrl.finish(0); },
      };
    },
    getAgentCommand: () => 'fake-agent',
    lookupCommand: () => ({ cmd: 'fake-agent' }),
    contextStore: noopStore,
  });
  // 捕获 ws 消息：用 mock ws 对象，emit 走 ws.send
  const makeWs = () => ({
    readyState: 1,
    send: (m) => events.push(JSON.parse(m)),
  });
  return { orch, ptys, events, makeWs };
}

const defWith = (overrides = {}) => ({
  name: 'wf',
  tasks: [Object.assign(
    { id: 't1', label: 't1', agentId: 'a1', task: 'do work', type: 'agent' },
    overrides
  )],
});

/** 启动工作流并返回 run 引用（orchestrator 内部对象，run 结束后仍可读） */
async function start(orch, ws, def) {
  orch.run(ws, def);     // run 返回 promise，工作流结束才 resolve——不 await
  await sleep(15);       // 让 startTask 同步段执行、PTY 入列
  const run = orch.latestRun(ws);
  assert.ok(run, 'run 应已注册');
  return run;
}

test('autoResume=true：超时后 agent 才退出 → 任务成功（不判失败）', async () => {
  const { orch, ptys, makeWs } = makeOrchestrator();
  const ws = makeWs();
  const run = await start(orch, ws, defWith({ autoResumeOnTimeout: true }));
  const task = run.tasks.get('t1');
  assert.strictEqual(task.autoResumeOnTimeout, true, 'autoResumeOnTimeout 透传');

  // 等 60ms 超时触发 → 应进入 RESUMING（不 kill）
  await sleep(90);
  assert.ok(ptys[0], 'PTY 已创建');
  assert.strictEqual(ptys[0].killCount, 0, 'autoResume 超时不应 kill agent');
  assert.strictEqual(task.status, 'resuming', '超时后任务进入 RESUMING');

  // 超时后 agent 才产出退出 → 任务应成功
  ptys[0].finish(0);
  await sleep(50);
  assert.strictEqual(task.status, 'completed', '产出后任务完成');
  assert.strictEqual(task.exitCode, 0, 'exitCode 0');
  assert.strictEqual(task.error, null, '无错误');
});

test('autoResume=true：超时后 agent 始终不退出 → 最终兜底 kill + 失败', async () => {
  const { orch, ptys, makeWs } = makeOrchestrator();
  const ws = makeWs();
  const run = await start(orch, ws, defWith({ autoResumeOnTimeout: true }));
  const task = run.tasks.get('t1');

  await sleep(90);  // 单步超时 → RESUMING
  assert.strictEqual(task.status, 'resuming');

  await sleep(120); // 最终兜底 120ms → 强制 kill + 失败
  assert.ok(ptys[0].killCount >= 1, '最终兜底应 kill agent');
  assert.strictEqual(task.status, 'failed', '最终兜底后任务失败');
  assert.ok(task.error && task.error.includes('final_timeout'), '错误含 final_timeout');
});

test('autoResume 缺省：保持原行为（超时 kill + 失败）', async () => {
  const { orch, ptys, makeWs } = makeOrchestrator();
  const ws = makeWs();
  const run = await start(orch, ws, defWith({})); // 不设 autoResumeOnTimeout
  const task = run.tasks.get('t1');

  await sleep(90); // 60ms 超时触发
  assert.ok(ptys[0].killCount >= 1, '无 autoResume 超时应 kill agent');
  assert.strictEqual(task.status, 'failed', '无 autoResume 超时应失败');
  assert.ok(task.error && task.error.includes('timeout'), '错误含 timeout');
});

test('透传：tasks 与 flat steps 两种形态 + 缺省 false', async () => {
  const { orch, makeWs } = makeOrchestrator();
  const ws = makeWs();
  // tasks 形态
  let run = await start(orch, ws, defWith({ autoResumeOnTimeout: true }));
  assert.strictEqual(run.tasks.get('t1').autoResumeOnTimeout, true);
  // flat steps 形态
  run = await start(orch, ws, { steps: [{ id: 's1', agentId: 'a1', task: 'x', autoResumeOnTimeout: true }] });
  assert.strictEqual(run.tasks.get('s1').autoResumeOnTimeout, true);
  // 缺省 → false
  run = await start(orch, ws, defWith({}));
  assert.strictEqual(run.tasks.get('t1').autoResumeOnTimeout, false);
});
