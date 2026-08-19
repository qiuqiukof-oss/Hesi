/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P2：「⚡ 自动执行」对话回合（routes/chat/plan-turn.js）+ SSE 公共工具。
// 覆盖：事件名映射 / 计划摘要 / SSE 帧序 / 断开即取消（两个阶段）/ 心跳 / 参数校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { createRouter as createChatRouter } from '../routes/chat/index.js';

import { runPlanTurn, sseEventName, summarizePlan } from '../routes/chat/plan-turn.js';
import { sse, startHeartbeat, watchDisconnect, openSseStream } from '../routes/chat/sse-util.js';

// 测试不回流 RAG 索引，避免污染仓库真实 index.json
process.env.HESI_PLAN_RAG_SINK = '0';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-plan-turn-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 's');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

/** 极简 Express Response 替身：记录写出的每一帧，并可手工触发 'close'。 */
function fakeRes() {
  const res = /** @type {any} */ (new EventEmitter());
  res.writableEnded = false;
  res.headers = {};
  res.frames = [];
  res.onWrite = null;
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.setTimeout = () => {};
  res.write = (chunk) => {
    const s = String(chunk);
    res.frames.push(s);
    if (typeof res.onWrite === 'function') res.onWrite(s);
    return true;
  };
  res.end = () => { res.writableEnded = true; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.jsonBody = o; res.writableEnded = true; return res; };
  res.events = () => res.frames
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)));
  res.types = () => res.events().map((e) => e.type);
  return res;
}

const twoStepPlan = () => ({
  id: 'p-test',
  title: '两步测试计划',
  objective: 't',
  acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
  steps: [
    { id: 's1', goal: '第一步', action: 'echo one' },
    { id: 's2', goal: '第二步', action: 'echo two' },
  ],
  forbidden: [],
  scope_paths: [],
  budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
});

// ── 纯函数 ──

test('sseEventName：统一加 plan_ 前缀并把 kebab/冒号换成下划线', () => {
  assert.equal(sseEventName('step'), 'plan_step');
  assert.equal(sseEventName('await-approval'), 'plan_await_approval');
  assert.equal(sseEventName('chat-token'), 'plan_chat_token');
  assert.equal(sseEventName('discuss:start'), 'plan_discuss_start');
  assert.equal(sseEventName(''), 'plan_');
});

test('summarizePlan：只发清单所需字段，action 截断到 200 字符', () => {
  const long = 'x'.repeat(500);
  const out = summarizePlan({ id: 'p1', title: 'T', steps: [{ id: 's1', goal: 'g', action: long, requireApproval: true }] }, 'E1');
  assert.equal(out.execId, 'E1');
  assert.equal(out.planId, 'p1');
  assert.equal(out.stepCount, 1);
  assert.equal(out.steps[0].action.length, 200);
  assert.equal(out.steps[0].requireApproval, true);
  assert.equal(out.steps[0].index, 0);
});

test('summarizePlan：steps 缺失时不抛，返回空清单', () => {
  const out = summarizePlan({}, 'E2');
  assert.equal(out.stepCount, 0);
  assert.deepEqual(out.steps, []);
});

// ── SSE 公共工具 ──

test('sse-util：openSseStream 设置全套流式响应头', () => {
  const res = fakeRes();
  openSseStream(res);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers['Connection'], 'keep-alive');
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
});

test('sse-util：心跳写注释帧（不以 data: 开头，前端天然忽略），stop 后不再写', async () => {
  const res = fakeRes();
  const stop = startHeartbeat(res, 10);
  await new Promise((r) => setTimeout(r, 45));
  stop();
  const beats = res.frames.filter((f) => f.startsWith(': hb'));
  assert.ok(beats.length >= 2, `期望至少 2 次心跳，实际 ${beats.length}`);
  assert.equal(res.events().length, 0, '心跳不得产生 data 帧');
  const after = res.frames.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.frames.length, after, 'stop() 后不应再写心跳');
});

test('sse-util：watchDisconnect 在 close 后置真，dispose 后解绑', () => {
  const res = fakeRes();
  const w = watchDisconnect(res);
  assert.equal(w.isAborted(), false);
  res.emit('close');
  assert.equal(w.isAborted(), true);
  w.dispose();
  assert.equal(res.listenerCount('close'), 0);
});

