// @ts-check
// ============================================================
// memory-migrate.js — one-shot legacy → memory import
// ============================================================
// Imports a legacy chat-history JSON export into the server-backed memory
// subsystem as the first session. Idempotent: a data/memory/.migrated
// marker prevents re-running. No-op when the input is empty/missing.
//
// Usage:
//   node scripts/memory-migrate.js [--file path/to/legacy.json]
// Reads HESI_MEMORY_DIR (or defaults to data/memory). The JSON file should be
// an array of { role, content, ... } messages (e.g. exported from the
// browser's localStorage['qcli-chat-history']).
'use strict';

const fs = require('fs');
const path = require('path');
const MemoryStore = require('../lib/memory');

function parseArgs(argv) {
  const out = { file: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) out.file = argv[i + 1];
  }
  return out;
}

async function main() {
  const marker = MemoryStore.config.MIGRATED_MARKER;
  if (fs.existsSync(marker)) {
    console.log(`[memory-migrate] already migrated (${  marker  } exists) — no-op.`);
    return;
  }

  const { file } = parseArgs(process.argv.slice(2));
  let messages = [];
  if (file) {
    if (!fs.existsSync(file)) {
      console.warn(`[memory-migrate] input file not found: ${  file  } — no-op.`);
      return;
    }
    try {
      messages = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      console.error(`[memory-migrate] failed to parse ${  file  }: ${  e.message}`);
      process.exitCode = 1;
      return;
    }
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    console.log('[memory-migrate] no legacy messages to import — no-op.');
    // Still drop the marker so we don't keep checking an empty source.
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* ignore */ }
    return;
  }

  const s = await MemoryStore.importLegacy(messages, { title: '迁移自旧版对话' });
  console.log('[memory-migrate] imported', messages.length, 'messages → session', s.id, `(${  s.title  })`);

  try { fs.writeFileSync(marker, new Date().toISOString()); } catch (e) {
    console.warn(`[memory-migrate] could not write marker: ${  e.message}`);
  }
}

main().catch((e) => {
  console.error('[memory-migrate] error:', e && e.message);
  process.exitCode = 1;
});
