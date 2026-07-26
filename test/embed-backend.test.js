// @ts-check
// v0.3.1 B1 — embedding backend mock 测试（不依赖真实 API）
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let _origFetch;
let _origEnvEmbed;
let _origEnvKey;

before(() => {
  _origFetch = global.fetch;
  _origEnvEmbed = process.env.HESI_MEMORY_EMBED;
  _origEnvKey = process.env.OPENAI_API_KEY;
});

after(() => {
  global.fetch = _origFetch;
  if (_origEnvEmbed === undefined) delete process.env.HESI_MEMORY_EMBED;
  else process.env.HESI_MEMORY_EMBED = _origEnvEmbed;
  if (_origEnvKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = _origEnvKey;
});

function freshEmbed() {
  // 每次测试重置 require cache，使 embed.js 重新读取 env
  for (const k of Object.keys(require.cache)) {
    if (k.includes('lib' + path.sep + 'memory' + path.sep + 'embed')) delete require.cache[k];
    if (k.includes('lib' + path.sep + 'memory' + path.sep + 'config')) delete require.cache[k];
  }
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-mock';
  return require('../lib/memory/embed');
}

test('embed: disabled by default (no HESI_MEMORY_EMBED)', () => {
  delete process.env.HESI_MEMORY_EMBED;
  // 不设 OPENAI_API_KEY——clean require 后应为关闭
  const e = freshEmbed();
  assert.strictEqual(e.enabled(), false, 'disabled when env unset');
});

test('embed: with env=1 + mock fetch returns vector', async () => {
  process.env.HESI_MEMORY_EMBED = '1';
  process.env.OPENAI_API_KEY = 'sk-test';
  const mockVec = new Array(1536).fill(0).map((_, i) => i * 0.001);
  global.fetch = async (url, opts) => {
    assert.ok(String(url).includes('embeddings') || String(url).includes('api.openai.com'), 'calls embeddings endpoint');
    assert.ok(opts.headers.Authorization?.includes('Bearer'), 'has auth header');
    return {
      ok: true,
      json: async () => ({ data: [{ embedding: mockVec }] }),
    };
  };
  const e = freshEmbed();
  assert.strictEqual(e.enabled(), true, 'enabled with env=1');
  const vec = await e.embed('test text');
  assert.ok(Array.isArray(vec), 'returns vector array');
  assert.strictEqual(vec.length, 1536, 'vector has correct dims');
  assert.strictEqual(vec[0], 0, 'first element matches mock');
  assert.strictEqual(vec[1], 0.001, 'second element matches mock');
});

test('embed: endpoint error degrades to null', async () => {
  process.env.HESI_MEMORY_EMBED = '1';
  process.env.OPENAI_API_KEY = 'sk-test';
  global.fetch = async () => ({ ok: false, status: 500 });
  const e = freshEmbed();
  const vec = await e.embed('will fail');
  assert.strictEqual(vec, null, 'returns null on API error');
});

test('embed: cosine similarity', () => {
  const e = freshEmbed();
  assert.strictEqual(e.cosine([1, 0], [1, 0]), 1, 'identical = 1');
  assert.strictEqual(e.cosine([1, 0], [0, 1]), 0, 'orthogonal = 0');
  assert.strictEqual(e.cosine([1, 0], [-1, 0]), -1, 'opposite = -1');
  assert.ok(e.cosine([1, 2, 3], [2, 3, 4]) > 0.95, 'similar vectors > 0.95');
  assert.strictEqual(e.cosine([1, 0], [0]), 0, 'mismatched length = 0');
  assert.strictEqual(e.cosine([], []), 0, 'zero vectors = 0');
});

test('embed: empty input returns null', async () => {
  process.env.HESI_MEMORY_EMBED = '1';
  process.env.OPENAI_API_KEY = 'sk-test';
  const e = freshEmbed();
  assert.strictEqual(await e.embed(''), null, 'empty string → null');
  assert.strictEqual(await e.embed('  '), null, 'whitespace only → null');
});