test('sse-util：连接已关闭时 sse() 静默失败，不抛给业务', () => {
  const res = fakeRes();
  res.write = () => { throw new Error('EPIPE'); };
  assert.doesNotThrow(() => sse(res, { type: 'x' }));
});

// ── 回合主流程 ──

test('runPlanTurn：无目标且无 plan → 400，不开流', async () => {
  const res = fakeRes();
  await runPlanTurn(res, {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.frames.length, 0);
  assert.match(res.jsonBody.error, /目标描述/);
});

test('runPlanTurn：给定 plan → 帧序 start→generated→step…→done→[DONE]', async () => {
  const dir = tmpRepo();
  const res = fakeRes();
  await runPlanTurn(res, { plan: twoStepPlan(), objective: 't', cwd: dir });

  const types = res.types();
  assert.equal(types[0], 'plan_start');
  assert.equal(types[1], 'plan_generated');
  assert.equal(types[types.length - 1], '[DONE]');
  assert.equal(types[types.length - 2], 'plan_done');
  assert.ok(res.writableEnded, '回合结束必须 end()');

  const steps = res.events().filter((e) => e.type === 'plan_step');
  assert.ok(steps.length >= 2, `期望至少 2 条步骤事件，实际 ${steps.length}`);
  const ids = new Set(steps.map((s) => s.id));
  assert.ok(ids.has('s1') && ids.has('s2'), '两个步骤都应有事件');

  const generated = res.events().find((e) => e.type === 'plan_generated');
  assert.equal(generated.stepCount, 2);
  assert.equal(generated.steps[0].goal, '第一步');

  const done = res.events().find((e) => e.type === 'plan_done');
  assert.ok(typeof done.status === 'string' && done.status.length > 0);
  assert.ok(typeof done.durationMs === 'number');
});

test('runPlanTurn：拆解阶段断开 → 直接 cancelled，绝不浪费一次真实执行', async () => {
  const dir = tmpRepo();
  const res = fakeRes();
  let generated = false;
  const p = runPlanTurn(res, {
    objective: '做点什么',
    cwd: dir,
    // 模拟一次有耗时的 NL→Plan 拆解，期间用户关掉页面
    generatePlanFn: async () => {
      await new Promise((r) => setTimeout(r, 20));
      generated = true;
      return twoStepPlan();
    },
  });
  await new Promise((r) => setTimeout(r, 5));
  res.emit('close');
  await p;

  assert.ok(generated, '生成本身已完成（只是结果不再执行）');
  const types = res.types();
  assert.ok(types.includes('plan_status'), '应先发拆解中状态');
  assert.ok(types.includes('plan_cancelled'), `期望 plan_cancelled，实际 ${types.join(',')}`);
  const cancelled = res.events().find((e) => e.type === 'plan_cancelled');
  assert.equal(cancelled.phase, 'generate');
  assert.equal(types.includes('plan_generated'), false, '取消后不再铺开清单');
  assert.equal(types.includes('plan_step'), false, '一步都不应执行');
  assert.equal(types.includes('plan_done'), false);
  assert.equal(types[types.length - 1], '[DONE]');
});

test('runPlanTurn：拆解失败 → 发 plan_error(phase=generate) 并干净收尾', async () => {
  const res = fakeRes();
  await runPlanTurn(res, {
    objective: '做点什么',
    generatePlanFn: async () => { const e = new Error('模型返回不可解析'); e.code = 'GEN_FAILED'; throw e; },
  });
  const err = res.events().find((e) => e.type === 'plan_error');
  assert.ok(err, '应发出 plan_error');
  assert.equal(err.phase, 'generate');
  assert.equal(err.code, 'GEN_FAILED');
  assert.equal(res.types().includes('plan_step'), false);
  assert.equal(res.types()[res.types().length - 1], '[DONE]');
  assert.ok(res.writableEnded);
});

test('runPlanTurn：执行中途断开 → 下一步在边界中止（决策①断开即取消）', async () => {
  const dir = tmpRepo();
  const res = fakeRes();
  // 第一条步骤事件一到就断开：runPlan 在进入下一步前检查 shouldAbort
  res.onWrite = (s) => {
    if (s.startsWith('data: ') && s.includes('"plan_step"')) {
      res.onWrite = null;
      res.emit('close');
    }
  };
  await runPlanTurn(res, { plan: twoStepPlan(), objective: 't', cwd: dir });

  const steps = res.events().filter((e) => e.type === 'plan_step');
  const aborted = steps.some((s) => s.status === 'aborted');
  const s2done = steps.some((s) => s.id === 's2' && s.status === 'done');
  assert.ok(aborted, `期望出现 aborted 步骤事件，实际 ${JSON.stringify(steps.map((s) => [s.id, s.status]))}`);
  assert.equal(s2done, false, '断开后不应再把后续步骤跑完');
  assert.ok(res.types().includes('plan_cancelled'), '应发出 plan_cancelled 终态');
});

// ── Express 接线：POST /api/chat 分流到自动执行回合 ──
// 用一个「必定被可验证性闸门驳回」的 plan（acceptance 为 manual），
// runPlan 在 gatePlan 处即返回，不会触碰 git / 不产生 auto-* 分支 → 对仓库零副作用。
test('POST /api/chat { planMode:true } → 分流到自动执行回合并流式回帧', async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createChatRouter({}));
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, r));
  const port = /** @type {any} */ (srv.address()).port;

  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '把 README 加一节' }],
        planMode: true,
        plan: {
          id: 'p-gate', title: '闸门驳回样例', objective: 't',
          acceptance: [{ id: 'a1', kind: 'manual', description: '人工看一眼' }],
          steps: [{ id: 's1', goal: '不该被执行', action: 'echo NEVER' }],
          forbidden: [], scope_paths: [], budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
        },
      }),
    });

    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    assert.equal(r.headers.get('x-accel-buffering'), 'no');

    const body = await r.text();
    const events = body.split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    const types = events.map((e) => e.type);

    assert.equal(types[0], 'plan_start');
    assert.ok(types.includes('plan_generated'), '应铺开步骤清单');
    assert.ok(types.includes('plan_done'), `应收到终态，实际 ${types.join(',')}`);
    assert.equal(types[types.length - 1], '[DONE]');

    const done = events.find((e) => e.type === 'plan_done');
    assert.equal(done.ok, false);
    assert.equal(done.status, 'rejected', '不可机器验证的 plan 必须被闸门驳回');
    // 注意：plan_generated 帧本就会把 action 文本发给前端作清单展示，
    // 所以不能用「body 里出现 NEVER」判定执行。真正的判据是：没有任何步骤被真正跑起来。
    // 闸门驳回时 runPlan 会补发一条 { status:'rejected', id:null } 的步骤级通知（非执行）。
    const stepEvents = events.filter((e) => e.type === 'plan_step');
    const executed = stepEvents.filter((e) => e.status !== 'rejected');
    assert.equal(
      executed.length, 0,
      `被驳回的 plan 绝不能产生步骤执行事件，实际 ${JSON.stringify(stepEvents.map((s) => [s.id, s.status]))}`,
    );
    assert.ok(
      stepEvents.some((e) => e.status === 'rejected'),
      '应把闸门驳回原因作为步骤级事件透出，前端才有得可看',
    );
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('runPlanTurn：步骤输出超长时按 P1 契约截断并带元信息', async () => {
  const dir = tmpRepo();
  const res = fakeRes();
  const plan = twoStepPlan();
  // 产出 >4000 字符输出：normalizeStepEvent 应截断并标记
  plan.steps = [{ id: 's1', goal: '长输出', action: `node -e "console.log('y'.repeat(9000))"` }];
  await runPlanTurn(res, { plan, objective: 't', cwd: dir });

  const withOut = res.events().filter((e) => e.type === 'plan_step' && typeof e.output === 'string' && e.output.length);
  assert.ok(withOut.length > 0, '应有带输出的步骤事件');
  const big = withOut.find((e) => e.outputTruncated);
  assert.ok(big, '超长输出应被标记 outputTruncated');
  assert.ok(big.output.length < 4200, '截断后长度应受控');
  assert.ok(big.outputFullLength > 4000);
});
