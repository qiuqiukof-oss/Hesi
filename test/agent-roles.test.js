// @ts-check
const test = require('node:test');
const assert = require('node:assert');
const { getRole, resolveRecoveryRole, rolePrefix } = require('../lib/agent-roles');

test('getRole 返回正确片段与工具引导；未知角色 null', () => {
  const c = getRole('coder');
  assert.ok(c.systemFragment.includes('代码实现者'));
  assert.deepStrictEqual(c.toolGuidance, ['read_file', 'write_file', 'exec_terminal']);
  assert.strictEqual(getRole('unknown'), null);
});

test('resolveRecoveryRole 映射正确（默认 debugger）', () => {
  assert.strictEqual(resolveRecoveryRole('coder'), 'debugger');
  assert.strictEqual(resolveRecoveryRole('reviewer'), 'debugger');
  assert.strictEqual(resolveRecoveryRole('tester'), 'debugger');
  assert.strictEqual(resolveRecoveryRole('deployer'), 'debugger');
  assert.strictEqual(resolveRecoveryRole('debugger'), 'debugger');
  assert.strictEqual(resolveRecoveryRole('unknown'), 'debugger');
});

test('rolePrefix 含 systemFragment；无/未知角色返回空数组', () => {
  const p = rolePrefix('coder');
  assert.ok(Array.isArray(p) && p.length === 2);
  assert.ok(p[0].startsWith('[角色]'));
  assert.ok(p[0].includes('代码实现者'));
  assert.ok(p[1].includes('工具引导'));
  assert.deepStrictEqual(rolePrefix(undefined), []);
  assert.deepStrictEqual(rolePrefix('unknown'), []);
});
