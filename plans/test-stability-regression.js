#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/test-stability-regression.js
// ------------------------------------------------------------
// Regression: exercise the bounded-memory + throttling primitives under load to
// confirm they hold their invariants (no unbounded growth, correct throttling).
// These are the pieces a long-running local session leans on for stability:
//   • RingBuffer   — output buffer must stay <= maxSize under heavy append.
//   • rate-limiter — fixed window must throttle a steady non-loopback trickle,
//                    while loopback stays friction-free.
// Prints a short report; exits non-zero on any invariant violation.
// ============================================================
'use strict';

const assert = require('node:assert');
const { RingBuffer } = require('../ring-buffer');
const { createRateLimiter } = require('../rate-limiter');

// ── 1. RingBuffer bounded-memory under heavy append ──
(function ringBufferLoad() {
  const MAX = 4096;
  const rb = new RingBuffer(MAX);
  for (let i = 0; i < 100000; i++) {
    rb.append(`chunk-${i}-${'x'.repeat(20)}\n`);
    // Invariant: physical buffer never exceeds maxSize.
    assert.ok(rb.full().length <= MAX, `RingBuffer exceeded maxSize at iter ${i}`);
  }
  assert.strictEqual(rb.overflowed, true);
  assert.strictEqual(rb.length, MAX);
  // Newest content must still be present (tail is what a reader sees).
  assert.ok(rb.full().includes('chunk-99999'), 'newest chunk missing after load');
  console.log(`RingBuffer: 100k appends stayed within ${MAX} chars (final len=${rb.full().length})`);
})();

// ── 2. rate-limiter fixed-window throttling under a steady trickle ──
(function rateLimiterTrickle() {
  const max = 30;
  const limiter = createRateLimiter({ windowMs: 60000, max, name: 'stability-plan' });
  const mkRes = () => {
    const res = { code: 0 };
    res.status = (c) => { res.code = c; return res; };
    res.json = () => res;
    return res;
  };
  const drive = (ip) => {
    let allowed = 0, blocked = 0;
    for (let i = 0; i < max * 3; i++) {
      let ok = false;
      limiter({ ip, headers: {}, connection: {} }, mkRes(), () => { ok = true; });
      if (ok) allowed++; else blocked++;
    }
    return { allowed, blocked };
  };

  const remote = drive('203.0.113.42');
  assert.strictEqual(remote.allowed, max, `remote allowed ${remote.allowed}, expected ${max}`);
  assert.strictEqual(remote.blocked, max * 2, `remote blocked ${remote.blocked}, expected ${max * 2}`);

  const loopback = drive('127.0.0.1');
  assert.strictEqual(loopback.blocked, 0, 'loopback must never be throttled');

  console.log(`rate-limiter: remote trickle throttled after ${max} (blocked ${remote.blocked}); loopback unthrottled`);
})();

console.log('stability regression: all invariants held');
