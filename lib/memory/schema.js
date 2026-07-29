// @ts-check
// Data contracts for the memory subsystem: message normalization, stable id
// generation, token estimation, and session-title derivation.
// No I/O here — pure functions so it is trivially unit-testable.
'use strict';

const crypto = require('crypto');

const VALID_ROLES = new Set(['user', 'assistant', 'tool', 'system']);

// Rough token estimate that mirrors routes/chat/utils.js single-sentence rule
// (len/2). Kept local to lib/memory to avoid a cross-layer dependency on routes.
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 2);
}

// Stable message id. Frontend is expected to attach one; this is the backend
// fallback so append() can dedupe deterministically.
function createMessageId() {
  return `m_${  Date.now().toString(36)  }_${  crypto.randomBytes(4).toString('hex')}`;
}

function createSessionId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `s_${  ymd  }_${  crypto.randomBytes(4).toString('hex')}`;
}

// Normalize an inbound message into the stored shape. Preserves an existing id
// (idempotent append relies on it). Derives tokens when missing.
function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return { id: createMessageId(), role: 'user', content: '', ts: Date.now(), tokens: 0 };
  }
  const role = VALID_ROLES.has(msg.role) ? msg.role : 'user';
  const content = typeof msg.content === 'string' ? msg.content : (msg.content == null ? '' : String(msg.content));
  const id = typeof msg.id === 'string' && msg.id ? msg.id : createMessageId();
  const ts = Number.isFinite(msg.ts) ? msg.ts : Date.now();
  const tokens = Number.isFinite(msg.tokens) && msg.tokens > 0 ? msg.tokens : estimateTokens(content);
  // 允许透传 seq（回滚改良：服务端在 append 时给新 assistant 消息打 seq；
  // 既有消息也会带 seq，这里原样保留）。
  const seq = Number.isInteger(msg.seq) ? msg.seq : undefined;
  return { id, role, content, ts, tokens, ...(seq != null ? { seq } : {}) };
}

function isValidRole(role) {
  return VALID_ROLES.has(role);
}

// Derive a short session title from the first user message (first ~20 chars).
function titleFromFirstMessage(messages) {
  const first = Array.isArray(messages) ? messages.find((m) => m && m.role === 'user') : null;
  const src = (first && (first.content || '')) || '';
  const clean = src.replace(/\s+/g, ' ').trim();
  if (!clean) return '新会话';
  return clean.length > 20 ? `${clean.slice(0, 20)  }…` : clean;
}

module.exports = {
  VALID_ROLES,
  estimateTokens,
  createMessageId,
  createSessionId,
  normalizeMessage,
  isValidRole,
  titleFromFirstMessage,
};
