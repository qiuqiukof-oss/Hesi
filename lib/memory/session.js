// @ts-check
// Single-session model: load / save / idempotent append / working-window trim.
// All file IO goes through storage (atomic writes, corruption recovery).
'use strict';

const path = require('path');
const fs = require('fs');
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
    const merged = mergeMessages(session.messages, norm);
    // 回滚改良（P2）：给「本轮新生成的 assistant 消息」打 seq = 当前最大检查点 seq，
    // 使其可在消息气泡下「重新编辑 / 重新生成」（rollbackTo(seq) 恢复到该轮之前的状态）。
    // 既有消息保留其存储 seq（mergeMessages 已带入）；讨论/工具等无 seq 消息不显示按钮。
    const existingSeq = new Map(session.messages.map((m) => [m.id, m.seq]));
    const topSeq = (listCheckpoints(id) || []).reduce((mx, c) => Math.max(mx, c.seq), 0);
    session.messages = merged.map((m) => {
      const storedSeq = existingSeq.get(m.id);
      if (storedSeq != null) return { ...m, seq: storedSeq }; // 既有消息：用存储 seq（吞掉 incoming 无 seq）
      if (m.seq != null) return m;                              // 外部显式带 seq（罕见）→ 保留
      if (m.role === 'assistant') return { ...m, seq: topSeq }; // 本轮新 assistant → 打戳
      return m;
    });
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

// M2b (v0.3.1): 检查点 / 回滚。多轮回滚（栈模型）：
// checkpoint 把当前 session 复制为 <id>.ckpt.<seq>.json（seq 自增）；
// listCheckpoints 列出所有轮次；rollbackTo(seq) 把指定轮覆盖回 session 并丢弃其后未来态；
// rollback（无参）保留为「回滚一轮」兼容 ⏪ 按钮。
const CKPT_KEEP = 30;

function _ckptFiles(id) {
  let entries = [];
  try { entries = fs.readdirSync(config.SESSIONS_DIR); } catch (_e) { return []; }
  const idRe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const f of entries) {
    if (f === `${id}.ckpt.json`) {
      out.push({ file: f, seq: 0, legacy: true }); // 旧单槽兜底为 seq=0（初始态）
    } else {
      const m = f.match(new RegExp(`^${idRe}\\.ckpt\\.(\\d+)\\.json$`));
      if (m) out.push({ file: f, seq: parseInt(m[1], 10), legacy: false });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

function _ckptLabel(ckpt) {
  const msgs = Array.isArray(ckpt && ckpt.messages) ? ckpt.messages : [];
  const firstUser = msgs.find((m) => m && m.role === 'user');
  let text = '';
  if (firstUser) {
    const c = firstUser.content;
    text = typeof c === 'string' ? c : (c && typeof c === 'object' ? JSON.stringify(c) : '');
  }
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 30);
  return t || '初始';
}

function checkpoint(id) {
  const session = load(id);
  if (!session) return null;
  const files = _ckptFiles(id);
  const maxSeq = files.reduce((mx, f) => Math.max(mx, f.seq), 0);
  const seq = maxSeq + 1;
  const ckptPath = path.join(config.SESSIONS_DIR, `${id}.ckpt.${seq}.json`);
  storage.writeJSON(ckptPath, session);
  // prune：保留最近 CKPT_KEEP 个新栈检查点（不动 seq=0 初始/旧单槽）
  const stack = files.filter((f) => !f.legacy)
    .concat([{ file: `${id}.ckpt.${seq}.json`, seq, legacy: false }]);
  if (stack.length > CKPT_KEEP) {
    for (const ex of stack.slice(0, stack.length - CKPT_KEEP)) {
      if (ex.seq <= 0) continue;
      try { fs.unlinkSync(path.join(config.SESSIONS_DIR, ex.file)); } catch (_e) { /* ignore */ }
    }
  }
  return true;
}

function listCheckpoints(id) {
  const files = _ckptFiles(id);
  if (!files.length) return [];
  return files.map((f) => {
    const ckpt = storage.readJSON(path.join(config.SESSIONS_DIR, f.file), null) || {};
    return { seq: f.seq, ts: ckpt.updatedAt || ckpt.createdAt || 0, label: _ckptLabel(ckpt) };
  });
}

function rollbackTo(id, seq) {
  const files = _ckptFiles(id);
  const target = files.find((f) => f.seq === seq);
  if (!target) return null;
  const ckpt = storage.readJSON(path.join(config.SESSIONS_DIR, target.file), null);
  if (!ckpt) return null;
  const restored = { ...ckpt };
  delete restored.sideEffects; // 不把副作用回写进 session（避免下一轮 checkpoint 拷贝污染）
  save(restored); // 原子覆写回 session（含旧 turnMetrics → 前端 _applySession 重建 savings 联动）
  // Phase 2：还原文件写类副作用（K >= seq 的最早一轮快照）。失败静默降级，不影响对话回滚。
  try { restoreSideEffects(_collectSideEffects(id, seq)); } catch (fxErr) {
    console.warn('[rollback] file restore skipped (non-fatal):', fxErr && fxErr.message);
  }
  // 丢弃 seq 之后的「未来态」检查点（不保留 redo，简单安全）
  for (const f of files) {
    if (f.seq > seq) {
      try { fs.unlinkSync(path.join(config.SESSIONS_DIR, f.file)); } catch (_e) { /* ignore */ }
    }
  }
  return { messages: ckpt.messages || [], savings: ckpt.turnMetrics || [] };
}

// Phase 2：文件写类副作用还原。
// 收集检查点栈中 seq' >= seq 的所有 sideEffects，每个文件只取「最早一轮」(K 最小) 的快照，
// 因为该快照即代表该文件在目标检查点(seq)时刻的真实内容（seq 之前未被同轮修改）。
// 返回 { [absPath]: { before, isNew, skipped } } 或 null(目标不存在)。
function _collectSideEffects(id, seq) {
  const files = _ckptFiles(id);
  if (!files.some((f) => f.seq === seq)) return null;
  const merged = {};
  for (const f of files) {
    if (f.seq < seq) continue;
    const ckpt = storage.readJSON(path.join(config.SESSIONS_DIR, f.file), null);
    if (!ckpt || !ckpt.sideEffects) continue;
    for (const [p, fx] of Object.entries(ckpt.sideEffects)) {
      if (!merged[p]) merged[p] = fx; // 取最早一轮
    }
  }
  return merged;
}

function restoreSideEffects(merged) {
  if (!merged) return;
  for (const [p, fx] of Object.entries(merged)) {
    if (fx.skipped) continue; // 超大文件不还原（best-effort 边界）
    try {
      if (fx.isNew) {
        if (fs.existsSync(p)) fs.unlinkSync(p); // 新建的文件 → 删除
      } else {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, String(fx.before == null ? '' : fx.before), 'utf8'); // 覆盖回轮开始态
      }
    } catch (e) {
      console.warn('[rollback] restore file failed (kept on disk):', p, e && e.message);
    }
  }
}

