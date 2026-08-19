/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for rate-limiter.js — the fixed-window limiter guarding HTTP routes.
// The key regression pinned here is that it is a *fixed* window (a steady low
// trickle still gets blocked once the window fills) and that loopback traffic is
// exempt for a personal local tool.
'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert');
const { createRateLimiter, getAllRateLimiterStats } = require('../rate-limiter');

/** Minimal Express req/res doubles. */
function mkReq(ip) {
  return { ip, headers: {}, connection: {} };
}
function mkRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}
/** Drive one request through the middleware; returns 'next' | 'blocked'. */
function hit(limiter, ip) {
  const res = mkRes();
  let nexted = false;
  limiter(mkReq(ip), res, () => { nexted = true; });
  return nexted ? 'next' : 'blocked';
}

test('loopback IPs are exempt from limiting', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, name: 'lb-test' });
  // Far exceed the ceiling from loopback — all should pass.
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(hit(limiter, '127.0.0.1'), 'next');
  }
  assert.strictEqual(hit(limiter, '::1'), 'next');
  assert.strictEqual(hit(limiter, '::ffff:127.0.0.1'), 'next');
});

test('non-loopback IP: allows up to max, then blocks', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, name: 'ceil-test' });
  const ip = '203.0.113.7';
  assert.strictEqual(hit(limiter, ip), 'next');   // 1
  assert.strictEqual(hit(limiter, ip), 'next');   // 2
  assert.strictEqual(hit(limiter, ip), 'next');   // 3
  assert.strictEqual(hit(limiter, ip), 'blocked'); // 4 → over ceiling
  assert.strictEqual(hit(limiter, ip), 'blocked'); // still blocked within window
});

test('fixed window: counter resets only after windowMs elapses', () => {
  mock.timers.enable({ apis: ['Date'] });
  try {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2, name: 'window-test' });
    const ip = '198.51.100.5';
    assert.strictEqual(hit(limiter, ip), 'next');    // 1
    assert.strictEqual(hit(limiter, ip), 'next');    // 2
    assert.strictEqual(hit(limiter, ip), 'blocked'); // 3 within window
    mock.timers.tick(1500);                          // advance past the window
    assert.strictEqual(hit(limiter, ip), 'next');    // fresh window
  } finally {
    mock.timers.reset();
  }
});

test('reset(ip) clears a single bucket; getStats() reports state', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 1, name: 'reset-test' });
  const ip = '192.0.2.9';
  assert.strictEqual(hit(limiter, ip), 'next');
  assert.strictEqual(hit(limiter, ip), 'blocked');
  limiter.reset(ip);
  assert.strictEqual(hit(limiter, ip), 'next'); // bucket cleared
  const stats = limiter.getStats();
  assert.strictEqual(stats.name, 'reset-test');
  assert.strictEqual(stats.max, 1);
  assert.ok(stats.totalRequests >= 1);
});

test('getAllRateLimiterStats includes registered limiters', () => {
  createRateLimiter({ windowMs: 60000, max: 5, name: 'registry-probe' });
  const all = getAllRateLimiterStats();
  assert.ok(all.some(s => s.name === 'registry-probe'));
});
