/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// in-flight 去重（方案 D-3）路由层专属测试。
//
// 被测逻辑：routes/ai-tools/plan-routes.js 内闭包的 inFlightRoundtables Map——
// 同一 objective（SHA1 stableRef）的并发 /execute 请求共享同一次圆桌讨论结果，
// 避免双跑烧钱；讨论完成后 finally 自清理（无内存泄漏）；不同 objective 不误合并。
//
// 隔离策略（与 plan-routes.test.mjs 同风格的真实 HTTP 集成测试）：
//   - require.cache 桩替换 ../chat/discuss 的 runRoundtable（门控假实现，杜绝真实 LLM）；
//   - 桩替换 ./plan-from-nl 的 generatePlanFromObjective / revisePlan（返回固定小 plan，
//     杜绝 objective→plan 生成走网络）；
//   - HESI_PLAN_RAG_SINK=0 关闭回流落盘；
//   - cwd 指向临时 git 仓库（git 已安装，echo 步骤可真实执行 → 响应 200 done）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
// 注意：plan-routes.js 必须动态 import——ESM 静态 import 会被提升到模块体之前执行，
// 导致其内部 require('../chat/discuss') / require('./plan-from-nl') 在桩注入前就
// 解构出真实实现。动态 import 保证桩先就位。见下方桩注入之后的加载点。

process.env.HESI_PLAN_RAG_SINK = '0';

// ── 依赖桩：在 plan-routes.js 首次 require 前注入 ──
const req = createRequire(import.meta.url);
const PLAN_ROUTES = req.resolve('../routes/ai-tools/plan-routes.js');
const DISCUSS = path.join(path.dirname(PLAN_ROUTES), '..', 'chat', 'discuss.js');
const PLAN_FROM_NL = path.join(path.dirname(PLAN_ROUTES), 'plan-from-nl.js');

const sharedState = { calls: 0, inflight: 0, maxInflight: 0, gate: null };
function makeFakeRunRoundtable() {
  return async () => {
    sharedState.calls++;
    sharedState.inflight++;
    sharedState.maxInflight = Math.max(sharedState.maxInflight, sharedState.inflight);
    if (sharedState.gate) await sharedState.gate; // 门控：讨论悬置，直到测试放行
    sharedState.inflight--;
    return { summary: '【收敛结论】按计划执行', transcript: '讨论实录', cleanFinish: true };
  };
}

function stubModule(absPath, exportsObj) {
  req.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports: exportsObj };
}
const originalDiscuss = req.cache[DISCUSS];
const originalPlanFromNl = req.cache[PLAN_FROM_NL];
stubModule(DISCUSS, { runRoundtable: makeFakeRunRoundtable() });
stubModule(PLAN_FROM_NL, {
  generatePlanFromObjective: async () => ({
    objective: 'dummy',
    acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
    steps: [{ id: 's1', goal: 'g', action: 'echo ok' }],
    forbidden: [],
    scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
  }),
  revisePlan: async () => null,
});
after(() => {
  if (originalDiscuss) req.cache[DISCUSS] = originalDiscuss; else delete req.cache[DISCUSS];
  if (originalPlanFromNl) req.cache[PLAN_FROM_NL] = originalPlanFromNl; else delete req.cache[PLAN_FROM_NL];
});

// 桩已注入 → 现在才加载被测模块（动态 import，ESM 不提升）
const { createRouter } = await import('../routes/ai-tools/plan-routes.js');

// ── 基建（与 plan-routes.test.mjs 同款） ──
function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-dedup-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 's');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

