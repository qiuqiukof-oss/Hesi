#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/test-discuss.js
// ------------------------------------------------------------
// Regression for the AI discussion coordinator (routes/chat/discuss.js).
//
// This module is a PUBLIC integration entry point consumed by the chat
// router (and by the plan executor's checkpoint derivation). A refactor must
// not silently break its export shape, so this script guards the contract:
//   1. module loads without throwing (its deps resolve)
//   2. exports an object
//   3. exports exactly the documented public surface { runDiscussion, runRoundtable }
//   4. `runDiscussion` is a function
//   5. `runDiscussion` is async (AsyncFunction)
//   6. `runDiscussion` arity === 2 (res, options)
//   7. `runRoundtable` is a function / async (pure reuse entry, single arg)
//   8. re-require returns the same cached export object
//
// It intentionally does NOT run a live discussion — that needs an LLM, the
// agent pool, and an SSE stream. Behavioural coverage belongs in integration
// tests; this guards only the module's public surface.
// ============================================================
'use strict';

const assert = require('node:assert');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`  ✓ ${name}`);
}

const mod = require('../routes/chat/discuss');

check('module loads without throwing', () => { assert.ok(mod); });
check('exports an object', () => { assert.strictEqual(typeof mod, 'object'); });
check('exports exactly { runDiscussion, runRoundtable, normalizeTranscript }', () => {
  assert.deepStrictEqual(Object.keys(mod).sort(), ['normalizeTranscript', 'runDiscussion', 'runRoundtable']);
});
check('runDiscussion is a function', () => {
  assert.strictEqual(typeof mod.runDiscussion, 'function');
});
check('runDiscussion is async', () => {
  assert.strictEqual(mod.runDiscussion.constructor.name, 'AsyncFunction');
});
check('runDiscussion arity === 2', () => {
  assert.strictEqual(mod.runDiscussion.length, 2);
});
check('runRoundtable is a function', () => {
  assert.strictEqual(typeof mod.runRoundtable, 'function');
});
check('runRoundtable is async', () => {
  assert.strictEqual(mod.runRoundtable.constructor.name, 'AsyncFunction');
});
check('re-require returns same export', () => {
  const again = require('../routes/chat/discuss');
  assert.strictEqual(again, mod);
});

console.log(`\n✅ test-discuss.js: ${checks} checks passed`);
