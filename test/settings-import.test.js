// ── /api/settings/import 白名单清洗回归（2026-08-04 审查反馈）──
// 原实现只校验 data.registry 存在，脏 JSON 可覆盖 CLI 注册表任意字段。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// 直接测 settings.js 导出的清洗函数（路由通过 createRouter 挂载）
const { sanitizeRegistry } = require('../routes/settings');

test('sanitizeRegistry: 合法导出数据清洗后保留（往返一致）', () => {
  const data = {
    version: 1,
    clis: [{ id: 'node', name: 'Node.js', path: 'C:/node/node.exe', type: 'runtime', category: 'dev', discovered: 'manual', version: '22.0.0', addedAt: '2026-01-01', args: ['--version'], init: 'none' }],
    folders: ['C:/projects'],
  };
  const out = sanitizeRegistry(data);
  assert.strictEqual(out.version, 1);
  assert.strictEqual(out.clis.length, 1);
  assert.deepStrictEqual(out.clis[0], data.clis[0]);
  assert.deepStrictEqual(out.folders, ['C:/projects']);
});

test('sanitizeRegistry: 脏字段被剔除（白名单）', () => {
  const data = {
    version: 1,
    clis: [{ id: 'x', name: 'X', path: '/bin/x', evil: 'nope', init: 'ok' }],
  };
  const out = sanitizeRegistry(data);
  assert.strictEqual(out.clis[0].evil, undefined);
  assert.strictEqual(out.clis[0].init, 'ok');
});

test('sanitizeRegistry: 顶层非对象 → 拒绝', () => {
  assert.strictEqual(sanitizeRegistry(null), null);
  assert.strictEqual(sanitizeRegistry('str'), null);
  assert.strictEqual(sanitizeRegistry([]), null);
  assert.ok(sanitizeRegistry({})); // 空对象 → 合法空注册表
});

test('sanitizeRegistry: 超长字段剔除 / 超量条目拒绝', () => {
  const data = { version: 1, clis: [{ id: 'x'.repeat(99999), name: 'n' }] };
  const out = sanitizeRegistry(data);
  assert.strictEqual(out.clis[0].id, undefined); // 超长字段剔除
  // 超量条目 → null（拒绝整个 import）
  const huge = { version: 1, clis: Array.from({ length: 10001 }, (_, i) => ({ id: 'c' + i, name: 'n' })) };
  assert.strictEqual(sanitizeRegistry(huge), null);
});

test('sanitizeRegistry: 非对象 cli 条目被过滤', () => {
  const data = { version: 1, clis: ['bad', 42, null, { id: 'good', name: 'ok' }] };
  const out = sanitizeRegistry(data);
  assert.strictEqual(out.clis.length, 1);
  assert.strictEqual(out.clis[0].id, 'good');
});

test('sanitizeRegistry: folders 类型/长度过滤', () => {
  const data = { version: 1, clis: [], folders: ['C:/ok', 42, 'x'.repeat(9999)] };
  const out = sanitizeRegistry(data);
  assert.deepStrictEqual(out.folders, ['C:/ok']);
});
