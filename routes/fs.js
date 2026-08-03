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

// ── Markdown drawer (Obsidian-style note browser) ──
// Allowed roots are derived from the server cwd (never hard-coded) and can be
// overridden via HESI_MD_ROOTS (comma-separated absolute paths). All reads must
// stay inside these roots — fail-closed (403) otherwise.
const MD_NOISE_DIRS = new Set(['node_modules', '.git']);

function getMdRoots() {
  const cwd = process.cwd();
  const env = process.env.HESI_MD_ROOTS;
  if (env && env.trim()) {
    return env
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => {
        const abs = path.resolve(p);
        return { id: abs, name: path.basename(abs) || abs, path: abs };
      });
  }
  return [
    { id: 'workspace', name: '工作区', path: path.resolve(cwd) },
    { id: 'workbuddy', name: '.workbuddy', path: path.resolve(cwd, '.workbuddy') },
    { id: 'memory', name: '运行日志', path: path.resolve(cwd, 'data', 'memory') },
  ];
}

function mdRootPaths() {
  return getMdRoots().map((r) => r.path);
}

function isWithinRoots(roots, target) {
  const t = path.resolve(target);
  return roots.some((r) => t === r || t.startsWith(r + path.sep));
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

  // ── Markdown drawer endpoints ──
  // GET /api/fs/md-roots → allowed roots for the drawer chips
  router.get('/fs/md-roots', (_req, res) => {
    res.json({ roots: getMdRoots() });
  });

  // GET /api/fs/md-list?dir=<abs> → { dir, parent, dirs:[{name,path}], files:[{name,path}] }
  router.get('/fs/md-list', (req, res) => {
    const roots = mdRootPaths();
    const dir = req.query.dir;
    if (typeof dir !== 'string' || !dir.trim()) {
      return res.status(400).json({ error: 'dir required' });
    }
    const abs = path.resolve(dir);
    if (!isWithinRoots(roots, abs)) {
      return res.status(403).json({ error: 'path outside allowed roots' });
    }
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return res.status(404).json({ error: `not found: ${abs}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `not a directory: ${abs}` });
    }
    const inNoteRoot = roots.some((r) => abs === r); // show dotfile subdirs inside note roots
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    const dirs = [];
    const files = [];
    for (const e of entries) {
      if (MD_NOISE_DIRS.has(e.name)) continue;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (!inNoteRoot && e.name.startsWith('.')) continue;
        dirs.push({ name: e.name, path: full });
      } else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) {
        files.push({ name: e.name, path: full });
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(abs);
    res.json({
      dir: abs,
      parent: isWithinRoots(roots, parent) ? parent : '',
      dirs,
      files,
    });
  });

  // GET /api/fs/md-read?path=<abs> → { path, name, content, size }
  const MAX_MD_BYTES = 4 * 1024 * 1024;
  router.get('/fs/md-read', (req, res) => {
    const roots = mdRootPaths();
    const p = req.query.path;
    if (typeof p !== 'string' || !p.trim()) {
      return res.status(400).json({ error: 'path required' });
    }
    const abs = path.resolve(p);
    if (!/\.(md|markdown)$/i.test(abs)) {
      return res.status(400).json({ error: 'only .md files are readable' });
    }
    if (!isWithinRoots(roots, abs)) {
      return res.status(403).json({ error: 'path outside allowed roots' });
    }
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return res.status(404).json({ error: `not found: ${abs}` });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ error: `not a file: ${abs}` });
    }
    if (stat.size > MAX_MD_BYTES) {
      return res.status(413).json({ error: 'file too large (max 4MB)' });
    }
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    res.json({ path: abs, name: path.basename(abs), content, size: stat.size });
  });

  return router;
}

module.exports = { createRouter };
