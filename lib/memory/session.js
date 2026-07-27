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
    // M5 后续增强：每轮收益（缓存命中/工具复用/经验/技能/估算节省/实际消耗）累计，
    // 存 session 顶层（NOT 单条 message——schema.normalizeMessage 会剥掉未知字段）。
    turnMetrics: [],
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
    // S2：上下文估算字段初始化（仅首次）。若 index.js 已回写真实上下文量则保留，
    // 不覆盖——append 只追加消息，真实估算由 index 每轮组装完整请求后写回。
    if (!Number.isFinite(session.contextEstimate)) {
      session.contextEstimate = session.tokenEstimate;
    }
    if (session.title === '新会话') {
      const t = schema.titleFromFirstMessage(session.messages);
      if (t !== '新会话') session.title = t;
    }
    if (meta.model) session.model = meta.model;
    if (meta.provider) session.provider = meta.provider;
    return save(session);
  });
}

// Apply a compaction result: store the summary and trim raw messages.
// dropCount（可选，v0.3.1 A3）：由 compaction 计算的精确丢弃条数（已对齐 user
// 边界），保证保留段首条不会是孤儿 tool 消息；不传则回落旧行为（按窗口切尾）。
function applySummary(id, summary, dropCount) {
  return storage.withLock(id, () => {
    const session = load(id);
    if (!session) return null;
    session.summary = summary;
    session.summaryUpdatedAt = Date.now();
    if (Number.isInteger(dropCount) && dropCount > 0) {
      session.messages = session.messages.slice(dropCount);
      session.tokenEstimate = session.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);
      session.contextEstimate = session.tokenEstimate; // 压缩后历史变小，旧上下文估算过时→回落，等下一轮 index 写回
    } else if (session.messages.length > session.workingWindow) {
      session.messages = session.messages.slice(-session.workingWindow);
      session.tokenEstimate = session.messages.reduce((sum, m) => sum + (m.tokens || 0), 0);
      session.contextEstimate = session.tokenEstimate; // 同上
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

// M5 后续增强：追加一轮回合收益到 session.turnMetrics（单一数据源，刷新/回滚均可重建）。
function appendTurnMetrics(id, metrics) {
  return storage.withLock(id, () => {
    const session = load(id);
    if (!session) return null;
    if (!Array.isArray(session.turnMetrics)) session.turnMetrics = [];
    session.turnMetrics.push(metrics);
    return save(session);
  });
}

// S2：由 index.js 在组装完整请求（含 system + 记忆 + 技能 + 历史 + 工具定义 + 附件）
// 后回写真实上下文 token 量，供压缩阈值判断使用——根治 tokenEstimate 只算历史导致
// 压缩永不触发的「幽灵截断」。无效传入时：若自身已有有效估算则保留（不破坏上一轮
// 真值），否则回落 tokenEstimate。
function setContextEstimate(id, tokens) {
  return storage.withLock(id, () => {
    const s = load(id);
    if (!s) return null;
    if (Number.isFinite(tokens) && tokens > 0) {
      s.contextEstimate = tokens;
    } else if (!Number.isFinite(s.contextEstimate) || s.contextEstimate <= 0) {
      s.contextEstimate = s.tokenEstimate;
    }
    return save(s);
  });
}

// S2/S4：记录会话当前模型（供 compaction 据模型名派生窗口阈值）。
function setModel(id, model) {
  return storage.withLock(id, () => {
    const s = load(id);
    if (!s) return null;
    if (model) s.model = model;
    return save(s);
  });
}

module.exports = { filePath, load, save, ensure, append, mergeMessages, applySummary, checkpoint, rollback, appendTurnMetrics, setContextEstimate, setModel };
