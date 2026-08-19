/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Tests for the canonical HTML-escaping helper (Phase 4 frontend governance).
//
// public/escape.js is the single source of truth after consolidating ~17
// per-file escapeHtml definitions. The critical invariant: it escapes ALL FIVE
// HTML-significant characters (& < > " '), making it safe for BOTH text and
// attribute interpolation. Several callers (chat-panel, orchestrator,
// digital-employees, multi-media, ...) interpolate values into attributes like
// title="${escapeHtml(x)}" — if quotes were left unescaped (as the old DOM
// textContent trick did), an attacker could break out of the attribute. This
// test guards against a regression back to a quote-unsafe implementation.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

test('escapeHtml escapes all five HTML-significant characters', async () => {
  const { escapeHtml } = await import('../public/escape.js');
  assert.strictEqual(escapeHtml('&'), '&amp;');
  assert.strictEqual(escapeHtml('<'), '&lt;');
  assert.strictEqual(escapeHtml('>'), '&gt;');
  assert.strictEqual(escapeHtml('"'), '&quot;');
  assert.strictEqual(escapeHtml("'"), '&#39;');
});

test('escapeHtml neutralizes a script-injection payload', async () => {
  const { escapeHtml } = await import('../public/escape.js');
  const out = escapeHtml('<img src=x onerror="alert(1)">');
  assert.ok(!out.includes('<'), 'must not contain a raw <');
  assert.ok(!out.includes('>'), 'must not contain a raw >');
  assert.ok(!out.includes('"'), 'must not contain a raw " (attribute breakout)');
  assert.strictEqual(
    out,
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
  );
});

test('escapeHtml is attribute-safe: quotes cannot break out', async () => {
  const { escapeHtml } = await import('../public/escape.js');
  // Simulate title="${escapeHtml(x)}" with a value trying to inject onmouseover.
  const attr = `title="${escapeHtml('" onmouseover="alert(1)')}"`;
  // The only unescaped double-quotes are the two delimiters we added.
  assert.strictEqual((attr.match(/"/g) || []).length, 2);
  assert.strictEqual(attr, 'title="&quot; onmouseover=&quot;alert(1)"');
});

test('escapeHtml coerces null/undefined/numbers to a safe string', async () => {
  const { escapeHtml } = await import('../public/escape.js');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(0), '0');
  assert.strictEqual(escapeHtml(42), '42');
});

test('escapeHtml leaves safe text untouched', async () => {
  const { escapeHtml } = await import('../public/escape.js');
  assert.strictEqual(escapeHtml('Hello, 世界 123'), 'Hello, 世界 123');
});
