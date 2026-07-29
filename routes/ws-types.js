/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// WebSocket Message Type Coverage — runtime diagnostic endpoint
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * Extract all message types from a backend source file.
 * Looks for `type: '...'` patterns within proximity of
 * `ws.send(...)` or `res.write(...)` calls.
 * Uses a context-window approach (reads 300 chars before the type)
 * to handle multi-line ws.send(JSON.stringify({...})) calls
 * where `type:` may appear on a different line than `ws.send(`.
 */
function extractTypesFromFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const src = fs.readFileSync(filePath, 'utf-8');
  const types = new Set();

  // Find every `type: 'xxx'` occurrence (handles any line breaks)
  const typeRe = /type:\s*'([a-z][a-z:_-]+)'/gi;
  let m;
  while ((m = typeRe.exec(src)) !== null) {
    // Look backward up to 300 chars for ws.send or res.write context
    const contextStart = Math.max(0, m.index - 300);
    const context = src.slice(contextStart, m.index);
    if (/ws\.send|res\.write/.test(context)) {
      types.add(m[1]);
    }
  }

  return [...types].sort();
}

/**
 * Parse backend files to extract all sent message types
 * (ws-handler.js for WS messages, routes/chat.js for SSE messages).
 */
function parseBackendTypes() {
  const wsPath = path.join(__dirname, '..', 'ws-handler.js');
  const chatPath = path.join(__dirname, '..', 'routes', 'chat.js');

  const wsTypes = extractTypesFromFile(wsPath).map(t => ({ type: t, source: 'ws-handler.js (WS)' }));
  const sseTypes = extractTypesFromFile(chatPath).map(t => ({ type: t, source: 'routes/chat.js (SSE)' }));

  return [...wsTypes, ...sseTypes];
}

/**
 * Parse frontend JS files to extract all handled message types
 * (lines matching `case 'xxx':` in WS message handlers).
 */
function parseFrontendTypes() {
  const files = [
    'public/app.js',
    'public/agents.js',
    'public/workflows.js',
    'public/chat-api.js',
  ];
  const handled = {};
  const knownMap = {
    'app.js':       'Main WS switch (app.js)',
    'agents.js':    'Agent handler (agents.js)',
    'workflows.js': 'Workflow handler (workflows.js)',
    'chat-api.js':  'Chat SSE handler (chat-api.js)',
  };

  for (const file of files) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf-8');
    const types = new Set();

    // Match: case 'xxx':
    const caseRe = /\bcase\s+'([a-z][a-z:_-]+)'\s*:/gi;
    let m;
    while ((m = caseRe.exec(src)) !== null) {
      types.add(m[1]);
    }

    const label = knownMap[file] || file;
    handled[label] = [...types].sort();
  }

  return handled;
}

/**
 * Create the WebSocket types router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  /**
   * GET /api/ws-types — Show WebSocket message type coverage.
   * Returns: {
   *   backend: [string],       // message types sent by ws-handler.js
   *   frontend: { handler: [string] },  // message types handled per handler file
   *   coverage: [              // cross-reference of all types
   *     { type, source, handlers: [string], covered: boolean }
   *   ]
   * }
   */
  router.get('/ws-types', (req, res) => {
    try {
      const backend = parseBackendTypes();
      const frontend = parseFrontendTypes();

      // Build coverage report
      const allFrontend = new Set();
      for (const [, types] of Object.entries(frontend)) {
        for (const t of types) allFrontend.add(t);
      }

      const allBackendTypes = backend.map(b => b.type);

      const coverage = backend.map(b => {
        const handlers = [];
        for (const [handler, types] of Object.entries(frontend)) {
          if (types.includes(b.type)) handlers.push(handler);
        }
        return {
          type: b.type,
          source: b.source,
          handlers,
          covered: handlers.length > 0,
        };
      });

      // Add frontend-only types (messages that are only received, not sent)
      for (const [handler, types] of Object.entries(frontend)) {
        for (const type of types) {
          if (!allBackendTypes.includes(type)) {
            coverage.push({
              type,
              source: 'frontend (client-initiated)',
              handlers: [handler],
              covered: true,
            });
          }
        }
      }

      coverage.sort((a, b) => a.type.localeCompare(b.type));

      res.json({
        generatedAt: new Date().toISOString(),
        backend,
        frontend,
        coverage,
        summary: {
          totalBackend: allBackendTypes.length,
          totalFrontend: allFrontend.size,
          covered: coverage.filter(c => c.covered).length,
          uncovered: coverage.filter(c => !c.covered).map(c => c.type),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
