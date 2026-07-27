// @ts-check
// Session archive orchestration: list / get / create / rename / delete / search.
// Thin layer over session + index-store; routes call only this.
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const schema = require('./schema');
const storage = require('./storage');
const session = require('./session');
const indexStore = require('./index-store');
const embed = require('./embed');

function ensure(id, meta) {
  return session.ensure(id, meta);
}

// Build the retrieval doc for a session: title + summary + user-message text.
// Indexing message content (not just summary) lets recall surface specific
// facts from sessions that haven't been compacted yet.
function sessionDoc(s) {
  const userText = (s.messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => m.content || '')
    .join('\n');
  const text = [s.summary || '', userText].filter(Boolean).join('\n');
  return indexStore.buildDoc({ ref: s.id, type: 'session', title: s.title, text });
}

// Append messages and refresh this session's entry in the retrieval index.
async function append(id, messages, meta = {}) {
  const s = await session.append(id, messages, meta);
  const doc = sessionDoc(s);
  if (embed.enabled()) doc.vec = await embed.embed(doc.text);
  indexStore.upsert(doc);
  return s;
}

function get(id) {
  return session.load(id);
}

function list({ q = '', limit = 0 } = {}) {
  // Exclude checkpoint shadow files for rollback — both the legacy single-slot
  // (<id>.ckpt.json) and the multi-turn stack (<id>.ckpt.<seq>.json). They share
  // the session id and would otherwise appear as duplicate sessions in the list.
  const files = storage.listJSON(config.SESSIONS_DIR)
    .filter((f) => !/\.ckpt(\.\d+)?\.json$/.test(f));
  let sessions = files
    .map((f) => {
      const s = storage.readJSON(f, null);
      if (!s) return null;
      return {
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        model: s.model,
        provider: s.provider,
        tokenEstimate: s.tokenEstimate,
        summary: s.summary || '',
        messageCount: (s.messages || []).length,
        hasSummary: !!s.summary,
      };
    })
    .filter(Boolean);
  if (q) {
    const ql = String(q).toLowerCase();
    sessions = sessions.filter(
      (s) => (s.title || '').toLowerCase().includes(ql) || (s.summary || '').toLowerCase().includes(ql)
    );
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  // Optional pagination for very large indexes (personal scale rarely hits this).
  if (limit > 0) sessions = sessions.slice(0, limit);
  return sessions;
}

function rename(id, title) {
  const s = session.load(id);
  if (!s) return false;
  s.title = title;
  session.save(s);
  indexStore.upsert(sessionDoc(s));
  return true;
}

// Soft-delete: move the session file into the trash dir (kept by deletion
// timestamp so re-deleting a restored session stacks safely) and drop it from
// the retrieval index. The file is NOT unlinked, so it can be restored later.
function remove(id) {
  const src = session.filePath(id);
  if (!storage.exists(src)) return false;
  storage.ensureDir(config.TRASH_DIR);
  const dest = path.join(config.TRASH_DIR, `${id}.${Date.now()}.json`);
  try { fs.copyFileSync(src, dest); } catch { return false; }
  storage.removeFile(src);
  // Drop all rollback checkpoint shadows for this session (legacy single-slot
  // <id>.ckpt.json and the multi-turn stack <id>.ckpt.<seq>.json). They're
  // snapshots of the *active* session and are regenerated on the next checkpoint,
  // so leaving them behind would just orphan them in SESSIONS_DIR.
  const idRe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ckptRe = new RegExp(`^${idRe}\\.ckpt(\\.\\d+)?\\.json$`);
  for (const f of fs.readdirSync(config.SESSIONS_DIR)) {
    if (ckptRe.test(f)) storage.removeFile(path.join(config.SESSIONS_DIR, f));
  }
  indexStore.remove(id);
  return true;
}

// List sessions currently in the trash (most-recently-deleted first).
function listTrash() {
  const dir = config.TRASH_DIR;
  storage.ensureDir(dir);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => {
      const m = f.match(/^(.*?)\.(\d+)\.json$/);
      const full = path.join(dir, f);
      const s = storage.readJSON(full, null);
      if (!s) return null;
      const id = m ? m[1] : (s.id || f);
      return {
        id,
        title: s.title || '已删除会话',
        deletedAt: m ? Number(m[2]) : (s.updatedAt || 0),
        updatedAt: s.updatedAt || 0,
        messageCount: (s.messages || []).length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

// Restore the most recently trashed copy of a session back into active use.
async function restore(id) {
  const dir = config.TRASH_DIR;
  storage.ensureDir(dir);
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${id  }.`) && f.endsWith('.json') && !f.endsWith('.bak'))
    .sort();
  if (!files.length) return false;
  const latest = files[files.length - 1];
  const src = path.join(dir, latest);
  const s = storage.readJSON(src, null);
  if (!s) return false;
  storage.ensureDir(config.SESSIONS_DIR);
  fs.copyFileSync(src, session.filePath(id));
  const doc = sessionDoc(s);
  if (embed.enabled()) doc.vec = await embed.embed(doc.text);
  indexStore.upsert(doc);
  storage.removeFile(src);
  return true;
}

// Permanently purge a trashed session (all copies) — cannot be undone.
function purge(id) {
  const dir = config.TRASH_DIR;
  storage.ensureDir(dir);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${id  }.`) && f.endsWith('.json'));
  if (!files.length) return false;
  files.forEach((f) => storage.removeFile(path.join(dir, f)));
  return true;
}

// Import a legacy (pre-memory) message list as the first session.
// Goes through the index upsert so the imported session is immediately recallable.
async function importLegacy(messages, meta = {}) {
  const id = schema.createSessionId();
  const title = schema.titleFromFirstMessage(Array.isArray(messages) ? messages : []);
  const s = await session.append(id, messages, { title, ...meta });
  const doc = sessionDoc(s);
  if (embed.enabled()) doc.vec = await embed.embed(doc.text);
  indexStore.upsert(doc);
  return s;
}

module.exports = { ensure, append, get, list, rename, remove, listTrash, restore, purge, importLegacy, sessionDoc };
