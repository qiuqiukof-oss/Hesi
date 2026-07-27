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
const session = require('./session');

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
  // M2b (v0.3.1): 检查点 / 回滚
  checkpoint: (id) => session.checkpoint(id),
  rollback: (id) => session.rollback(id),
  // M5 后续增强：追加一轮回合收益到 session.turnMetrics（持久化收益条/图标）
  appendTurnMetrics: (id, m) => session.appendTurnMetrics(id, m),
  // P1 S4：index.js 组装完整请求后写回真实上下文 token 量（含 system + 记忆 + 技能
  // + 历史 + 附件文本），供压缩阈值判断——根治 tokenEstimate 只算历史导致压缩
  // 永不触发的「幽灵截断」。
  setContextEstimate: (id, tokens) => session.setContextEstimate(id, tokens),
  // P0.6：只读上下文占用信息（chat 头部占用率圆环消费，不改任何写入逻辑）
  getContextInfo: (id) => {
    const s = session.load(id);
    if (!s) return null;
    return {
      model: s.model || null,
      contextEstimate: (Number.isFinite(s.contextEstimate) && s.contextEstimate > 0)
        ? s.contextEstimate
        : (s.tokenEstimate || 0),
      tokenEstimate: s.tokenEstimate || 0,
    };
  },
};

module.exports = MemoryStore;
