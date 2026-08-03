/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Regression tests for routes/tools.js safeResolve path-traversal fix (P2 #2, v0.7.9).
// 修复前 `resolved.startsWith(ws)` 缺 path.sep 收尾，`H:\HesiX\...` 这类兄弟目录
// 会因前缀命中而越界（read/write/list 共用 safeResolve）。这里通过临时工作区验证修复后的行为。
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const { createRouter } = require('../routes/tools');
const { setWorkspace } = require('../lib/workspace');

let tmpWs = null;
let tmpSibling = null;
let server = null;
let baseUrl = '';

function listen(router) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use('/api', router);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
    server.on('error', reject);
  });
}

function close() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
}

beforeEach(async () => {
  tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-ws-'));
  tmpSibling = tmpWs + 'X'; // 兄弟目录：前缀与工作区相同但多一个字符（H:\Hesi vs H:\HesiX 场景）
  fs.mkdirSync(tmpSibling, { recursive: true });
  fs.writeFileSync(path.join(tmpSibling, 'secret.txt'), 'sibling-secret');
  setWorkspace(tmpWs);
  await listen(createRouter());
});

afterEach(async () => {
  await close();
  try { fs.rmSync(tmpWs, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(tmpSibling, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('P2: absolute path into sibling dir is rejected (prefix-collision traversal)', async () => {
  const evilPath = path.join(tmpSibling, 'secret.txt');
  const res = await fetch(`${baseUrl}/tools/read-file?path=${encodeURIComponent(evilPath)}`);
  assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
  const body = await res.json();
  assert.match(body.error, /denied/i);
});

test('P2: relative traversal ..\\sibling\\file is rejected', async () => {
  const rel = path.join('..', path.basename(tmpSibling), 'secret.txt');
  const res = await fetch(`${baseUrl}/tools/read-file?path=${encodeURIComponent(rel)}`);
  assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
  const body = await res.json();
  assert.match(body.error, /denied/i);
});

test('P2: files inside workspace still readable', async () => {
  fs.writeFileSync(path.join(tmpWs, 'ok.txt'), 'hello');
  const res = await fetch(`${baseUrl}/tools/read-file?path=${encodeURIComponent('ok.txt')}`);
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.strictEqual(body.content, 'hello');
});
