/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  NOOP_EMIT,
  STEP_OUTPUT_LIMIT,
  createWsEmitter,
  emitAsBroadcastFn,
  normalizeStepEvent,
} = require('../routes/ai-tools/plan-emitter.js');

test('createWsEmitter：type 自动加 plan: 前缀并带上 execId', () => {
  const got = [];
  const emit = createWsEmitter((d) => got.push(d), 'exec-1');
  emit('step', { id: 's1', status: 'done' });
  assert.deepEqual(got, [{ type: 'plan:step', execId: 'exec-1', id: 's1', status: 'done' }]);
});

test('createWsEmitter：无 broadcastFn → 返回 NOOP，不抛异常', () => {
  const emit = createWsEmitter(null, 'exec-1');
  assert.equal(emit, NOOP_EMIT);
  assert.doesNotThrow(() => emit('step', { id: 's1' }));
});

test('createWsEmitter：投递方抛异常不影响执行主流程', () => {
  const emit = createWsEmitter(() => { throw new Error('ws 已断开'); }, 'exec-1');
  assert.doesNotThrow(() => emit('step', {}));
});

test('createWsEmitter：data 省略时仍发出合法事件', () => {
  const got = [];
  const emit = createWsEmitter((d) => got.push(d), 'exec-2');
  emit('discussion-cancelled');
  assert.deepEqual(got, [{ type: 'plan:discussion-cancelled', execId: 'exec-2' }]);
});

test('normalizeStepEvent：超长 output 被截断并标记原始长度', () => {
  const long = 'x'.repeat(STEP_OUTPUT_LIMIT + 500);
  const ev = normalizeStepEvent({ id: 's1', status: 'done', output: long });
  assert.equal(ev.outputTruncated, true);
  assert.equal(ev.outputFullLength, STEP_OUTPUT_LIMIT + 500);
  assert.ok(ev.output.length < long.length, '截断后应短于原文');
  assert.ok(ev.output.startsWith('x'.repeat(100)), '应保留开头内容');
});

test('normalizeStepEvent：正常长度 output 原样保留、不加截断标记', () => {
  const ev = normalizeStepEvent({ id: 's1', status: 'done', output: 'hello' });
  assert.equal(ev.output, 'hello');
  assert.equal(ev.outputTruncated, undefined);
});

test('normalizeStepEvent：不修改传入对象（避免污染 runPlan 的 results）', () => {
  const src = { id: 's1', output: 'y'.repeat(STEP_OUTPUT_LIMIT + 10) };
  const out = normalizeStepEvent(src);
  assert.equal(src.output.length, STEP_OUTPUT_LIMIT + 10, '原对象 output 不应被截断');
  assert.notEqual(out.output.length, src.output.length);
});

test('normalizeStepEvent：非对象输入安全返回空对象', () => {
  assert.deepEqual(normalizeStepEvent(null), {});
  assert.deepEqual(normalizeStepEvent(undefined), {});
});

test('emitAsBroadcastFn：{type,...} 对象形态桥接到 emit(type,data)', () => {
  const got = [];
  const bf = emitAsBroadcastFn((type, data) => got.push([type, data]));
  bf({ type: 'tool_call', name: 'read_file' });
  assert.deepEqual(got, [['chat-tool_call', { name: 'read_file' }]]);
});

test('emitAsBroadcastFn：已带 plan: 前缀的事件不重复包装', () => {
  const got = [];
  const bf = emitAsBroadcastFn((type, data) => got.push([type, data]));
  bf({ type: 'plan:step', id: 's1' });
  assert.deepEqual(got, [['step', { id: 's1' }]]);
});

test('emitAsBroadcastFn：无 type 或非对象输入被忽略', () => {
  const got = [];
  const bf = emitAsBroadcastFn((type, data) => got.push([type, data]));
  bf(null);
  bf({ noType: 1 });
  bf('string');
  assert.equal(got.length, 0);
});

test('emitAsBroadcastFn：emit 为 NOOP 时返回空实现，不抛异常', () => {
  const bf = emitAsBroadcastFn(NOOP_EMIT);
  assert.doesNotThrow(() => bf({ type: 'x' }));
});
