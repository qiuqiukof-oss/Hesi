/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// CLI CRUD Routes
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  loadRegistry,
  saveRegistry,
  withRegistry,
  resolveCommand,
  resolveCliExecutable,
  getVersion,
  guessType,
  guessCategory,
  discoverCLIsAsync,
} = require('../cli-discovery');

/**
 * Create an Express router for CLI CRUD operations.
 *
 * @param {{ discoverLimiter: Function }} rateLimiters
 * @returns {express.Router}
 */
function createRouter({ discoverLimiter }) {
  const router = express.Router();

  // ──────────────────────────────────────────────
  // List all registered CLIs
  // ──────────────────────────────────────────────
  router.get('/clis', (req, res) => {
    const registry = loadRegistry();
    // Folders are stored inside cli-registry.json as registry.folders
    res.json({ ...registry, folders: registry.folders || [] });
  });

  // ──────────────────────────────────────────────
  // Add a CLI manually
  // ──────────────────────────────────────────────
  router.post('/clis', async (req, res) => {
    const { name, path: cliPath, args, init } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Validate args type and content
    if (args !== undefined) {
      if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) {
        return res.status(400).json({ error: 'args must be an array of strings' });
      }
    }

    const fullPath = cliPath || resolveCommand(name);
    if (!fullPath) {
      return res.status(400).json({ error: `Cannot resolve "${name}" in PATH` });
    }

    // Validate the provided path to prevent command injection
    if (cliPath) {
      if (!path.isAbsolute(cliPath)) {
        return res.status(400).json({ error: 'path must be an absolute path' });
      }
      try {
        if (!fs.statSync(cliPath).isFile()) {
          return res.status(400).json({ error: 'path does not point to a valid file' });
        }
      } catch {
        return res.status(400).json({ error: 'path is not accessible' });
      }
    }

    // Resolve version, type, and category in parallel
    const [version, type] = await Promise.all([
      getVersion(fullPath),
      guessType(fullPath, name),
    ]);
    const category = guessCategory(name);

    // Use withRegistry for atomic read-modify-write
    let entry;
    try {
      entry = await withRegistry(() => {
        const reg = loadRegistry();
        const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

        if (reg.clis.some(c => c.id === id)) {
          const err = new Error(`CLI "${id}" already registered`);
          err.status = 409;
          throw err;
        }

        const newEntry = {
          id,
          name,
          path: fullPath,
          type,
          category,
          discovered: 'manual',
          args: args || [],
          init: init || '',
          version,
          addedAt: new Date().toISOString(),
        };

        reg.clis.push(newEntry);
        saveRegistry(reg);
        return newEntry;
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({ error: err.message });
    }

    res.status(201).json(entry);
  });

  // ──────────────────────────────────────────────
  // Remove a CLI
  // ──────────────────────────────────────────────
  router.delete('/clis/:id', async (req, res) => {
    try {
      const result = await withRegistry(() => {
        const registry = loadRegistry();
        const idx = registry.clis.findIndex(c => c.id === req.params.id);
        if (idx === -1) {
          const err = new Error('CLI not found');
          err.status = 404;
          throw err;
        }
        registry.clis.splice(idx, 1);
        saveRegistry(registry);
        return { success: true };
      });
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // Run discovery
  // ──────────────────────────────────────────────
  router.post('/discover', discoverLimiter, async (req, res) => {
    try {
      const result = await discoverCLIsAsync();
      // Reset the rate limit window after a successful discovery
      // so the user can immediately run another discovery if needed
      discoverLimiter.reset(req.ip || req.connection.remoteAddress);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ──────────────────────────────────────────────
  // CLI Health Check — verify all registered CLI paths exist
  // ──────────────────────────────────────────────
  router.get('/clis/health', (req, res) => {
    try {
      const registry = loadRegistry();
      const results = registry.clis.map(cli => {
        let status = 'unknown';
        let error = null;
        // Resolve to an absolute, runnable executable. For discovered CLIs the
        // stored `path` is the portable command name; this resolves it via PATH
        // so the health check reports the real on-disk status.
        const filePath = resolveCliExecutable(cli) || cli.path || cli.name || '';

        if (!filePath) {
          status = 'missing';
          error = 'No path and cannot resolve from name';
        } else {
          try {
            if (fs.statSync(filePath).isFile()) {
              status = 'ok';
            } else {
              status = 'missing';
              error = 'Path exists but is not a file';
            }
          } catch (e) {
            status = 'missing';
            error = `Path is not accessible: ${  e.code || e.message}`;
          }
        }

        return {
          id: cli.id,
          name: cli.name,
          path: filePath || null,
          category: cli.category || 'tool',
          version: cli.version || null,
          status,
          error,
          discovered: cli.discovered || 'unknown',
        };
      });

      const summary = {
        total: results.length,
        ok: results.filter(r => r.status === 'ok').length,
        missing: results.filter(r => r.status === 'missing').length,
        resolved: results.filter(r => r.status === 'resolved').length,
        unknown: results.filter(r => r.status === 'unknown').length,
      };

      res.json({ success: true, results, summary });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // Batch Delete CLIs
  // ──────────────────────────────────────────────
  router.post('/clis/batch-delete', async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '"ids" must be a non-empty array' });
    }
    try {
      const result = await withRegistry(() => {
        const registry = loadRegistry();
        let deleted = 0;
        let notFound = 0;
        for (const id of ids) {
          const idx = registry.clis.findIndex(c => c.id === id);
          if (idx !== -1) {
            registry.clis.splice(idx, 1);
            deleted++;
          } else {
            notFound++;
          }
        }
        saveRegistry(registry);
        return { success: true, deleted, notFound };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // Export selected CLIs as config JSON
  // ──────────────────────────────────────────────
  router.post('/clis/batch-export', (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '"ids" must be a non-empty array' });
    }
    try {
      const registry = loadRegistry();
      const selected = registry.clis.filter(c => ids.includes(c.id));
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        clis: selected.map(c => ({
          id: c.id,
          name: c.name,
          path: c.path || c.name,
          category: c.category || 'tool',
          type: c.type || 'batch',
          args: c.args || [],
          init: c.init || '',
        })),
      };
      res.json({ success: true, export: payload });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // Batch Import CLIs from config JSON
  // ──────────────────────────────────────────────
  router.post('/clis/batch-import', async (req, res) => {
    const { clis } = req.body || {};
    if (!Array.isArray(clis) || clis.length === 0) {
      return res.status(400).json({ error: '"clis" must be a non-empty array' });
    }
    try {
      const result = await withRegistry(() => {
        const registry = loadRegistry();
        let imported = 0;
        let skipped = 0;
        const errors = [];
        for (const entry of clis) {
          if (!entry.name) { errors.push('Entry missing name'); continue; }
          const id = entry.id || entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          if (registry.clis.some(c => c.id === id)) {
            skipped++;
            continue;
          }
          const fullPath = entry.path ? (path.isAbsolute(entry.path) ? entry.path : resolveCommand(entry.name)) : resolveCommand(entry.name);
          registry.clis.push({
            id,
            name: entry.name,
            path: fullPath || entry.path || entry.name,
            type: entry.type || 'batch',
            category: entry.category || 'tool',
            discovered: 'imported',
            args: entry.args || [],
            init: entry.init || '',
            version: entry.version || 'imported',
            addedAt: new Date().toISOString(),
          });
          imported++;
        }
        saveRegistry(registry);
        return { success: true, imported, skipped, errors: errors.length > 0 ? errors : undefined };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
