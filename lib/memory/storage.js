/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Low-level file I/O for the memory subsystem.
// - Atomic writes (temp file + rename) so a crash mid-write never leaves a
//   half-written JSON file.
// - Corruption recovery: every successful write keeps a `.bak` of the previous
//   good copy; readJSON falls back to it on parse error.
// - Crash-safe uniqueness: each temp file is named with pid + a per-process
//   counter, so two concurrent async writes cannot clobber each other's tmp.
// - An in-process promise-chain mutex (`withLock`) serializes higher-level
//   operations (e.g. concurrent appends to the same session file).
'use strict';

const fs = require('fs');
const path = require('path');

let _tmpCounter = 0;

function ensureDir(dir) {
  if (!dir) return;
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}

function exists(target) {
  try { return fs.existsSync(target); } catch { return false; }
}

function tmpPath(target) {
  return `${target}.${process.pid}.${++_tmpCounter}.tmp`;
}

// Write a string to target atomically. Keeps a `.bak` of the prior content.
function writeFileAtomic(target, str) {
  ensureDir(path.dirname(target));
  const tmp = tmpPath(target);
  fs.writeFileSync(tmp, str);
  if (exists(target)) {
    try { fs.copyFileSync(target, `${target  }.bak`); } catch { /* ignore */ }
  }
  fs.renameSync(tmp, target);
}

function writeJSON(target, obj) {
  writeFileAtomic(target, JSON.stringify(obj, null, 2));
}

// Read a raw text file (e.g. profile.md). Missing/corrupt → fallback.
function readFile(target, fallback = '') {
  if (!exists(target)) return fallback;
  try { return fs.readFileSync(target, 'utf-8'); }
  catch { return fallback; }
}

// Read + parse JSON. Missing file → fallback. Corrupt file → try `.bak`,
// else fallback. Never throws on missing/corrupt (caller decides semantics).
function readJSON(target, fallback = null) {
  if (!exists(target)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(target, 'utf-8'));
  } catch {
    const bak = `${target  }.bak`;
    if (exists(bak)) {
      try { return JSON.parse(fs.readFileSync(bak, 'utf-8')); }
      catch { /* fall through */ }
    }
    return fallback;
  }
}

function removeFile(target) {
  try { if (exists(target)) fs.unlinkSync(target); } catch { /* ignore */ }
}

// List full paths of *.json files in dir (excluding *.bak), sorted by name.
function listJSON(dir) {
  ensureDir(dir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => path.join(dir, f))
    .sort();
}

// ── In-process mutex ────────────────────────────────────────────────────────
// Serializes async ops keyed by a string (e.g. a session id) so that two
// append/compact passes on the same file cannot interleave their read-modify-
// write cycles. Each key holds a promise chain; withLock queues onto it.
// Standard pattern: the next caller waits for the previous fn() to settle.
const _locks = new Map();

function withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  const result = prev.then(() => fn());
  // Keep the chain alive on success AND failure so a rejected fn() can't break
  // serialization for subsequent callers.
  _locks.set(key, result.catch(() => {}));
  return result;
}

module.exports = {
  ensureDir,
  exists,
  writeFileAtomic,
  writeJSON,
  readJSON,
  readFile,
  removeFile,
  listJSON,
  withLock,
};
