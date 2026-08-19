/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// 优化方向.md 第 6/7 步的单测：讨论回流（roundtable）进 index-store + recall 召回。
// 用 top-level await + 动态 import，确保 config 在 HESI_MEMORY_DIR 设定后才加载。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-rt-'));
process.env.HESI_MEMORY_DIR = TMP;

const sinkModule = (await import('../routes/ai-tools/plan-rag-sink.js')).default;
const sinkRoundtableToIndex = sinkModule.sinkRoundtableToIndex;
const roundtableStableRef = sinkModule.roundtableStableRef;
const recallModule = (await import('../routes/ai-tools/plan-rag-recall.js')).default;
const recallRoundtables = recallModule.recallRoundtables;
const recallAll = recallModule.recallAll;
const indexStore = (await import('../lib/memory/index-store.js')).default;

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } });

// 每个用例前清空所有类型文档（含 plan + roundtable），避免共享 index 计数污染
test.beforeEach(() => {
  const idx = indexStore.load();
  idx.docs = [];
  indexStore.save(idx);
});

test('roundtableStableRef：同问题 → 同 ref，不同问题 → 不同 ref', () => {
  const q1 = '讨论一下首页改版方案';
  const r1 = roundtableStableRef(q1);
  const r1b = roundtableStableRef(q1);
  const r2 = roundtableStableRef('另一个完全不同的问题');
  assert.match(r1, /^roundtable:[0-9a-f]{12}$/);
  assert.equal(r1, r1b); // 稳定：重复讨论同一问题 → 覆盖更新而非新增
  assert.notEqual(r1, r2);
});

test('sinkRoundtableToIndex：回流 type=roundtable，recallRoundtables 可召回', () => {
  const doc = sinkRoundtableToIndex({
    question: 'README 徽章该放哪个位置？',
    summary: '结论：放在标题下方紧跟 description，用 shields.io 徽章。',
    transcript: '【第1轮 · AI 助手】\n建议放标题下\n【第1轮 · opencode】\n同意，补充用 shields.io',
    products: ['README.md 顶部新增徽章行'],
    verify: 'grep shields README.md',
    planRef: 'plan:p1',
  });
  assert.ok(doc);
  assert.equal(doc.type, 'roundtable');
  assert.match(doc.ref, /^roundtable:[0-9a-f]{12}$/);
  assert.equal(doc.meta.planRef, 'plan:p1');
  assert.equal(doc.meta.executions, 1);

  // transcript 落盘为独立文件（索引只存引用，防膨胀）—— 在 roundtables/ 子目录
  assert.ok(doc.meta.transcriptRef);
  const diskPath = path.join(process.env.HESI_MEMORY_DIR, 'roundtables', doc.meta.transcriptRef);
  assert.ok(fs.existsSync(diskPath), `transcript 应落盘: ${diskPath}`);
  const onDisk = fs.readFileSync(diskPath, 'utf8');
  assert.match(onDisk, /【第1轮 · AI 助手】/);

  // recallRoundtables 仅召回 roundtable 类型
  const hits = recallRoundtables('README 徽章 位置');
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.ref.startsWith('roundtable:')));
  assert.match(hits[0].text, /README/);
});

test('sinkRoundtableToIndex：同问题重复回流 → 覆盖更新（executions 递增）', () => {
  const base = { question: '重复讨论问题', summary: 'v1', transcript: '【第1轮 · AI 助手】\n第一版' };
  sinkRoundtableToIndex(base);
  sinkRoundtableToIndex({ ...base, summary: 'v2（补充）' });
  const idx = indexStore.load();
  const docs = idx.docs.filter((d) => d.type === 'roundtable');
  assert.equal(docs.length, 1); // 覆盖而非新增
  assert.match(docs[0].text, /v2/);
  assert.equal(docs[0].meta.executions, 2);
});

test('sinkRoundtableToIndex：HESI_PLAN_RAG_SINK=0 时关闭（不写索引）', () => {
  process.env.HESI_PLAN_RAG_SINK = '0';
  try {
    const r = sinkRoundtableToIndex({ question: '关闭测试', summary: 's', transcript: '【第1轮 · AI 助手】\na' });
    assert.equal(r, null);
    const idx = indexStore.load();
    assert.equal(idx.docs.filter((d) => d.type === 'roundtable').length, 0);
  } finally {
    delete process.env.HESI_PLAN_RAG_SINK;
  }
});

test('recallRoundtables：recallAll 合并召回 roundtable + plan（供 /history/search）', () => {
  sinkRoundtableToIndex({ question: '合并召回测试', summary: '结论 X', transcript: '【第1轮 · AI 助手】\n讨论' });
  // 也回流一个 plan，验证 recallAll 两类都返回
  const sinkPlanToIndex = sinkModule.sinkPlanToIndex;
  sinkPlanToIndex({ id: 'm1', objective: '合并召回测试 目标', steps: [{ id: 's1', goal: 'g', action: 'a' }] }, { status: 'done' });

  const all = recallAll('合并召回测试');
  assert.ok(all.length >= 2);
  const types = new Set(all.map((h) => h.ref.split(':')[0]));
  assert.ok(types.has('roundtable'));
  assert.ok(types.has('plan'));
});

test('sinkRoundtableToIndex：缺 summary/transcript 时不写（数据不完整）', () => {
  const r = sinkRoundtableToIndex({ question: '不完整' });
  assert.equal(r, null);
  const idx = indexStore.load();
  assert.equal(idx.docs.length, 0);
});
