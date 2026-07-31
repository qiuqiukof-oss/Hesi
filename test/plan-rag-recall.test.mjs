/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// M1 RAG 检索端单测：listPlans / recallPlans / deletePlan / clearPlans 闭环。
// 用 top-level await + 动态 import，确保 config 在 HESI_MEMORY_DIR 设定后才加载。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-rag-recall-'));
process.env.HESI_MEMORY_DIR = TMP;

const sinkPlanToIndex = (await import('../routes/ai-tools/plan-rag-sink.js')).default.sinkPlanToIndex;
const { recallPlans, listPlans, deletePlan, clearPlans } = await import('../routes/ai-tools/plan-rag-recall.js');

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });
// 每个用例前清空历史 Plan，避免共享 index 导致计数污染
test.beforeEach(() => { clearPlans(); });

function sink(over = {}) {
  const plan = {
    id: over.id || 'p1',
    objective: over.objective || '给 README 加构建状态徽章',
    title: over.title || '徽章计划',
    steps: [{ id: 's1', goal: '插入章节', action: 'edit README' }],
    acceptance: [{ id: 'a1', kind: 'command', command: 'grep 构建状态 README.md' }],
    ...over,
  };
  const result = over.result || { status: 'done', branch: 'auto-x', steps: [{ id: 's1', status: 'done', goal: '插入章节' }] };
  return sinkPlanToIndex(plan, result, over.meta || {});
}

test('sink + listPlans：回流后可列举，按 updatedAt 倒序', () => {
  sink({ id: 'a', objective: '任务A', title: 'A' });
  sink({ id: 'b', objective: '任务B', title: 'B' });
  const { total, items } = listPlans({ limit: 50 });
  assert.equal(total, 2);
  assert.equal(items.length, 2);
  // 倒序：后回流的 b 在前
  assert.equal(items[0].ref, 'plan:b');
  assert.equal(items[1].ref, 'plan:a');
});

test('listPlans：按 status 过滤（失败 Plan 默认也回流）', () => {
  sink({ id: 'ok1', result: { status: 'done', steps: [{ id: 's1', status: 'done' }] } });
  sink({ id: 'fail1', result: { status: 'rejected', steps: [{ id: 's1', status: 'error' }] } });
  const ok = listPlans({ status: 'done' });
  assert.equal(ok.total, 1);
  assert.equal(ok.items[0].ref, 'plan:ok1');
  const fail = listPlans({ status: 'rejected' });
  assert.equal(fail.total, 1);
  assert.equal(fail.items[0].ref, 'plan:fail1');
});

test('recallPlans：按关键词 BM25 召回历史 Plan（type=plan 过滤）', () => {
  sink({ id: 'r1', objective: '重构登录模块', title: '登录重构' });
  const hits = recallPlans('登录 重构', { topK: 5 });
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((d) => d.type === 'plan'));
  assert.ok(hits.some((d) => d.ref === 'plan:r1'));
});

test('deletePlan：按 ref 精确删除一条', () => {
  sink({ id: 'd1', objective: '待删计划', title: 'D' });
  assert.equal(listPlans({}).total, 1);
  const ok = deletePlan('plan:d1');
  assert.equal(ok, true);
  assert.equal(listPlans({}).total, 0);
  assert.equal(deletePlan(''), false);   // 非法 ref 安全返回
  assert.equal(deletePlan(null), false);
});

test('clearPlans：清空全部历史 Plan', () => {
  sink({ id: 'c1' });
  sink({ id: 'c2' });
  assert.equal(listPlans({}).total, 2);
  clearPlans();
  assert.equal(listPlans({}).total, 0);
});
