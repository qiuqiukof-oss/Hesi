// @ts-check
// P0.6 S1：GET /api/chat/context-usage 端点测试。
// 隔离 HESI_MEMORY_DIR 到临时目录后再 require chat router（同 memory-routes 范式）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let express;
try { express = require('express'); } catch { express = null; }
const hasExpress = !!express;

// Isolate memory subsystem BEFORE requiring it (config reads env at load).
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-ctx-usage-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes('lib' + path.sep + 'memory')) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');
const { createRouter } = require('../routes/chat/index');

function startServer() {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/api', createRouter({ broadcastFn: () => {} }));
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function get(server, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('context-usage：缺 sessionId → 400；未知 session → 404', { skip: !hasExpress }, async () => {
  const server = await startServer();
  try {
    const r1 = await get(server, '/api/chat/context-usage');
    assert.strictEqual(r1.status, 400);
    const r2 = await get(server, '/api/chat/context-usage?sessionId=no-such-session');
    assert.strictEqual(r2.status, 404);
  } finally {
    server.close();
  }
});

test('context-usage：返回占用/窗口/pct/阈值/来源（model-map 命中）', { skip: !hasExpress }, async () => {
  const sid = `ctx-${Date.now()}-1`;
  MemoryStore.ensure(sid, {});
  await MemoryStore.setContextEstimate(sid, 12300);
  const server = await startServer();
  try {
    const { status, json } = await get(server, `/api/chat/context-usage?sessionId=${sid}&model=qwen2.5-3b`);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.contextEstimate, 12300);
    assert.strictEqual(json.windowTokens, 32000, 'qwen2.5-3b 应命中映射表 32k');
    assert.strictEqual(json.pct, 38.4);
    assert.strictEqual(json.source, 'model-map');
    assert.ok(json.compactThreshold <= 16000, '阈值应 ≤ 窗口×0.5');
    assert.ok(json.maxOutputTokens <= 32768);
  } finally {
    server.close();
  }
});

test('context-usage：未知模型走 fallback 窗口 200k', { skip: !hasExpress }, async () => {
  const sid = `ctx-${Date.now()}-2`;
  MemoryStore.ensure(sid, {});
  await MemoryStore.setContextEstimate(sid, 50000);
  const server = await startServer();
  try {
    const { json } = await get(server, `/api/chat/context-usage?sessionId=${sid}&model=some-unknown-cloud-model`);
    assert.strictEqual(json.windowTokens, 200000);
    assert.strictEqual(json.source, 'fallback');
    assert.strictEqual(json.pct, 25);
  } finally {
    server.close();
  }
});
