/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P2.3: verify the no-restricted-syntax guard against child_process.exec(<non-literal>)
// actually fires, and that safe forms (execFile, literal-string exec, regex .exec)
// do NOT. Uses the ESLint Node API with the project's own flat config.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ESLint } = require('eslint');

// filePath must match the backend config block (routes/**/*.js) so the rule applies.
const filePath = path.join(__dirname, '..', 'routes', '__lint_fixture__.js');

function eslint() {
  return new ESLint({ cwd: path.join(__dirname, '..') });
}

async function lint(code) {
  const results = await eslint().lintText(code, { filePath });
  return results[0].messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

test('exec(variable) is flagged', async () => {
  const msgs = await lint("const { exec } = require('child_process');\nfunction r(cmd){ exec(cmd, () => {}); }\n");
  assert.ok(msgs.length >= 1, 'expected no-restricted-syntax error for exec(cmd)');
});

test('exec(`...${x}...`) template is flagged', async () => {
  const msgs = await lint("const { exec } = require('child_process');\nfunction r(x){ exec(`ls ${x}`, () => {}); }\n");
  assert.ok(msgs.length >= 1, 'expected error for exec(template)');
});

test("exec('literal string') is allowed", async () => {
  const msgs = await lint("const { exec } = require('child_process');\nexec('ls -la', () => {});\n");
  assert.strictEqual(msgs.length, 0);
});

test('execFile(base, argsArray) is allowed', async () => {
  const msgs = await lint("const { execFile } = require('child_process');\nfunction r(a){ execFile('ls', a, () => {}); }\n");
  assert.strictEqual(msgs.length, 0);
});

test('regex.exec(str) is not affected', async () => {
  const msgs = await lint("const RE = /x/g;\nfunction r(s){ let m; while ((m = RE.exec(s))) {} return m; }\n");
  assert.strictEqual(msgs.length, 0);
});
