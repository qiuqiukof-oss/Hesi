// @ts-check
// Memory subsystem configuration — paths, thresholds, feature switches.
// Pure Node, zero external deps. The lib/memory/* tree is intentionally
// self-contained so it can be unit-tested and evolved without touching routes.
'use strict';

const path = require('path');

// data/ is created lazily by storage.ensureDir(); keep the same parent layout
// as lib/config.js (which owns ../data) so both agree on the data root.
const MEMORY_ROOT = process.env.HESI_MEMORY_DIR
  ? path.resolve(process.env.HESI_MEMORY_DIR)
  : path.join(__dirname, '..', '..', 'data', 'memory');

// Master kill-switch. Set HESI_MEMORY_ENABLED=0 (or 'false') to disable the
// entire subsystem — chat then falls back to the legacy trimHistory path and
// behaves exactly as before. Default ON.
const MEMORY_ENABLED = !/^(0|false|no)$/i.test(process.env.HESI_MEMORY_ENABLED || '');

module.exports = {
  ROOT: MEMORY_ROOT,
  SESSIONS_DIR: path.join(MEMORY_ROOT, 'sessions'),
  // Deleted sessions are moved here (soft-delete / recycle bin) instead of
  // being hard-unlinked, so an accidental delete is always recoverable.
  TRASH_DIR: path.join(MEMORY_ROOT, 'trash'),
  FACTS_FILE: path.join(MEMORY_ROOT, 'facts.json'),
  PROFILE_FILE: path.join(MEMORY_ROOT, 'profile.md'),
  DAILY_DIR: path.join(MEMORY_ROOT, 'daily'),
  INDEX_FILE: path.join(MEMORY_ROOT, 'index.json'),
  MIGRATED_MARKER: path.join(MEMORY_ROOT, '.migrated'),

  MEMORY_ENABLED,

  // Keep this many most-recent messages as raw working window; older ones are
  // compressed into `summary`.
  WORKING_WINDOW: 24,

  // Token estimate above which a session is auto-compacted (~70% of a typical
  // context window). Configurable via HESI_COMPACT_THRESHOLD so office/coding
  // heavy-context sessions (long docs, large source files, build logs, diffs)
  // can raise it (e.g. 120000–200000) to keep more raw context before
  // compacting. Falls back to 60000 when unset or invalid.
  COMPACT_THRESHOLD: (() => {
    const n = parseInt(process.env.HESI_COMPACT_THRESHOLD || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 60000;
  })(),

  // Idle this long with new messages also triggers a compaction pass.
  IDLE_COMPACT_MS: 120000,

  // How many facts / related sessions to recall and inject per request.
  TOPK_RECALL: 5,

  // Regenerate profile.md once accumulated facts reach this count. Kept low so
  // a personal tool surfaces a profile early (2 durable facts is "enough signal").
  PROFILE_MIN_FACTS: 2,

  // Optional local vector recall. Off by default — BM25 is the zero-dep path.
  EMBED_ENABLED: process.env.HESI_MEMORY_EMBED === '1',
  EMBED_MODEL_PATH: process.env.HESI_MEMORY_EMBED_MODEL || '',

  // Hard cap on the injected <memory> block so a huge index can never blow up
  // the prompt (chars, not tokens — rough but cheap).
  MAX_MEMORY_BLOCK_CHARS: 4000,
};
