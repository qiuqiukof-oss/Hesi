/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Automatic summary compaction. Replaces the legacy trimHistory truncation:
// when a session grows past the working window / token threshold, the oldest
// messages are summarized (via llm-bridge) and rolled into `summary`, and the
// raw old segment is dropped. Degrades to "keep raw" when no LLM is available.
'use strict';

const config = require('./config');
const session = require('./session');
const archive = require('./archive');
const indexStore = require('./index-store');
const llm = require('./llm-bridge');
const embed = require('./embed');
const { ContextWindowManager } = require('../context-window');

// P1 S1/S2：窗口管理器（读 env，派生动态阈值）。模型名未命中且未设 env 时
// 回落 200000 窗口 → 阈值 60000，与 v0.3.1 一致。
const cwManager = new ContextWindowManager();

// 完整的上下文 token 量：优先用 index.js 回写的 contextEstimate（含 system+记忆+
// 技能+历史+工具+附件），否则回落历史 tokenEstimate（旧 session 缺字段时）。
function effectiveEstimate(s) {
  if (s && Number.isFinite(s.contextEstimate) && s.contextEstimate > 0) return s.contextEstimate;
  return s && Number.isFinite(s.tokenEstimate) ? s.tokenEstimate : 0;
}

// Decide whether compaction should run for a session.
function shouldCompact(s, now = Date.now()) {
  if (!s) return false;
  const est = effectiveEstimate(s);
  const threshold = cwManager.compactThreshold(s.model);
  if (est > threshold) return true;
  // Idle trigger: summary is old, but the session was recently active.
  if (
    s.summaryUpdatedAt &&
    now - s.summaryUpdatedAt > config.IDLE_COMPACT_MS &&
    now - s.updatedAt < config.IDLE_COMPACT_MS
  ) {
    return true;
  }
  return false;
}

async function compactIfNeeded(sessionId, opts = {}) {
  if (!config.MEMORY_ENABLED) return { skipped: true, reason: 'disabled' };
  const s = session.load(sessionId);
  if (!s) return { skipped: true, reason: 'no-session' };
  if (s.messages.length <= s.workingWindow) return { skipped: true, reason: 'within-window' };
  if (!shouldCompact(s) && s.messages.length <= s.workingWindow + 4) {
    // Small overflow that hasn't crossed a real trigger — leave it.
    return { skipped: true, reason: 'below-threshold' };
  }

  // v0.3.1 A3：切点边界守卫——纯按条数切可能落在 assistant(tool_calls) 与
  // tool 结果之间，摘要后保留段首条成「孤儿 tool 消息」污染后续请求。
  // 修法：切点从 (len - workingWindow) 起向后顺延到下一条 user 边界；
  // 找不到（保留段内无 user，极端全工具轮）则跳过本次压缩，等下轮 user 消息。
  let cut = s.messages.length - s.workingWindow;
  while (cut < s.messages.length && s.messages[cut].role !== 'user') cut++;
  if (cut >= s.messages.length) {
    return { skipped: true, reason: 'no-user-boundary' };
  }

  const oldSeg = s.messages.slice(0, cut);
  if (oldSeg.length === 0) return { skipped: true, reason: 'nothing-to-compact' };
  const oldSegText = oldSeg.map((m) => `[${m.role}] ${m.content || ''}`).join('\n');

  const summary = await llm.summarize(oldSegText, s.summary || '', opts);
  if (!summary) {
    // LLM unavailable → do not compress; keep the raw messages (legacy fallback).
    return { degraded: true, reason: 'llm-unavailable' };
  }

  // 传 dropCount=cut：精确丢弃已摘要的旧段（即使摘要期间有新消息追加也不误删）。
  await session.applySummary(sessionId, summary, cut);

  // Refresh this session's retrieval index entry (summary changed).
  const updated = session.load(sessionId);
  if (updated) {
    const doc = archive.sessionDoc(updated);
    if (embed.enabled()) doc.vec = await embed.embed(doc.text);
    indexStore.upsert(doc);
  }
  return { compacted: true, dropped: oldSeg.length, summaryLength: summary.length };
}

module.exports = { shouldCompact, compactIfNeeded };
