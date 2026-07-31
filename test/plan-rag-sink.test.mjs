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

const sinkModule = (await import('../routes/ai-tools/plan-rag-sink.js')).default;
const sinkPlanToIndex = sinkModule.sinkPlanToIndex;
const stableRef = sinkModule.stableRef;
const redact = sinkModule.redact;
const enforceCapacity = sinkModule.enforceCapacity;
const recall = (await import('../lib/memory/recall.js')).default;
const indexStore = (await import('../lib/memory/index-store.js')).default;

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

// 每个用例前清空历史 Plan，避免共享 index 导致计数污染
test.beforeEach(() => {
  const idx = indexStore.load();
  idx.docs = (idx.docs || []).filter((d) => d.type !== 'plan');
  indexStore.save(idx);
});

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

test('stableRef：优先复用稳定业务 id（非 uuid），uuid 则走内容哈希', () => {
  assert.equal(stableRef({ id: 'login-refactor' }), 'plan:login-refactor');
  // uuid v4 → 走哈希（稳定但非业务 id）
  const uuid1 = '8f1d4e2a-1234-4abc-8def-0123456789ab';
  const uuid2 = '9f1d4e2a-1234-4abc-8def-0123456789cd';
  const ref = stableRef({ id: uuid1, objective: 'O', steps: [{ goal: 'g', action: 'a' }] });
  assert.match(ref, /^plan:[0-9a-f]{12}$/);
  // 相同目标+步骤 → 相同哈希（更新而非新增，不随 uuid 变化）
  const ref2 = stableRef({ id: uuid2, objective: 'O', steps: [{ goal: 'g', action: 'a' }] });
  assert.equal(ref, ref2);
});

test('sinkPlanToIndex：失败 Plan 默认也回流（HESI_PLAN_RAG_SINK_FAILED）', () => {
  const plan = { id: 'pf', objective: '可能失败的事', steps: [{ id: 's1', goal: 'g', action: 'a' }] };
  const doc = sinkPlanToIndex(plan, { status: 'rejected', steps: [{ id: 's1', status: 'error', output: 'boom' }] });
  assert.ok(doc);
  assert.equal(doc.meta.status, 'rejected');
  assert.equal(doc.meta.ok, false);
  // 关闭失败回流 → 不写
  process.env.HESI_PLAN_RAG_SINK_FAILED = '0';
  try {
    const r = sinkPlanToIndex(plan, { status: 'rejected', steps: [] });
    assert.equal(r, null);
  } finally {
    delete process.env.HESI_PLAN_RAG_SINK_FAILED;
  }
});

test('sinkPlanToIndex：轻量脱敏（路径用户段 + 高熵密钥打码）', () => {
  const t = redact('访问 /home/alice/.ssh 与 C:\\Users\\bob\\secret.txt，密钥 sk-abcdef1234567890abcdef');
  assert.ok(!t.includes('/home/alice'));
  assert.ok(!t.includes('C:\\Users\\bob'));
  assert.ok(t.includes('<user>'));
  assert.ok(t.includes('sk-<secret>'));
  // HESI_PLAN_RAG_REDACT=0 关闭脱敏
  process.env.HESI_PLAN_RAG_REDACT = '0';
  try {
    assert.ok(redact('/home/alice/x').includes('/home/alice'));
  } finally {
    delete process.env.HESI_PLAN_RAG_REDACT;
  }
});

test('enforceCapacity：超出 HESI_PLAN_INDEX_MAX 删最旧（实时读取 env）', () => {
  process.env.HESI_PLAN_INDEX_MAX = '3';
  try {
    for (let i = 0; i < 5; i++) {
      sinkPlanToIndex({ id: `cap${i}`, objective: `容量测试${i}`, steps: [{ id: 's1', goal: 'g', action: 'a' }] }, { status: 'done' });
    }
    const idx = indexStore.load();
    const plans = idx.docs.filter((d) => d.type === 'plan');
    assert.equal(plans.length, 3); // 超出 3 → 仅保留 3
  } finally {
    delete process.env.HESI_PLAN_INDEX_MAX;
  }
});

