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

    return res.json({
      dir,
      parent: path.dirname(dir),
      dirs: entries,
    });
  });

  return router;
}

module.exports = { createRouter };
