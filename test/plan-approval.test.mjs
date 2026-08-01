/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerApproval, resolveApproval, cancelApproval, hasPendingApproval,
} from '../lib/plan-approval.js';

function fakeEmit() {
  const calls = [];
  const emit = (type, data) => { calls.push({ type, data }); };
  return { calls, emit };
}

test('registerApproval → resolveApproval（人工通过）', async () => {
  const e = fakeEmit();
  const p = registerApproval('e1', { goal: '写文件' }, 5000, e.emit);
  assert.equal(hasPendingApproval('e1'), true);
  // 前端收到 await-approval
  assert.ok(e.calls.some((c) => c.type === 'await-approval' && c.data && c.data.step.goal === '写文件'));
  // 人工通过
  const hit = resolveApproval('e1', true);
  assert.equal(hit, true);
  const result = await p;
  assert.equal(result, true);
  assert.equal(hasPendingApproval('e1'), false);
  // 前端收到 approval-resolved
  assert.ok(e.calls.some((c) => c.type === 'approval-resolved' && c.data.approved === true));
});

test('registerApproval → resolveApproval（人工驳回）', async () => {
  const e = fakeEmit();
  const p = registerApproval('e2', { goal: 'rm' }, 5000, e.emit);
  const hit = resolveApproval('e2', false);
  assert.equal(hit, true);
  const result = await p;
  assert.equal(result, false);
  assert.ok(e.calls.some((c) => c.type === 'approval-resolved' && c.data.approved === false));
});

test('registerApproval → 超时视为驳回', async () => {
  const e = fakeEmit();
  // 极小超时：10ms
  const p = registerApproval('e3', { goal: 'build' }, 10, e.emit);
  const result = await p;
  assert.equal(result, false, '超时应视为驳回');
  assert.equal(hasPendingApproval('e3'), false);
  // 前端收到超时 approval-resolved
  const resolved = e.calls.find((c) => c.type === 'approval-resolved');
  assert.ok(resolved, '应发送 approval-resolved');
  assert.equal(resolved.data.timedOut, true);
});

test('cancelApproval 清理但不决议', async () => {
  const e = fakeEmit();
  registerApproval('e4', { goal: 'plain' }, 5000, e.emit);
  assert.equal(hasPendingApproval('e4'), true);
  const hit = cancelApproval('e4');
  assert.equal(hit, true);
  assert.equal(hasPendingApproval('e4'), false);
});

test('resolveApproval 不存在的 execId → false', () => {
  assert.equal(resolveApproval('notfound', true), false);
});
