/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// 重试时间线「失败原因」摘要：必须挑出真正有信息量的错误行，
// 而不是把 Node 错误输出尾部的 `}` / `Node.js v22.x` 这类噪声呈给用户。
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pickErrorLines, summarizeAttemptReason } = require('../routes/ai-tools/run-plan');

// 真实抓取自 `node ./__no_such_file__.js` 的 stderr 形态
const NODE_MISSING_MODULE = `node:internal/modules/cjs/loader:1215
  throw err;
  ^

Error: Cannot find module 'H:\\Hesi\\__hesi_no_such_file__.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1212:15)
    at Module._load (node:internal/modules/cjs/loader:1043:27)
    at Function.executeUserEntryPoint (node:internal/modules/run_main:164:12) {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v22.22.2`;

test('pickErrorLines: 抓住 Cannot find module，而不是尾部噪声', () => {
  const out = pickErrorLines(NODE_MISSING_MODULE);
  assert.match(out, /Cannot find module/, '必须包含真正的错误信息');
  assert.doesNotMatch(out, /^Node\.js v/, '不应以 Node 版本行开头');
  assert.doesNotMatch(out, /\bat Module\./, '不应包含堆栈帧');
});

test('pickErrorLines: 过滤孤立括号与 Node 版本尾行', () => {
  const out = pickErrorLines('}\n\nNode.js v22.22.2');
  assert.strictEqual(out, '', '全是噪声时应返回空串，而不是把噪声当原因');
});

test('pickErrorLines: 无错误特征时回退到尾部有效行', () => {
  const out = pickErrorLines('step one\nstep two\nstep three\nstep four');
  assert.strictEqual(out, 'step two step three step four');
});

test('pickErrorLines: 识别 ENOENT / Permission denied / fatal:', () => {
  assert.match(pickErrorLines('noise\nENOENT: no such file or directory\n}'), /ENOENT/);
  assert.match(pickErrorLines('x\nPermission denied\nNode.js v22.0.0'), /Permission denied/);
  assert.match(pickErrorLines('a\nfatal: not a git repository\n^'), /fatal: not a git repository/);
});

test('pickErrorLines: 空输入安全', () => {
  assert.strictEqual(pickErrorLines(''), '');
  assert.strictEqual(pickErrorLines(null), '');
  assert.strictEqual(pickErrorLines(undefined), '');
});

test('summarizeAttemptReason: 组合步骤信息与有效错误行', () => {
  const reason = summarizeAttemptReason({
    results: [
      { id: 's0', goal: '先跑通', status: 'done', output: 'ok' },
      { id: 's1', goal: '运行缺失脚本', status: 'error', output: NODE_MISSING_MODULE },
    ],
  });
  assert.match(reason, /步骤 s1（运行缺失脚本）error/);
  assert.match(reason, /Cannot find module/);
});

test('summarizeAttemptReason: 无失败步骤时给出兜底说明', () => {
  const reason = summarizeAttemptReason({ results: [{ id: 's1', goal: 'g', status: 'done' }] });
  assert.match(reason, /未识别到明确失败步骤/);
});
