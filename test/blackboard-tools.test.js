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

const { ToolRegistry } = require('../routes/ai-tools/registry');
const blackboardTool = require('../routes/ai-tools/builtin/blackboard');

let dir;
function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bbt-'));
}

test.beforeEach(() => {
  dir = tmpDir();
  process.env.HESI_BLACKBOARD_DIR = dir;
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HESI_BLACKBOARD_DIR;
});

test('① 三个黑板工具成功注册到 registry', () => {
  const reg = new ToolRegistry();
  blackboardTool.register(reg);
  assert.ok(reg.has('blackboard_read'));
  assert.ok(reg.has('blackboard_patch'));
  assert.ok(reg.has('blackboard_write'));
});

test('② 经 registry 调用 write→patch→read 行为正确', async () => {
  const reg = new ToolRegistry();
  blackboardTool.register(reg);
  const id = 'projX';
  const w = JSON.parse(await reg.execute('blackboard_write', { projectId: id, state: { status: 'coding', files: { 'a.js': { hash: 'a1', status: 'done' } } } }));
  assert.strictEqual(w.status, 'coding');
  assert.strictEqual(w.version, 0);

  const p = JSON.parse(await reg.execute('blackboard_patch', { projectId: id, patch: { status: 'reviewing' } }));
  assert.strictEqual(p.status, 'reviewing');
  assert.strictEqual(p.version, 1);
  assert.strictEqual(p.files['a.js'].hash, 'a1', 'patch 后未传字段应保留');

  const r = await reg.execute('blackboard_read', { projectId: id });
  assert.ok(r.includes('reviewing'));
});

test('③ 乐观锁冲突经 registry 返回 BlackboardConflict 提示（AI 可读懂并重试）', async () => {
  const reg = new ToolRegistry();
  blackboardTool.register(reg);
  const id = 'projY';
  await reg.execute('blackboard_write', { projectId: id, state: { status: 'coding' } });
  await reg.execute('blackboard_patch', { projectId: id, patch: { status: 'x' } }); // → version 1
  const out = await reg.execute('blackboard_patch', { projectId: id, patch: { status: 'y' }, expectedVersion: 0 });
  assert.ok(out.includes('BlackboardConflict'), '冲突应返回可读的 BlackboardConflict 提示，实际: ' + out);
});
