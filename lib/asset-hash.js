/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Asset content hashing — cache-busting for the frontend bundles
// ------------------------------------------------------------
// The SPA loads /bundle.js and /lazy-bundle.js. Serving them with a long-lived
// immutable cache is a big win (they rarely change), but a plain immutable URL
// goes stale after a rebuild — the browser keeps the old bundle and the UI
// "doesn't update" until a hard refresh. The fix is a content-hash query param
// (/bundle.js?v=<hash>): the URL changes exactly when the bytes change, so the
// browser refetches only then and can safely cache forever otherwise.
//
// The hash is computed lazily and cached in memory, keyed by (path, mtimeMs +
// size). A rebuild changes the file mtime → the cache misses → a fresh hash is
// computed, all WITHOUT a server restart. This keeps the folder-copy / offline
// distribution model intact (no build-time HTML rewriting, nothing committed).
// ============================================================
'use strict';

const fs = require('fs');
const crypto = require('crypto');

/** @type {Map<string, { key: string, hash: string }>} */
const cache = new Map();

/**
 * Return a short content hash (8 hex chars) for a file, or '' if unreadable.
 * Cheap on repeat calls: only re-hashes when the file's mtime/size changes.
 * @param {string} absPath
 * @returns {string}
 */
function hashFile(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return '';
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = cache.get(absPath);
  if (cached && cached.key === key) return cached.hash;

  let hash = '';
  try {
    const buf = fs.readFileSync(absPath);
    hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
  } catch {
    return '';
  }
  cache.set(absPath, { key, hash });
  return hash;
}

/**
 * Append (or refresh) a `?v=<hash>` cache-busting param on same-origin script
 * `src` attributes for the given basenames, using each file's content hash.
 *
 * @param {string} html          — the index.html source
 * @param {string} publicDir     — absolute path to the dir the bundles live in
 * @param {string[]} basenames   — e.g. ['bundle.js', 'lazy-bundle.js']
 * @returns {string} html with hashed bundle URLs
 */
function injectAssetHashes(html, publicDir, basenames) {
  const path = require('path');
  let out = html;
  for (const name of basenames) {
    const hash = hashFile(path.join(publicDir, name));
    if (!hash) continue;
    // Match src="/name" or src="/name?..." (idempotent — replaces any existing v=).
    const re = new RegExp(`(src=")(/${name.replace(/[.]/g, '\\.')})(\\?[^"]*)?(")`, 'g');
    out = out.replace(re, `$1$2?v=${hash}$4`);
  }
  return out;
}

module.exports = { hashFile, injectAssetHashes };
