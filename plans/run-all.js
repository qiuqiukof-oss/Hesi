#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/run-all.js — regression harness runner
// ------------------------------------------------------------
// Discovers every sibling plans/*.js (except this runner) and executes it in a
// child process, aggregating pass/fail. These "plans" are scenario-level smoke
// checks that exercise realistic multi-component behavior — a lighter, human-
// readable complement to the assertion-based unit tests under test/.
//
//   node plans/run-all.js            # run all
//   node plans/run-all.js clean      # run only plans whose name contains "clean"
//
// Exits non-zero if any plan fails, so it can gate a release.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const SELF = path.basename(__filename);
const filter = process.argv[2] || '';

const scripts = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.js') && f !== SELF)
  .filter(f => !filter || f.includes(filter))
  .sort();

if (scripts.length === 0) {
  console.log(`[plans] no scripts to run${filter ? ` (filter: "${filter}")` : ''}`);
  process.exit(0);
}

console.log(`[plans] running ${scripts.length} regression plan(s)\n`);

const results = [];
for (const script of scripts) {
  const full = path.join(DIR, script);
  process.stdout.write(`──▶ ${script}\n`);
  const r = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ script, ok, code: r.status });
  process.stdout.write(ok ? `    ✓ ${script} passed\n\n` : `    ✗ ${script} FAILED (exit ${r.status})\n\n`);
}

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;
console.log('─'.repeat(48));
console.log(`[plans] ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
