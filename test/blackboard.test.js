/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 黑版每次操作动态读 HESI_BLACKBOARD_DIR，故 require 后再设 env 也生效。
// 注意：write/patch 经 withLock 返回 Promise，必须 await。
const { BlackboardConflictError, read, patch, write, reset } = require('../lib/blackboard');

let dir;
let seq = 0;
function nextId() {
  return `p${process.pid}_${Date.now()}_${++seq}`;
}

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
  process.env.HESI_BLACKBOARD_DIR = dir;
});

test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HESI_BLACKBOARD_DIR;
});

test('① 字段级合并只改单键（不覆盖其他键）', async () => {
  const id = nextId();
  await write(id, { status: 'coding', files: { 'a.js': { hash: 'a1', status: 'done' } }, roles: { x: 'coder' } });
  const after = await patch(id, { status: 'reviewing' });
  assert.strictEqual(after.status, 'reviewing');
  assert.strictEqual(after.files['a.js'].hash, 'a1'); // 未传，保留
  assert.strictEqual(after.files['a.js'].status, 'done');
  assert.strictEqual(after.roles.x, 'coder');
  assert.strictEqual(after.version, 1);
});

test('② files 字段级合并保留未传子键（hash 不被丢）', async () => {
  const id = nextId();
  await write(id, { files: { 'a.js': { hash: 'a1b2', status: 'in_progress' } } });
  const after = await patch(id, { files: { 'a.js': { status: 'done' } } }); // 只改 status
  assert.strictEqual(after.files['a.js'].hash, 'a1b2', 'hash 应保留');
  assert.strictEqual(after.files['a.js'].status, 'done');
});

test('③ version 乐观锁冲突抛 BlackboardConflictError', async () => {
  const id = nextId();
  await write(id, { status: 'coding' }); // version 0
  await patch(id, { status: 'x' }); // → version 1
  await assert.rejects(
    () => patch(id, { status: 'y' }, { expectedVersion: 0 }),
    BlackboardConflictError
  );
  // 正确版本可成功
  const ok = await patch(id, { status: 'z' }, { expectedVersion: 1 });
  assert.strictEqual(ok.status, 'z');
  assert.strictEqual(ok.version, 2);
});

test('④ per-file checksum 乐观锁冲突抛错', async () => {
  const id = nextId();
  await write(id, { files: { 'a.js': { hash: 'a1', status: 'done' } } });
  // 携带旧 hash 的并发写应冲突
  await assert.rejects(
    () => patch(id, { files: { 'a.js': { status: 'failed' } } }, { expectedChecksums: { 'a.js': 'OLD' } }),
    BlackboardConflictError
  );
  // 携带正确 hash 可成功
  const ok = await patch(id, { files: { 'a.js': { status: 'failed' } } }, { expectedChecksums: { 'a.js': 'a1' } });
  assert.strictEqual(ok.files['a.js'].status, 'failed');
});

test('⑤ tasks 按 id 合并（存在则更新，不存在则追加）', async () => {
  const id = nextId();
  await write(id, { tasks: [{ id: 't1', status: 'done' }] });
  const after = await patch(id, { tasks: [{ id: 't1', assignee: 'opencode' }, { id: 't2', status: 'pending' }] });
  assert.strictEqual(after.tasks.length, 2);
  const t1 = after.tasks.find((t) => t.id === 't1');
  assert.strictEqual(t1.status, 'done'); // 保留
  assert.strictEqual(t1.assignee, 'opencode'); // 合并
  assert.strictEqual(after.tasks.find((t) => t.id === 't2').status, 'pending');
});

test('⑥ logs 追加而非替换', async () => {
  const id = nextId();
  await write(id, { logs: [{ ts: 1, actor: 'system', msg: 'init' }] });
  const after = await patch(id, { logs: [{ ts: 2, actor: 'a', msg: 'step1' }] });
  assert.strictEqual(after.logs.length, 2);
  assert.strictEqual(after.logs[1].msg, 'step1');
});

test('⑦ roles 字段级合并保留其他角色', async () => {
  const id = nextId();
  await write(id, { roles: { opencode: 'coder', codex: 'reviewer' } });
  const after = await patch(id, { roles: { opencode: 'debugger' } });
  assert.strictEqual(after.roles.opencode, 'debugger');
  assert.strictEqual(after.roles.codex, 'reviewer');
});

test('⑧ read 返回 null 当文件不存在；patch 经 write 自动初始化', async () => {
  const id = nextId();
  assert.strictEqual(read(id), null);
  const after = await patch(id, { status: 'coding' }); // 文件不存在 → 以默认板初始化
  assert.strictEqual(after.status, 'coding');
  assert.strictEqual(after.version, 1);
  assert.ok(read(id));
});

test('⑨ reset 删除文件', async () => {
  const id = nextId();
  await write(id, { status: 'coding' });
  assert.ok(read(id));
  reset(id);
  assert.strictEqual(read(id), null);
});

test('⑩ 可选 git 分支：git 不可用/被忽略时静默降级，主流程成功', async () => {
  const id = nextId();
  process.env.HESI_BLACKBOARD_GIT = '1';
  try {
    const after = await patch(id, { status: 'coding' }, { expectedVersion: 0 });
    assert.strictEqual(after.status, 'coding');
    assert.strictEqual(after.version, 1);
  } finally {
    delete process.env.HESI_BLACKBOARD_GIT;
  }
});
