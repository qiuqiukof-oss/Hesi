// @ts-check
// Single-session model: load / save / idempotent append / working-window trim.
// All file IO goes through storage (atomic writes, corruption recovery).
'use strict';

const path = require('path');
const config = require('./config');
const schema = require('./schema');
const storage = require('./storage');

function filePath(id) {
  return path.join(config.SESSIONS_DIR, `${id}.json`);
}

function load(id) {
  return storage.readJSON(filePath(id), null);
}

function save(session) {
  session.updatedAt = Date.now();
  storage.writeJSON(filePath(session.id), session);
  return session;
}

function ensure(id, meta = {}) {
  const existing = load(id);
  if (existing) return existing;
  const now = Date.now();
  const session = {
    id,
    title: meta.title || '新会话',
    createdAt: now,
    updatedAt: now,
    model: meta.model || '',
    provider: meta.provider || '',
    tokenEstimate: 0,
    summary: '',
    summaryUpdatedAt: 0,
    workingWindow: config.WORKING_WINDOW,
    messages: [],
  };
  storage.writeJSON(filePath(id), session);
  return session;
}

// Merge incoming messages into existing by stable id (incoming overrides on
// conflict), then sort by timestamp so ordering is deterministic.
function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  const merged = [...byId.values()];
  merged.sort((a, b) => a.ts - b.ts);
  return merged;
}

// Idempotent append. Safe to call repeatedly with the same window of messages.
function append(id, messages, meta = {}) {
  return storage.withLock(id, () => {
    const session = ensure(id, meta);
    const norm = (Array.isArray(messages) ? messages : []).map(schema.normalizeMessage);
    session.messages = mergeMessages(session.messages, norm);
    session.tokenEstimate = session.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);
    if (session.title === '新会话') {
      const t = schema.titleFromFirstMessage(session.messages);
      if (t !== '新会话') session.title = t;
    }
    if (meta.model) session.model = meta.model;
    if (meta.provider) session.provider = meta.provider;
    return save(session);
  });
}

// Apply a compaction result: store the summary and trim raw messages down to
// the working window (oldest are dropped because they live on in `summary`).
function applySummary(id, summary) {
  return storage.withLock(id, () => {
    const session = load(id);
    if (!session) return null;
    session.summary = summary;
    session.summaryUpdatedAt = Date.now();
    if (session.messages.length > session.workingWindow) {
      session.messages = session.messages.slice(-session.workingWindow);
      session.tokenEstimate = session.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);
    }
    const saved = save(session);
    return saved;
  });
}

// M2b (v0.3.1): 单槽检查点 / 回滚。checkpoint 把当前 session 复制为 <id>.ckpt.json（覆盖式）；
// rollback 把 ckpt 覆写回 session 并返回消息，使会话恢复到该检查点。
function checkpoint(id) {
  const session = load(id);
  if (!session) return null;
  const ckptPath = path.join(config.SESSIONS_DIR, `${id}.ckpt.json`);
  storage.writeJSON(ckptPath, session);
  return true;
}

function rollback(id) {
  const ckptPath = path.join(config.SESSIONS_DIR, `${id}.ckpt.json`);
  const ckpt = storage.readJSON(ckptPath, null);
  if (!ckpt) return null;
  save(ckpt); // 原子覆写回 session
  return ckpt.messages;
}

module.exports = { filePath, load, save, ensure, append, mergeMessages, applySummary, checkpoint, rollback };
