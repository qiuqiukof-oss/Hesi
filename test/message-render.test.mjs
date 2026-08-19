/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// P2.1 render-snapshot: lock the output of the extracted message-render module
// so the chat-panel refactor is provably behavior-preserving. Pure string
// transforms — no DOM needed.
import { test } from 'node:test';
import assert from 'node:assert';
import { renderMarkdown, linkify } from '../public/components/message-render.js';

test('empty / falsy input renders empty string', () => {
  assert.strictEqual(renderMarkdown(''), '');
  assert.strictEqual(renderMarkdown(/** @type {any} */ (null)), '');
});

test('plain text is escaped and line breaks become <br>', () => {
  assert.strictEqual(renderMarkdown('a < b & c'), 'a &lt; b &amp; c');
  assert.strictEqual(renderMarkdown('line1\nline2'), 'line1<br>line2');
});

test('bold and italic', () => {
  assert.strictEqual(renderMarkdown('**hi**'), '<strong>hi</strong>');
  assert.strictEqual(renderMarkdown('*hi*'), '<em>hi</em>');
});

test('inline code is escaped and wrapped', () => {
  assert.strictEqual(renderMarkdown('`<x>`'), '<code class="md-inline-code">&lt;x&gt;</code>');
});

test('fenced code block produces md-code-block with escaped content', () => {
  const out = renderMarkdown('```js\nconst a = 1 < 2;\n```');
  assert.ok(out.includes('md-code-block'), 'has code block wrapper');
  assert.ok(out.includes('md-code-lang'), 'has lang badge');
  // NOTE: preserved baseline — renderMarkdown escapes the whole text first, then
  // the code-block handler escapes again, so `<` becomes `&amp;lt;` (double
  // escape). This snapshot locks the *existing* behavior; the P2.1 extraction is
  // behavior-preserving, not a bug fix.
  assert.ok(out.includes('const a = 1 &amp;lt; 2;'), 'code content escaped (baseline double-escape)');
  // URLs / markdown inside code must NOT be transformed
  assert.ok(!out.includes('<br>'), 'no <br> injected inside code block');
});

test('mermaid fence becomes a .mermaid div', () => {
  const out = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
  assert.ok(out.includes('<div class="mermaid">'), 'mermaid rendered as diagram div');
});

test('linkify: bare https URL becomes an anchor with safe rel', () => {
  const out = linkify('see https://example.com/x');
  assert.ok(out.includes('<a href="https://example.com/x"'), 'href present');
  assert.ok(out.includes('rel="noopener noreferrer"'), 'safe rel');
});

test('linkify strips a trailing sentence period out of the href', () => {
  const out = linkify('go to https://a.com.');
  assert.ok(out.includes('href="https://a.com"'), 'period excluded from href');
  assert.ok(out.endsWith('.'), 'period kept as text after the link');
});

test('XSS: javascript: scheme is NOT linkified', () => {
  const out = renderMarkdown('javascript:alert(1)');
  assert.ok(!out.includes('<a '), 'no anchor for javascript: scheme');
});

test('long URL label is truncated with ellipsis but href is full', () => {
  const long = 'https://example.com/' + 'a'.repeat(80);
  const out = linkify(long);
  assert.ok(out.includes(`href="${long}"`), 'full href preserved');
  assert.ok(out.includes('…</a>'), 'label truncated with ellipsis');
});
