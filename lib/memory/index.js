// @ts-check
// Memory subsystem facade. Routes and the chat handler depend ONLY on this
// object — internal modules (session/archive/recall/index-store/compaction/
// profile/embed) are isolated behind it. This is the "anti-monolith" boundary:
// swapping the compression algorithm must not ripple into routing.
'use strict';

const config = require('./config');
const archive = require('./archive');
const recall = require('./recall');
const compaction = require('./compaction');
const profile = require('./profile');

const MemoryStore = {
  config,
  enabled: config.MEMORY_ENABLED,

  // ── session lifecycle ──
  ensure: (id, meta) => archive.ensure(id, meta),
  append: (id, msgs, meta) => archive.append(id, msgs, meta),
  get: (id) => archive.get(id),
  list: (opts) => archive.list(opts),
  rename: (id, title) => archive.rename(id, title),
  remove: (id) => archive.remove(id),
  listTrash: () => archive.listTrash(),
  restore: (id) => archive.restore(id),
  purge: (id) => archive.purge(id),
  importLegacy: (msgs, meta) => archive.importLegacy(msgs, meta),

  // ── prompt injection ──
  recall: (q, opts) => recall.relevant(q, opts),
  getSummaryBlock: (id) => recall.getSummaryBlock(id),

  // ── completion hooks (compactIfNeeded wired M1/v0.3.1; extractFacts wired M6) ──
  commit: async () => {},
  compactIfNeeded: (sessionId, opts) => compaction.compactIfNeeded(sessionId, opts),
  extractFacts: (sessionId, opts) => profile.extractFacts(sessionId, opts),
};

module.exports = MemoryStore;
