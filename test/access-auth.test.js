/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for lib/access-auth.js — focuses on the pure, env-independent
// helpers and the local-origin guard (Phase 3 anti drive-by defense). The
// token-enforcement paths capture process.env at module load, so they are not
// unit-tested here; the origin-guard core reads env lazily and IS tested.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isLoopbackAddr,
  isLoopbackOrigin,
  shouldBlockCrossOrigin,
  localOriginGuard,
} = require('../lib/access-auth');

test('isLoopbackAddr: recognizes loopback forms', () => {
  assert.strictEqual(isLoopbackAddr('127.0.0.1'), true);
  assert.strictEqual(isLoopbackAddr('::1'), true);
  assert.strictEqual(isLoopbackAddr('::ffff:127.0.0.1'), true);
  assert.strictEqual(isLoopbackAddr('localhost'), true);
  assert.strictEqual(isLoopbackAddr('10.0.0.5'), false);
  assert.strictEqual(isLoopbackAddr('203.0.113.1'), false);
});

test('isLoopbackOrigin: matches loopback URLs with/without port', () => {
  assert.strictEqual(isLoopbackOrigin('http://127.0.0.1:4264'), true);
  assert.strictEqual(isLoopbackOrigin('http://localhost'), true);
  assert.strictEqual(isLoopbackOrigin('https://[::1]:8080'), true);
  assert.strictEqual(isLoopbackOrigin('http://evil.example'), false);
  assert.strictEqual(isLoopbackOrigin(''), false);
  assert.strictEqual(isLoopbackOrigin(undefined), false);
});

test('shouldBlockCrossOrigin: reads (GET/HEAD) are never blocked', () => {
  assert.strictEqual(shouldBlockCrossOrigin('GET', 'http://evil.example', []), false);
  assert.strictEqual(shouldBlockCrossOrigin('HEAD', 'http://evil.example', []), false);
  assert.strictEqual(shouldBlockCrossOrigin('OPTIONS', 'http://evil.example', []), false);
});

test('shouldBlockCrossOrigin: mutating request from a cross-site origin is blocked', () => {
  assert.strictEqual(shouldBlockCrossOrigin('POST', 'http://evil.example', []), true);
  assert.strictEqual(shouldBlockCrossOrigin('DELETE', 'http://attacker.test', []), true);
  assert.strictEqual(shouldBlockCrossOrigin('put', 'http://evil.example', []), true); // case-insensitive
});

test('shouldBlockCrossOrigin: no Origin / loopback / allowlisted → allowed', () => {
  assert.strictEqual(shouldBlockCrossOrigin('POST', '', []), false);          // curl / native
  assert.strictEqual(shouldBlockCrossOrigin('POST', undefined, []), false);
  assert.strictEqual(shouldBlockCrossOrigin('POST', 'http://127.0.0.1:4264', []), false); // local UI
  assert.strictEqual(
    shouldBlockCrossOrigin('POST', 'https://trusted.example', ['https://trusted.example']),
    false,
  ); // explicit allowlist
});

test('localOriginGuard middleware: blocks cross-site POST with 403', () => {
  const req = { method: 'POST', headers: { origin: 'http://evil.example' } };
  const res = { statusCode: 0, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  let nexted = false;
  localOriginGuard(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /cross-origin/i);
});

test('localOriginGuard middleware: passes loopback-origin POST', () => {
  const req = { method: 'POST', headers: { origin: 'http://127.0.0.1:4264' } };
  const res = {
    status() { throw new Error('should not respond'); },
    json() { throw new Error('should not respond'); },
  };
  let nexted = false;
  localOriginGuard(req, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
});

// ── P1 鉴权绕过回归（v0.7.9）──
// 修复前 requireToken 用 `isLoopbackAddr(ip) || isLoopbackOrigin(origin) || isLoopbackOrigin(referer)`
// 做回环豁免；Origin/Referer 是客户端自报头、可伪造，远程攻击者带
// `Origin: http://localhost` 即可绕过 QCLI_ACCESS_TOKEN。修复后仅按真实 socket IP 豁免。
// requireToken 在模块加载时捕获 env，故此处动态设 env 并清 require 缓存后重新加载。
function freshRequireToken(token, requireLoopback) {
  process.env.QCLI_ACCESS_TOKEN = token;
  if (requireLoopback) process.env.QCLI_TOKEN_REQUIRE_LOOPBACK = '1';
  else delete process.env.QCLI_TOKEN_REQUIRE_LOOPBACK;
  delete require.cache[require.resolve('../lib/access-auth')];
  return require('../lib/access-auth').requireToken;
}

function callRequireToken(fn, { ip, origin, referer, token }) {
  let statusCode = 0;
  const res = {
    status(c) { statusCode = c; return this; },
    json() { return this; },
  };
  let nexted = false;
  const req = {
    ip,
    headers: { ...(origin ? { origin } : {}), ...(referer ? { referer } : {}) },
    query: {},
  };
  if (token) req.headers.authorization = `Bearer ${token}`;
  fn(req, res, () => { nexted = true; });
  return { statusCode, nexted };
}

test('P1: forged loopback Origin does NOT bypass token (remote IP)', () => {
  const requireToken = freshRequireToken('secret-token', false);
  // 远程 IP + 伪造回环 Origin/Referer → 必须 401，不能 next()
  const r = callRequireToken(requireToken, {
    ip: '203.0.113.9',
    origin: 'http://localhost',
    referer: 'http://127.0.0.1:4264/',
  });
  assert.strictEqual(r.nexted, false);
  assert.strictEqual(r.statusCode, 401);
});

test('P1: forged loopback Origin does NOT bypass token (valid token still works)', () => {
  const requireToken = freshRequireToken('secret-token', false);
  const r = callRequireToken(requireToken, {
    ip: '203.0.113.9',
    origin: 'http://localhost',
    token: 'secret-token',
  });
  assert.strictEqual(r.nexted, true);
});

test('P1: real loopback IP still exempt by default', () => {
  const requireToken = freshRequireToken('secret-token', false);
  const r = callRequireToken(requireToken, { ip: '127.0.0.1' });
  assert.strictEqual(r.nexted, true);
});

test('P1: REQUIRE_LOOPBACK=1 requires token even for loopback IP', () => {
  const requireToken = freshRequireToken('secret-token', true);
  const r = callRequireToken(requireToken, { ip: '127.0.0.1' });
  assert.strictEqual(r.nexted, false);
  assert.strictEqual(r.statusCode, 401);
  const ok = callRequireToken(requireToken, { ip: '127.0.0.1', token: 'secret-token' });
  assert.strictEqual(ok.nexted, true);
});
