/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for ring-buffer.js — the shared bounded output buffer used by the
// MCP session manager and the WS agent log. The eviction / slice contract is
// what downstream incremental readers rely on, so it is pinned down here.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { RingBuffer } = require('../ring-buffer');

test('append + full: accumulates below the limit', () => {
  const rb = new RingBuffer(100);
  rb.append('abc');
  rb.append('def');
  assert.strictEqual(rb.full(), 'abcdef');
  assert.strictEqual(rb.join(), 'abcdef'); // alias
  assert.strictEqual(rb.overflowed, false);
  assert.strictEqual(rb.length, 6);
});

test('append: returns actual appended length', () => {
  const rb = new RingBuffer(100);
  assert.deepStrictEqual(rb.append(''), { appendedLen: 0 });
  assert.deepStrictEqual(rb.append('hello'), { appendedLen: 5 });
});

test('overflow: truncates from the head keeping the newest maxSize chars', () => {
  const rb = new RingBuffer(5);
  rb.append('12345');
  rb.append('67890'); // total 10 → keep last 5
  assert.strictEqual(rb.full(), '67890');
  assert.strictEqual(rb.overflowed, true);
  assert.strictEqual(rb.length, 5); // logical length pins to maxSize after overflow
});

test('tail: returns the last N newline-delimited lines', () => {
  const rb = new RingBuffer(1000);
  rb.append('line1\nline2\nline3\nline4');
  assert.strictEqual(rb.tail(2), 'line3\nline4');
  assert.strictEqual(rb.tail(0), '');
});

test('slice: returns tail from a logical position when not overflowed', () => {
  const rb = new RingBuffer(1000);
  rb.append('0123456789');
  assert.strictEqual(rb.slice(4), '456789');
  assert.strictEqual(rb.slice(10), '');   // at end
  assert.strictEqual(rb.slice(99), '');   // past end
});

test('slice: after overflow, positions index into the retained buffer', () => {
  // NOTE: slice(from) treats `from` as an index into the *current* retained
  // buffer, not a cumulative global offset. Because append() trims _buf to
  // maxSize immediately, _buf.length === maxSize after any overflow, so the
  // internal "evicted" estimate is 0 and the null-eviction branch is not
  // reached in normal operation. This test pins the observable behavior.
  const rb = new RingBuffer(5);
  rb.append('abcde');
  rb.append('fghij'); // buffer now holds the newest 5 chars: 'fghij'
  assert.strictEqual(rb.overflowed, true);
  assert.strictEqual(rb.slice(0), 'fghij');
  assert.strictEqual(rb.slice(2), 'hij');
  assert.strictEqual(rb.slice(5), '');
});

test('clear: resets content and overflow flag', () => {
  const rb = new RingBuffer(5);
  rb.append('overflowing-content');
  assert.strictEqual(rb.overflowed, true);
  rb.clear();
  assert.strictEqual(rb.full(), '');
  assert.strictEqual(rb.overflowed, false);
  assert.strictEqual(rb.length, 0);
});
