/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Filesystem browse route — lists immediate subdirectories of an
// absolute path so the frontend can present a folder picker that
// yields a REAL absolute path (browsers' <input webkitdirectory>
// and showDirectoryPicker do NOT expose the full path).
// Loopback-only + requireToken off-loopback (same posture as the terminal).
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
// Sentinel path that means "list the machine's drive roots" (Windows only).
const DRIVES_SENTINEL = '::drives';

/**
 * Enumerate existing drive roots on Windows (C: … Z:). A/B are skipped to
 * avoid ancient floppy-probe quirks; removable media are normally C+.
 * @returns {{name:string,path:string}[]}
 */
function listDrives() {
  const out = [];
  for (let code = 67 /* C */; code <= 90 /* Z */; code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) out.push({ name: root, path: root });
    } catch { /* unreadable drive → skip */ }
  }
  return out;
}

/** True when `dir` is a Windows drive root like "C:\" or "C:". */
function isWinDriveRoot(dir) {
  return IS_WIN && /^[A-Za-z]:\\?$/.test(dir);
}

/**
 * Create an Express router for filesystem browse endpoints.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // GET /api/fs/dirs?dir=<absolute path>
  // Returns { dir, parent, dirs: [{ name, path }] }
  router.get('/fs/dirs', (req, res) => {
    let dir = req.query.dir || process.cwd();
    if (typeof dir !== 'string' || dir.trim().length === 0) {
      dir = process.cwd();
    }

    // Drive-list view (Windows): return the machine's drive roots so the
    // picker can hop across disks (C: → D: → H:). Must be handled BEFORE
    // path.resolve, which would mangle the sentinel.
    if (dir === DRIVES_SENTINEL) {
      return res.json({
        dir: DRIVES_SENTINEL,
        parent: '',
        dirs: IS_WIN ? listDrives() : [],
        isDrives: true,
      });
    }

    dir = path.resolve(dir);

    if (!path.isAbsolute(dir)) {
      return res.status(400).json({ error: 'absolute path required' });
    }

    let stat;
    try {
      stat = fs.statSync(dir);
    } catch (e) {
      return res.status(404).json({ error: `directory not found: ${  dir}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `not a directory: ${  dir}` });
    }

    let entries = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    // At a Windows drive root, path.dirname("C:\") returns "C:\" (itself), so
    // the client can't offer an "up" step. Point "parent" at the drives
    // sentinel instead, giving the picker a disk-selection layer above roots.
    const rawParent = path.dirname(dir);
    const parent = isWinDriveRoot(dir) ? DRIVES_SENTINEL : rawParent;

    return res.json({
      dir,
      parent,
      dirs: entries,
    });
  });

  return router;
}

module.exports = { createRouter };
