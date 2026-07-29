/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Tests for HESI_COMPACT_THRESHOLD override on lib/memory/config.js.
//   - unset -> default 60000
//   - valid positive int -> that value (office/coding heavy-context raise)
//   - invalid / non-positive -> falls back to 60000
// Pure config read; reloads the module fresh each case via require-cache reset.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function loadConfigFresh(envVal) {
  if (envVal === undefined) delete process.env.HESI_COMPACT_THRESHOLD;
  else process.env.HESI_COMPACT_THRESHOLD = envVal;
  const key = require.resolve('../lib/memory/config');
  delete require.cache[key];
  return require('../lib/memory/config');
}

test('COMPACT_THRESHOLD defaults to 60000 when unset', () => {
  const cfg = loadConfigFresh(undefined);
  assert.strictEqual(cfg.COMPACT_THRESHOLD, 60000);
});

test('COMPACT_THRESHOLD honors a valid override (heavy-context raise)', () => {
  const cfg = loadConfigFresh('150000');
  assert.strictEqual(cfg.COMPACT_THRESHOLD, 150000);
});

test('COMPACT_THRESHOLD ignores invalid / non-positive values', () => {
  assert.strictEqual(loadConfigFresh('abc').COMPACT_THRESHOLD, 60000);
  assert.strictEqual(loadConfigFresh('0').COMPACT_THRESHOLD, 60000);
  assert.strictEqual(loadConfigFresh('-5').COMPACT_THRESHOLD, 60000);
  // cleanup so later tests see a clean env
  delete process.env.HESI_COMPACT_THRESHOLD;
  delete require.cache[require.resolve('../lib/memory/config')];
});
