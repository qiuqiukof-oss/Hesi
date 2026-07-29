/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// S8 后端路由测试：GET /api/blackboard/:projectId（只读 + ?since=）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const blackboard = require('../lib/blackboard');
const { createRouter } = require('../routes/blackboard');

let dir;
let seq = 0;
function nextId() { return `br${process.pid}_${Date.now()}_${++seq}`; }

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-route-'));
  process.env.HESI_BLACKBOARD_DIR = dir;
});
test.afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HESI_BLACKBOARD_DIR;
});

function makeServer() {
  const app = express();
  app.use('/api/blackboard', createRouter());
  return http.createServer(app);
}
function get(server, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: pathname, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('① 已存在的黑板：返回完整状态', async () => {
  const id = nextId();
  await blackboard.write(id, { status: 'coding', tasks: [{ id: 't1', status: 'done' }] });
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const { status, json } = await get(server, `/api/blackboard/${id}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.exists, true);
    assert.strictEqual(json.state.status, 'coding');
    assert.strictEqual(json.state.tasks[0].id, 't1');
  } finally {
    server.close();
  }
});

test('② 不存在的黑板：exists=false', async () => {
  const id = nextId();
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const { status, json } = await get(server, `/api/blackboard/${id}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.exists, false);
    assert.strictEqual(json.state, null);
  } finally {
    server.close();
  }
});

test('③ ?since= 版本未变：unchanged=true', async () => {
  const id = nextId();
  const board = await blackboard.write(id, { status: 'coding' });
  const version = board.version;
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const { status, json } = await get(server, `/api/blackboard/${id}?since=${version}`);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.unchanged, true, '版本相同应返回 unchanged');
    assert.strictEqual(json.version, version);
  } finally {
    server.close();
  }
});

test('④ ?since= 版本已变：返回新状态', async () => {
  const id = nextId();
  const board = await blackboard.write(id, { status: 'coding' });
  const v1 = board.version;
  await blackboard.patch(id, { status: 'reviewing' }); // → v2
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const { status, json } = await get(server, `/api/blackboard/${id}?since=${v1}`);
    assert.strictEqual(status, 200);
    assert.notStrictEqual(json.unchanged, true);
    assert.strictEqual(json.state.status, 'reviewing');
    assert.strictEqual(json.state.version, v1 + 1);
  } finally {
    server.close();
  }
});
