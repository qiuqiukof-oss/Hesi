/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Phase 2：文件写类副作用还原。
// - recordSideEffect 把原文件快照挂到当前轮检查点 sideEffects（同轮只记首次，超阈值标记 skipped）
// - getRollbackPreview 返回将还原/删除/跳过的文件列表
// - rollbackTo 按「每个文件取 >=目标轮的最早一轮快照」规则还原（新建→删除，存在→写回 before）
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-fx-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(path.join('lib', 'memory'))) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');

test('restore existing file + earliest-round-wins on rollback', async () => {
  const id = 's_fx_' + Date.now().toString(36);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-fx-ws-'));
  const fpath = path.join(ws, 'note.txt');

  fs.writeFileSync(fpath, 'A'); // 初始态
  MemoryStore.ensure(id, { title: 'fx' });

  // Round 1: checkpoint(1) 代表「第1轮开始前」，此时 f='A'
  MemoryStore.checkpoint(id);
  await MemoryStore.recordSideEffect(id, fpath, 'A', false);
  fs.writeFileSync(fpath, 'B'); // 第1轮把 f 改成 B

  // Round 2: checkpoint(2) 代表「第2轮开始前」，此时 f='B'
  MemoryStore.checkpoint(id);
  await MemoryStore.recordSideEffect(id, fpath, 'B', false);
  fs.writeFileSync(fpath, 'C'); // 第2轮把 f 改成 C

  // 同轮二次写入同一文件：只保留第一次（轮开始态）
  await MemoryStore.recordSideEffect(id, fpath, 'SHOULD-NOT-WIN', false);

  // 预览回滚到 #1
  const preview = MemoryStore.getRollbackPreview(id, 1);
  assert.strictEqual(preview.length, 1, '应只列出 note.txt');
  assert.strictEqual(preview[0].path, fpath);
  assert.strictEqual(preview[0].action, 'restore', '应还原');

  // 回滚到 #1：f 应回到 'A'（最早一轮 K>=1 的快照）
  MemoryStore.rollbackTo(id, 1);
  assert.strictEqual(fs.readFileSync(fpath, 'utf8'), 'A', '文件应还原为轮开始态 A');

  // 未来态检查点被丢弃
  const after = MemoryStore.listCheckpoints(id);
  assert.ok(after.every((c) => c.seq <= 1), 'seq>1 应丢弃');
});

test('delete newly-created file on rollback', async () => {
  const id = 's_fx2_' + Date.now().toString(36);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-fx-ws2-'));
  const created = path.join(ws, 'created.txt');

  MemoryStore.ensure(id, { title: 'fx2' });
  MemoryStore.checkpoint(id); // ckpt1
  // 第1轮新建文件（之前不存在 → isNew）
  await MemoryStore.recordSideEffect(id, created, '', true);
  fs.writeFileSync(created, 'NEW');

  const preview = MemoryStore.getRollbackPreview(id, 1);
  assert.strictEqual(preview[0].action, 'delete', '新建文件应标记为删除');

  MemoryStore.rollbackTo(id, 1);
  assert.ok(!fs.existsSync(created), '回滚后新建文件应被删除');
});

test('oversized file marked unrestorable (skipped on restore)', async () => {
  const id = 's_fx3_' + Date.now().toString(36);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-fx-ws3-'));
  const big = path.join(ws, 'big.txt');

  fs.writeFileSync(big, 'small');
  MemoryStore.ensure(id, { title: 'fx3' });
  MemoryStore.checkpoint(id);
  // 超过 256KB 的 before → 标记 skipped（best-effort 边界，不还原）
  const huge = 'x'.repeat(300 * 1024);
  await MemoryStore.recordSideEffect(id, big, huge, false);

  const preview = MemoryStore.getRollbackPreview(id, 1);
  assert.strictEqual(preview[0].action, 'unrestorable', '超大文件应标记跳过');

  fs.writeFileSync(big, 'changed-by-ai');
  MemoryStore.rollbackTo(id, 1); // 不应还原超大文件
  assert.strictEqual(fs.readFileSync(big, 'utf8'), 'changed-by-ai', '超大文件回滚不还原');
});