function makeWf() {
  return {
    async start() { return JSON.stringify({ ok: true, workflowId: 'wf', taskCount: 1 }); },
    async status() { return JSON.stringify({ ok: true, workflowId: 'wf', status: 'completed', tasks: [] }); },
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

function waitFor(pred, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (pred()) return resolve(true);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor 超时'));
      setTimeout(poll, 15);
    })();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBody(objective) {
  return {
    objective,
    discussBeforePlan: true,
    partners: ['ai', 'critic'],
    discussMode: 'auto', // 跳过 confirm 挂起，避免测试卡在等确认
  };
}

// ── 用例 ──

test('in-flight 去重：同 objective 并发请求共享一次讨论（真合并，非双跑）', async () => {
  const dir = tmpRepo();
  const events = [];
  let releaseGate;
  sharedState.calls = 0; sharedState.inflight = 0; sharedState.maxInflight = 0;
  sharedState.gate = new Promise((r) => { releaseGate = r; });
  const router = createRouter({ cwd: dir, workflowManager: makeWf(), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  const url = `http://127.0.0.1:${port}/api/plan/execute`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // 请求 1 先进入讨论（门控悬置）
    const p1 = post(makeBody('同一目标'));
    await waitFor(() => events.some((e) => e.type === 'plan:discussion-start'));
    // 请求 2 在讨论仍在途时并发到达 → 应走 shared 分支
    const p2 = post(makeBody('同一目标'));
    await waitFor(() => events.some((e) => e.type === 'plan:discussion-shared'));
    await sleep(30); // 给假讨论一个"若误双跑"的机会窗口

    assert.equal(sharedState.calls, 1, '同目标并发只应跑一次讨论');
    assert.equal(sharedState.maxInflight, 1, '讨论并发峰值=1（真合并）');
    assert.equal(events.filter((e) => e.type === 'plan:discussion-start').length, 1, '仅广播一次 discussion-start');
    assert.equal(events.filter((e) => e.type === 'plan:discussion-shared').length, 1, '第二个请求广播 discussion-shared');

    releaseGate(); sharedState.gate = null;
    const [r1, r2] = await Promise.all([p1, p2]);
    const d1 = await r1.json(); const d2 = await r2.json();
    assert.equal(d1.ok, true); assert.equal(d2.ok, true);
    assert.equal(d1.status, 'done'); assert.equal(d2.status, 'done');
    assert.notEqual(d1.execId, d2.execId, '两请求各有独立 execId（去重的是讨论，不是请求）');
  } finally {
    if (releaseGate) releaseGate();
    sharedState.gate = null;
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('in-flight 去重：完成后 Map 自清理，同目标新请求重新讨论（无泄漏）', async () => {
  const dir = tmpRepo();
  const events = [];
  sharedState.calls = 0; sharedState.inflight = 0; sharedState.maxInflight = 0;
  sharedState.gate = null; // 不门控：讨论立即完成
  const router = createRouter({ cwd: dir, workflowManager: makeWf(), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  const url = `http://127.0.0.1:${port}/api/plan/execute`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const r1 = await (await post(makeBody('目标'))).json();
    assert.equal(r1.ok, true);
    assert.equal(sharedState.calls, 1, '第一次讨论已执行');
    // 等 finally 清理窗口过去后，同目标再请求 → 必须重新讨论（calls=2），证明 Map 已清
    await sleep(50);
    const r2 = await (await post(makeBody('目标'))).json();
    assert.equal(r2.ok, true);
    assert.equal(sharedState.calls, 2, '完成后 Map 条目已清理，新请求重新讨论');
    assert.equal(events.filter((e) => e.type === 'plan:discussion-start').length, 2, '两次都广播 start（第二次非 shared）');
    assert.equal(events.filter((e) => e.type === 'plan:discussion-shared').length, 0, '无并发时不应出现 shared');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('in-flight 去重：不同 objective 不被误合并（误杀率 0）', async () => {
  const dir = tmpRepo();
  const events = [];
  sharedState.calls = 0; sharedState.inflight = 0; sharedState.maxInflight = 0;
  sharedState.gate = null;
  const router = createRouter({ cwd: dir, workflowManager: makeWf(), broadcastFn: (d) => events.push(d) });
  const { srv, port } = await startServer(router);
  const url = `http://127.0.0.1:${port}/api/plan/execute`;
  const post = (body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    // 两个不同目标并发 → 各自独立讨论（可并行，互不合并）
    const [r1, r2] = await Promise.all([post(makeBody('目标A')), post(makeBody('目标B'))]);
    assert.equal((await r1.json()).ok, true);
    assert.equal((await r2.json()).ok, true);
    assert.equal(sharedState.calls, 2, '不同 objective 各跑一次讨论，不误合并');
    assert.equal(events.filter((e) => e.type === 'plan:discussion-shared').length, 0, '无 shared 广播（无合并发生）');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
