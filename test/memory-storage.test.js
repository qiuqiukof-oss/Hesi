/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for the memory subsystem foundation: config, schema, storage.
// Goal: prove atomic writes, corruption recovery, idempotent ids and the
// master enable switch before any higher-level module depends on them.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = require('../lib/memory/config');
const schema = require('../lib/memory/schema');
const storage = require('../lib/memory/storage');

function fixture() {
  const base = path.join(__dirname, '..', '.tmp-memtest');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'mem-'));
}

// ── config ──────────────────────────────────────────────────────────────────
test('config: ROOT points at data/memory', () => {
  assert.ok(config.ROOT.endsWith(path.join('data', 'memory')));
  assert.ok(config.SESSIONS_DIR.endsWith(path.join('data', 'memory', 'sessions')));
});

test('config: MEMORY_ENABLED defaults to true', () => {
  assert.strictEqual(config.MEMORY_ENABLED, true);
});

test('config: MEMORY_ENABLED=false when HESI_MEMORY_ENABLED=0', () => {
  const Module = require('module');
  const orig = process.env.HESI_MEMORY_ENABLED;
  process.env.HESI_MEMORY_ENABLED = '0';
  delete require.cache[require.resolve('../lib/memory/config')];
  const c = require('../lib/memory/config');
  assert.strictEqual(c.MEMORY_ENABLED, false);
  if (orig === undefined) delete process.env.HESI_MEMORY_ENABLED; else process.env.HESI_MEMORY_ENABLED = orig;
  delete require.cache[require.resolve('../lib/memory/config')];
});

// ── schema ────────────────────────────────────────────────────────────────────
test('schema: estimateTokens ≈ len/2', () => {
  assert.strictEqual(schema.estimateTokens(''), 0);
  assert.strictEqual(schema.estimateTokens('abcd'), 2);
  assert.strictEqual(schema.estimateTokens('abcde'), 3); // ceil(5/2)=3
});

test('schema: createMessageId is unique and prefixed', () => {
  const a = schema.createMessageId();
  const b = schema.createMessageId();
  assert.ok(a.startsWith('m_'));
  assert.notStrictEqual(a, b);
});

test('schema: normalizeMessage preserves existing id/role and derives tokens', () => {
  const m = schema.normalizeMessage({ id: 'm_x', role: 'assistant', content: 'hello world' });
  assert.strictEqual(m.id, 'm_x');
  assert.strictEqual(m.role, 'assistant');
  assert.strictEqual(m.tokens, 6); // 11 chars → ceil(11/2)=6
});

test('schema: normalizeMessage coerces invalid role and generates id', () => {
  const m = schema.normalizeMessage({ role: 'wizard', content: 'x' });
  assert.strictEqual(m.role, 'user');
  assert.ok(m.id.startsWith('m_'));
});

test('schema: titleFromFirstMessage truncates to 20 chars', () => {
  const t = schema.titleFromFirstMessage([{ role: 'user', content: '你好世界这是一个很长的标题用来测试截断逻辑' }]);
  assert.strictEqual(t.length, 21); // 20 chars + '…'
  assert.ok(t.endsWith('…'));
  assert.ok(t.startsWith('你好世界'));
  assert.strictEqual(schema.titleFromFirstMessage([]), '新会话');
});

// ── storage ───────────────────────────────────────────────────────────────────
test('storage: writeJSON + readJSON round-trip', () => {
  const dir = fixture();
  const target = path.join(dir, 'a.json');
  storage.writeJSON(target, { hello: 'world', n: 42 });
  assert.deepStrictEqual(storage.readJSON(target, null), { hello: 'world', n: 42 });
});

test('storage: readJSON returns fallback for missing file', () => {
  const dir = fixture();
  assert.strictEqual(storage.readJSON(path.join(dir, 'nope.json'), 'DFLT'), 'DFLT');
});

test('storage: readJSON falls back to .bak on corruption', () => {
  const dir = fixture();
  const target = path.join(dir, 'c.json');
  storage.writeJSON(target, { good: 'first' });   // first write: no .bak yet
  storage.writeJSON(target, { good: 'second' });  // second write: copies first good copy -> .bak
  fs.writeFileSync(target, '{ this is : not json'); // corrupt current
  assert.deepStrictEqual(storage.readJSON(target, null), { good: 'first' });
});

test('storage: concurrent atomic writes never corrupt the final file', async () => {
  const dir = fixture();
  const target = path.join(dir, 'concurrent.json');
  const N = 25;
  await Promise.all(Array.from({ length: N }, (_, i) =>
    storage.writeJSON(target, { i, payload: 'z'.repeat(400) })
  ));
  const final = storage.readJSON(target, null);
  assert.ok(final && typeof final.i === 'number', 'final file must parse as valid JSON');
});

test('storage: withLock serializes read-modify-write', async () => {
  const target = path.join(fixture(), 'lock.json');
  storage.writeJSON(target, { count: 0 });
  const bump = () => storage.withLock('k1', () => {
    const cur = storage.readJSON(target, { count: 0 });
    cur.count += 1;
    storage.writeJSON(target, cur);
  });
  await Promise.all([bump(), bump(), bump(), bump(), bump()]);
  assert.strictEqual(storage.readJSON(target, null).count, 5);
});

test('storage: listJSON ignores .bak and sorts', () => {
  const dir = fixture();
  storage.writeJSON(path.join(dir, 'b.json'), { x: 1 });
  storage.writeJSON(path.join(dir, 'a.json'), { x: 2 });
  storage.writeJSON(path.join(dir, 'a.json.bak'), { x: 9 }); // should be excluded
  const names = storage.listJSON(dir).map((p) => path.basename(p));
  assert.deepStrictEqual(names, ['a.json', 'b.json']);
});

test('storage: removeFile deletes', () => {
  const dir = fixture();
  const target = path.join(dir, 'r.json');
  storage.writeJSON(target, { x: 1 });
  storage.removeFile(target);
  assert.strictEqual(storage.exists(target), false);
});
