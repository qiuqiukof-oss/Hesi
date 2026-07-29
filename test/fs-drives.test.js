/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// HTTP-layer tests for /api/fs/dirs drive-selection behavior (盘符缺失 bug fix).
// Spins a real Express app on a random port. Skips when express is absent.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const http = require('http');

let express;
try { express = require('express'); } catch { express = null; }
const hasExpress = !!express;

const { createRouter } = require('../routes/fs');

function startServer() {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/api', createRouter());
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

const IS_WIN = process.platform === 'win32';

test('fs/dirs: ::drives sentinel returns a drive list', { skip: !hasExpress }, async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const res = await fetch(`${base}/fs/dirs?dir=${encodeURIComponent('::drives')}`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.isDrives, true, 'isDrives flag set');
    assert.strictEqual(body.dir, '::drives');
    assert.strictEqual(body.parent, '', 'drive view has no parent');
    assert.ok(Array.isArray(body.dirs), 'dirs is an array');
    if (IS_WIN) {
      // At least the system drive should be present, shaped as { name, path }.
      assert.ok(body.dirs.length >= 1, 'at least one drive on Windows');
      for (const d of body.dirs) {
        assert.match(d.path, /^[A-Za-z]:\\$/, 'drive path like C:\\');
        assert.strictEqual(d.name, d.path);
      }
    } else {
      assert.strictEqual(body.dirs.length, 0, 'no drives on non-Windows');
    }
  } finally {
    server.close();
  }
});

test('fs/dirs: Windows drive root points parent at ::drives', { skip: !hasExpress || !IS_WIN }, async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    // Use the drive of the temp dir (always exists) as the root under test.
    const root = path.parse(os.tmpdir()).root; // e.g. "C:\\"
    const res = await fetch(`${base}/fs/dirs?dir=${encodeURIComponent(root)}`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.parent, '::drives', 'drive root parent is the drives sentinel');
    assert.ok(Array.isArray(body.dirs), 'lists subdirs of the root');
  } finally {
    server.close();
  }
});

test('fs/dirs: a normal subdir still returns its real parent', { skip: !hasExpress }, async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const target = os.tmpdir();
    const res = await fetch(`${base}/fs/dirs?dir=${encodeURIComponent(target)}`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.parent, path.dirname(path.resolve(target)), 'parent is real dirname');
    assert.notStrictEqual(body.parent, '::drives');
  } finally {
    server.close();
  }
});
