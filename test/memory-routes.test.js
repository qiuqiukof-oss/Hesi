/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// HTTP-layer tests for /api/memory. Spins up a real Express app on a random
// port and exercises the routes end-to-end. Isolated to a temp dir.
//
// NOTE: Express is a runtime dependency that may be absent in a dependency-free
// checkout. When `express` cannot be resolved we skip these tests instead of
// failing — they run automatically once `npm install` is present.
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

// Isolate the subsystem to an ephemeral dir BEFORE requiring it.
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-mem-rt-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes('lib' + path.sep + 'memory') || k.endsWith(path.join('lib', 'memory', 'config.js'))) {
    delete require.cache[k];
  }
}
const MemoryStore = require('../lib/memory');
const { createMemoryRouter } = require('../routes/memory');

function startServer() {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/api/memory', createMemoryRouter());
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

test('memory routes: create / list / recall / rename / delete', { skip: !hasExpress }, async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api/memory`;
  try {
    // seed a session via the facade (chat route wires this in M4)
    const id = 's_rt_' + Date.now().toString(36);
    MemoryStore.ensure(id, { title: '测试记忆路由', model: 'm', provider: 'p' });
    await MemoryStore.append(id, [
      { id: 'r1', role: 'user', content: '帮我记住：用户喜欢红色主题。' },
    ]);

    // GET /sessions
    const listRes = await fetch(`${base}/sessions`);
    assert.strictEqual(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(listBody.sessions.find((s) => s.id === id), 'session should appear in list');

    // POST /recall
    const recallRes = await fetch(`${base}/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '用户 主题' }),
    });
    assert.strictEqual(recallRes.status, 200);
    const recallBody = await recallRes.json();
    assert.ok(recallBody.block && recallBody.block.content.includes('测试记忆路由'), 'recall should surface the title');

    // PATCH /sessions/:id rename
    const renameRes = await fetch(`${base}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '改名后的会话' }),
    });
    assert.strictEqual(renameRes.status, 200);
    const got = MemoryStore.get(id);
    assert.strictEqual(got.title, '改名后的会话');

    // DELETE /sessions/:id
    const delRes = await fetch(`${base}/sessions/${id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(MemoryStore.get(id), null);

    // health
    const h = await fetch(`${base}/health`);
    assert.strictEqual((await h.json()).ok, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('memory routes: recall rejects missing query', { skip: !hasExpress }, async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/api/memory`;
  try {
    const res = await fetch(`${base}/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
