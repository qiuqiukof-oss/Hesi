/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ③ RAG 回流单测：Plan 跑通后回流进 index-store，且 recall 能召回。
// 用 top-level await + 动态 import，确保 config 在 HESI_MEMORY_DIR 设定后才加载。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-rag-'));
process.env.HESI_MEMORY_DIR = TMP;

const sinkPlanToIndex = (await import('../routes/ai-tools/plan-rag-sink.js')).default.sinkPlanToIndex;
const recall = (await import('../lib/memory/recall.js')).default;
const indexStore = (await import('../lib/memory/index-store.js')).default;

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

test('sinkPlanToIndex：回流 plan 快照，recall 可召回（type=plan）', () => {
  const plan = {
    id: 'p1',
    objective: '给 README 加构建状态徽章',
    title: '徽章计划',
    steps: [{ id: 's1', goal: '插入章节', action: 'edit README' }],
    acceptance: [{ id: 'a1', kind: 'command', command: 'grep 构建状态 README.md' }],
  };
  const result = { status: 'done', branch: 'auto-x', steps: [{ id: 's1', status: 'done', goal: '插入章节' }] };
  const doc = sinkPlanToIndex(plan, result);
  assert.ok(doc);
  assert.equal(doc.type, 'plan');
  assert.equal(doc.ref, 'plan:p1');

  const block = recall.relevant('README 构建状态 徽章');
  assert.ok(block, '应召回 plan 快照');
  assert.match(block.content, /已完成 Plan/);
  assert.match(block.content, /徽章计划/);
});

test('sinkPlanToIndex：HESI_PLAN_RAG_SINK=0 时关闭（不写索引）', () => {
  process.env.HESI_PLAN_RAG_SINK = '0';
  try {
    const plan = { id: 'p2', objective: 'o', steps: [{ id: 's1', goal: 'g', action: 'a' }] };
    const r = sinkPlanToIndex(plan, { status: 'done' });
    assert.equal(r, null);
    const idx = indexStore.load();
    assert.equal(idx.docs.filter((d) => d.ref === 'plan:p2').length, 0);
  } finally {
    delete process.env.HESI_PLAN_RAG_SINK;
  }
});
