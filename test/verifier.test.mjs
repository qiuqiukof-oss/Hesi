import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitize,
  parseQualityThreshold,
  extractNumber,
  compareNumbers,
  verifyCheck,
  verifyItem,
  deltaList,
  verdict,
} from '../lib/verifier.js';

test('盲审：输入含 Executor 自述字段 → 剥离 + 拒绝（strict 默认）', () => {
  const r = sanitize({
    plan: { id: 'p1' },
    artifacts: ['src/app.js'],
    checkOutputs: { c1: 'ok' },
    executorSummary: '我完成了所有工作', // 污染字段
  });
  assert.ok(r.error.includes('executorSummary')); // strict=true 拒绝
  assert.ok(r.stripped.includes('executorSummary'));
  assert.ok(r.input.executorSummary === undefined); // 已剥离
});

test('盲审：strict=false 仅剥离不拒绝', () => {
  const r = sanitize({ plan: { id: 'p1' }, selfReport: 'x' }, { strict: false });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.stripped, ['selfReport']);
  assert.deepEqual(Object.keys(r.input), ['plan']);
});

test('盲审：未知字段也剥离', () => {
  const r = sanitize({ plan: { id: 'p1' }, aiNarrative: 'long story' });
  assert.ok(r.stripped.includes('aiNarrative'));
});

test('functional DoD：expect 命中 → pass', () => {
  const check = { type: 'functional', id: 'c1', expect: 'token' };
  const r = verifyCheck(check, { outputs: new Map([['c1', 'login ok token=abc']]) });
  assert.equal(r.pass, true);
  assert.ok(r.evidence.includes('token'));
});

test('functional DoD：expect 未命中 → fail + reason', () => {
  const check = { type: 'functional', id: 'c1', expect: 'token' };
  const r = verifyCheck(check, { outputs: new Map([['c1', 'login failed']]) });
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'expect 未命中');
});

test('semantic DoD：有 evidence 且 yes 一致 → pass', () => {
  const check = { type: 'semantic', id: 's1', question: '登录态过期返回 401?', yes: true, expected: true, evidence: 'tests/auth.spec.ts:42' };
  const r = verifyCheck(check, { outputs: new Map() });
  assert.equal(r.pass, true);
  assert.equal(r.evidence, 'tests/auth.spec.ts:42');
});

test('semantic DoD：缺 evidence → fail（不依赖自述）', () => {
  const check = { type: 'semantic', id: 's1', question: 'token 未落 localStorage?', yes: false, evidence: null };
  const r = verifyCheck(check, { outputs: new Map() });
  assert.equal(r.pass, false);
  assert.equal(r.reason, '缺少 evidence 路径');
});

test('semantic DoD：yes 与 expected 不一致 → fail', () => {
  const check = { type: 'semantic', id: 's1', yes: false, expected: true, evidence: 'a.ts' };
  const r = verifyCheck(check, { outputs: new Map() });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('不一致'));
});

test('quality DoD：coverage >= 80 提取数值比较', () => {
  const check = { type: 'quality', id: 'q1', pattern: /coverage[:\s]*(\d+(?:\.\d+)?)%?/, thresholdExpr: '>= 80' };
  const ok = verifyCheck(check, { outputs: new Map([['q1', 'Tests: 42, coverage: 85%']]) });
  assert.equal(ok.pass, true);
  const bad = verifyCheck(check, { outputs: new Map([['q1', 'Tests: 42, coverage: 72%']]) });
  assert.equal(bad.pass, false);
  assert.ok(bad.reason.includes('72'));
});

test('quality DoD：无法提取数值 → fail', () => {
  const check = { type: 'quality', id: 'q1', pattern: /coverage[:\s]*(\d+)/, thresholdExpr: '>= 80' };
  const r = verifyCheck(check, { outputs: new Map([['q1', 'no numbers here']]) });
  assert.equal(r.pass, false);
  assert.equal(r.reason, '无法从输出提取数值');
});

test('parseQualityThreshold / extractNumber / compareNumbers 单元', () => {
  assert.deepEqual(parseQualityThreshold('>= 80'), { op: '>=', threshold: 80 });
  assert.deepEqual(parseQualityThreshold('lint < 5'), { op: '<', threshold: 5 });
  assert.equal(parseQualityThreshold('随便'), null);
  assert.equal(extractNumber('coverage: 85%', /coverage[:\s]*(\d+(?:\.\d+)?)%?/), 85);
  assert.equal(compareNumbers(85, { op: '>=', threshold: 80 }), true);
  assert.equal(compareNumbers(79, { op: '>=', threshold: 80 }), false);
});

test('未知 DoD 类型 → 保守判失败', () => {
  const r = verifyCheck({ type: 'mystery', id: 'x' }, { outputs: new Map() });
  assert.equal(r.pass, false);
});

test('verifyItem：全过 → item.pass', () => {
  const item = {
    id: 'login-api',
    dod: [
      { type: 'functional', id: 'c1', expect: '200' },
      { type: 'semantic', id: 's1', yes: true, expected: true, evidence: 'tests/auth.spec.ts:42' },
    ],
  };
  const r = verifyItem(item, { outputs: new Map([['c1', 'HTTP 200 ok']]) });
  assert.equal(r.pass, true);
  assert.equal(r.checks.length, 2);
});

test('verifyItem：有失败 → item.pass=false + delta 缺失项', () => {
  const item = {
    id: 'login-api',
    dod: [
      { type: 'functional', id: 'c1', expect: '200' },
      { type: 'semantic', id: 's1', yes: false, expected: true, evidence: null },
    ],
  };
  const r = verifyItem(item, { outputs: new Map([['c1', 'HTTP 500']]) });
  assert.equal(r.pass, false);
  const delta = deltaList([r]);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].itemId, 'login-api');
  assert.ok(delta[0].missing.length >= 2); // functional + semantic 都失败
  // 缺失项可机读：type/check/reason
  for (const m of delta[0].missing) {
    assert.ok(m.type && m.check && m.reason);
  }
});

test('verdict：全过 → PASS', () => {
  const item = { id: 'a', dod: [{ type: 'functional', id: 'c1', expect: 'ok' }] };
  const r = verifyItem(item, { outputs: new Map([['c1', 'ok']]) });
  const v = verdict([r]);
  assert.equal(v.v, 'PASS');
  assert.equal(v.passCount, 1);
  assert.equal(v.totalCount, 1);
});

test('verdict：部分过 → PARTIAL（partialOk 默认）', () => {
  const item = { id: 'a', dod: [{ type: 'functional', id: 'c1', expect: 'ok' }, { type: 'functional', id: 'c2', expect: 'x' }] };
  const r = verifyItem(item, { outputs: new Map([['c1', 'ok'], ['c2', 'no']]) });
  const v = verdict([r]);
  assert.equal(v.v, 'PARTIAL');
  assert.equal(v.passCount, 1);
  assert.equal(v.totalCount, 2);
});

test('verdict：全缺 → FAIL', () => {
  const item = { id: 'a', dod: [{ type: 'functional', id: 'c1', expect: 'ok' }] };
  const r = verifyItem(item, { outputs: new Map([['c1', 'no']]) });
  const v = verdict([r]);
  assert.equal(v.v, 'FAIL');
  assert.equal(v.delta.length, 1);
});
