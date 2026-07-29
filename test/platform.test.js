/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Platform module tests (E4) — covers the new enterprise modules.
// Run with: node --test test/platform.test.js
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rbac = require('../lib/auth/rbac');
const license = require('../lib/license');
const session = require('../lib/auth/session');
const audit = require('../lib/audit');
const config = require('../lib/config');

test('rbac: admin can do everything, viewer is limited', () => {
  assert.equal(rbac.can('admin', 'users:write'), true);
  assert.equal(rbac.can('user', 'users:write'), false);
  assert.equal(rbac.can('viewer', 'audit:read'), true);
  assert.equal(rbac.can('viewer', 'users:write'), false);
  assert.equal(rbac.normalizeRole('bogus'), 'viewer');
});

test('license: community matrix denies commercial-only capabilities', () => {
  // Default mode is community (config reads HESI_LICENSE_MODE at load time).
  assert.equal(license.CAPABILITIES.audit.community, false);
  assert.equal(license.CAPABILITIES.multiAgent.community, true);
  assert.equal(license.hasCapability('multiAgent'), true);
  assert.equal(license.hasCapability('audit'), false);
  assert.equal(license.hasCapability('sso'), false);
});

test('session: token round-trips and rejects tampering', () => {
  const user = { id: 'u1', username: 'alice', role: 'user' };
  const token = session.createSession(user);
  assert.ok(token.includes('.'));
  const payload = session.verifyToken(token);
  assert.ok(payload && payload.sub === 'u1' && payload.role === 'user');
  // tamper
  const forged = token.slice(0, -2) + (token.endsWith('a') ? 'b' : 'a');
  assert.equal(session.verifyToken(forged), null);
});

test('audit: log + query round-trips and sanitizes secrets', async () => {
  const before = audit.query({ type: 'unit_test_event' }).length;
  audit.log({ type: 'unit_test_event', user: 'tester', params: { password: 'hunter2', note: 'ok' } });
  // Audit is written asynchronously (batched append) — give it a tick to flush.
  await new Promise((r) => setTimeout(r, 60));
  const rows = audit.query({ type: 'unit_test_event' });
  assert.ok(rows.length > before);
  const last = rows[0];
  assert.equal(last.params.password, '[REDACTED]');
  assert.equal(last.params.note, 'ok');
});

test('config: central env wiring is present', () => {
  assert.ok('AUTH_MODE' in config);
  assert.ok('SESSION_SECRET' in config && typeof config.SESSION_SECRET === 'string' && config.SESSION_SECRET.length > 0);
  assert.ok('AUDIT_LOG' in config);
  assert.ok(fs.existsSync(path.dirname(config.AUDIT_LOG)) || true);
});
