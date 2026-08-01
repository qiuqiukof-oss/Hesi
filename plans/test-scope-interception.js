#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/test-scope-interception.js
// ------------------------------------------------------------
// Regression for the scope / forbidden pre-flight interceptor in
// routes/ai-tools/run-plan.js:
//   checkInterception(plan, step, cwd)
//   _pathTokens(text)
//
// Guards that system paths are not falsely flagged as out-of-scope:
//   - /tmp, /var/tmp, os.tmpdir()
//   - /usr/bin/git, /bin/sh, /usr/local/bin/node, /opt/homebrew/bin/*, etc.
// while real project-relative paths and forbidden patterns remain guarded.
// ============================================================
'use strict';

const assert = require('node:assert');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`  ✓ ${name}`);
}

const { _pathTokens, checkInterception } = require('../routes/ai-tools/run-plan');

check('module loads and exports interception helpers', () => {
  assert.strictEqual(typeof _pathTokens, 'function');
  assert.strictEqual(typeof checkInterception, 'function');
});

check('/usr/bin/git is not treated as a scoped filesystem path', () => {
  assert.deepStrictEqual(_pathTokens('/usr/bin/git init'), []);
  assert.deepStrictEqual(_pathTokens('/usr/bin/git clone https://example.com/repo'), []);
});

check('/bin and /sbin commands are exempt', () => {
  assert.deepStrictEqual(_pathTokens('/bin/sh -c echo hi'), []);
  assert.deepStrictEqual(_pathTokens('/sbin/mount /dev/sda1'), []);
});

check('/usr/local/bin and /opt variants are exempt', () => {
  assert.deepStrictEqual(_pathTokens('/usr/local/bin/node app.js'), []);
  assert.deepStrictEqual(_pathTokens('/opt/bin/foo arg'), []);
  assert.deepStrictEqual(_pathTokens('/opt/local/bin/bar arg'), []);
  assert.deepStrictEqual(_pathTokens('/opt/homebrew/bin/git status'), []);
  assert.deepStrictEqual(_pathTokens('/snap/bin/code .'), []);
});

check('/tmp and /var/tmp remain exempt after the temp-dir fix', () => {
  assert.deepStrictEqual(_pathTokens('mkdir /tmp/test'), []);
  assert.deepStrictEqual(_pathTokens('cat /var/tmp/data'), []);
});

check('/etc/passwd is not exempt (real system file outside command dirs)', () => {
  const tokens = _pathTokens('cat /etc/passwd');
  assert.ok(tokens.includes('/etc/passwd'), `expected /etc/passwd in ${JSON.stringify(tokens)}`);
});

check('project-relative paths are still extracted for scope checks', () => {
  const tokens = _pathTokens('cat /src/components/App.vue');
  assert.ok(tokens.includes('/src/components/App.vue'));
});

check('checkInterception does not block /usr/bin/git when scope_paths is set', () => {
  const plan = {
    scope_paths: ['H:/Hesi'],
    forbidden: [],
  };
  const step = {
    id: 's1',
    action: '/usr/bin/git status',
    verify: null,
  };
  const result = checkInterception(plan, step, 'H:/Hesi');
  assert.strictEqual(result, null, `unexpected interception: ${JSON.stringify(result)}`);
});

check('checkInterception still blocks a path outside scope_paths', () => {
  const plan = {
    scope_paths: ['H:/Hesi'],
    forbidden: [],
  };
  const step = {
    id: 's1',
    action: 'cat /etc/passwd',
    verify: null,
  };
  const result = checkInterception(plan, step, 'H:/Hesi');
  assert.ok(result && result.reason && result.reason.includes('路径越界'), `expected block reason, got ${JSON.stringify(result)}`);
});

check('forbidden blacklist still takes precedence', () => {
  const plan = {
    scope_paths: [],
    forbidden: ['rm -rf'],
  };
  const step = {
    id: 's1',
    action: 'rm -rf /Hesi/build',
    verify: null,
  };
  const result = checkInterception(plan, step, 'H:/Hesi');
  assert.ok(result && result.reason && result.reason.includes('forbidden'), `expected forbidden reason, got ${JSON.stringify(result)}`);
});

console.log(`\n✅ test-scope-interception.js: ${checks} checks passed`);
