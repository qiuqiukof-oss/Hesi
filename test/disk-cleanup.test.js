/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { removeDirIfStale } = require('../lib/disk-cleanup');

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hesi-clean-${name}-`));
}
function setMtime(dir, ageMs) {
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(dir, t, t);
}

test('removeDirIfStale removes an old directory', () => {
  const d = tmpDir('old');
  setMtime(d, 3600 * 1000); // 1h old
  const removed = removeDirIfStale(d, { staleGraceMs: 60000 });
  assert.equal(removed, true);
  assert.equal(fs.existsSync(d), false);
});

test('removeDirIfStale keeps a recently-written directory (likely in use)', () => {
  const d = tmpDir('fresh');
  setMtime(d, 1000); // 1s old
  const removed = removeDirIfStale(d, { staleGraceMs: 60000 });
  assert.equal(removed, false);
  assert.equal(fs.existsSync(d), true);
  fs.rmSync(d, { recursive: true, force: true });
});

test('removeDirIfStale returns false for a missing directory', () => {
  const d = path.join(os.tmpdir(), `hesi-missing-${Date.now()}`);
  assert.equal(removeDirIfStale(d), false);
});
