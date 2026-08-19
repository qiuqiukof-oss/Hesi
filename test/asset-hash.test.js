/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Tests for lib/asset-hash.js — bundle cache-busting (Phase 2.5).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hashFile, injectAssetHashes } = require('../lib/asset-hash');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-assethash-'));
}

test('hashFile: stable for same content, changes when content changes', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'bundle.js');
  fs.writeFileSync(f, 'console.log(1)');
  const h1 = hashFile(f);
  assert.match(h1, /^[0-9a-f]{8}$/, 'short 8-hex hash');
  assert.strictEqual(hashFile(f), h1, 'stable across calls (cache hit)');

  // Rewrite with different bytes + bump mtime so the cache key changes.
  fs.writeFileSync(f, 'console.log(2)');
  fs.utimesSync(f, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  const h2 = hashFile(f);
  assert.notStrictEqual(h2, h1, 'hash changes when content changes');
});

test('hashFile: returns empty string for a missing file', () => {
  assert.strictEqual(hashFile(path.join(tmpDir(), 'nope.js')), '');
});

test('injectAssetHashes: appends ?v=<hash> only to listed bundles', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'A');
  fs.writeFileSync(path.join(dir, 'lazy-bundle.js'), 'B');
  const html =
    '<script src="/bundle.js"></script>' +
    '<script src="/lazy-bundle.js" defer></script>' +
    '<script src="/components/other.js"></script>';
  const out = injectAssetHashes(html, dir, ['bundle.js', 'lazy-bundle.js']);

  assert.match(out, /\/bundle\.js\?v=[0-9a-f]{8}"/);
  assert.match(out, /\/lazy-bundle\.js\?v=[0-9a-f]{8}"/);
  // unrelated script untouched
  assert.match(out, /\/components\/other\.js"/);
  assert.ok(!/other\.js\?v=/.test(out));
});

test('injectAssetHashes: idempotent — refreshes an existing ?v= rather than stacking', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bundle.js'), 'A');
  const html = '<script src="/bundle.js"></script>';
  const once = injectAssetHashes(html, dir, ['bundle.js']);
  const twice = injectAssetHashes(once, dir, ['bundle.js']);
  assert.strictEqual(once, twice);
  // exactly one ?v= param
  assert.strictEqual((twice.match(/\?v=/g) || []).length, 1);
});

test('injectAssetHashes: leaves HTML untouched when the bundle is missing', () => {
  const dir = tmpDir(); // no bundle.js written
  const html = '<script src="/bundle.js"></script>';
  assert.strictEqual(injectAssetHashes(html, dir, ['bundle.js']), html);
});