// Phase 2：在执行 write_file 之前，把原文件内容快照挂到「当前轮检查点」的 sideEffects。
// - absPath：safeResolve 后的绝对路径
// - beforeContent：原内容（不存在则 isNew=true）
// - 同文件同轮只记第一次（保留轮开始态）；超阈值文件标记 skipped（回滚不还原，避免检查点膨胀）
const SIDE_EFFECT_MAX_BYTES = 256 * 1024;

function recordSideEffect(id, absPath, beforeContent, isNew) {
  const files = _ckptFiles(id);
  if (!files.length) return false; // 无检查点栈 = 非记忆会话，跳过
  const seq = files.reduce((mx, f) => Math.max(mx, f.seq), 0);
  const ckptPath = path.join(config.SESSIONS_DIR, `${id}.ckpt.${seq}.json`);
  if (!storage.exists(ckptPath)) return false;
  return storage.withLock(id, () => {
    const ckpt = storage.readJSON(ckptPath, null);
    if (!ckpt) return false;
    if (!ckpt.sideEffects) ckpt.sideEffects = {};
    if (ckpt.sideEffects[absPath]) return true; // 同轮已记（取轮开始态）
    if (isNew) {
      ckpt.sideEffects[absPath] = { before: null, isNew: true };
    } else {
      const bytes = Buffer.byteLength(String(beforeContent), 'utf8');
      if (bytes > SIDE_EFFECT_MAX_BYTES) {
        ckpt.sideEffects[absPath] = { skipped: true, isNew: false }; // best-effort 边界
      } else {
        ckpt.sideEffects[absPath] = { before: String(beforeContent), isNew: false };
      }
    }
    storage.writeJSON(ckptPath, ckpt);
    return true;
  });
}

// Phase 2：回滚前的副作用预览（供前端二次确认弹窗列出将还原/删除的文件）。
function getRollbackPreview(id, seq) {
  const merged = _collectSideEffects(id, seq);
  if (!merged) return [];
  const out = [];
  for (const [p, fx] of Object.entries(merged)) {
    if (fx.skipped) out.push({ path: p, action: 'unrestorable' });
    else if (fx.isNew) out.push({ path: p, action: 'delete' });
    else out.push({ path: p, action: 'restore' });
  }
  return out;
}

function rollback(id) {
  // 兼容 ⏪ 按钮：回滚到最新 seq 之前的一轮
  const files = _ckptFiles(id);
  if (!files.length) return null;
  const maxSeq = files[files.length - 1].seq;
  if (maxSeq <= 0) {
    const r = rollbackTo(id, 0);
    return r ? r.messages : null;
  }
  const r = rollbackTo(id, maxSeq - 1);
  return r ? r.messages : null;
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

module.exports = { filePath, load, save, ensure, append, mergeMessages, applySummary, checkpoint, listCheckpoints, rollbackTo, rollback, recordSideEffect, getRollbackPreview, appendTurnMetrics, setContextEstimate, setModel };
