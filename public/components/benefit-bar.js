/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// benefit-bar — pure builder for the per-round "回合收益" bar
//
// Extracted from chat-panel.renderRoundBenefit (P2.1). This is the
// side-effect-free part: given a round-metrics object it computes the
// estimated saved tokens and the bar's innerHTML, or null when there is
// nothing worth showing. The DOM creation + event wiring stays in the
// component. Behavior is identical to the previous inline logic.
// ============================================================
// @ts-check
'use strict';

/** Compact number formatter: 1234 -> "1.2k". @param {number} n */
export function fmtTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

/**
 * @typedef {Object} RoundMetrics
 * @property {number} [cacheReadTokens]
 * @property {number} [cacheCreationTokens]
 * @property {number} [toolCacheHits]
 * @property {number} [experienceHits]
 * @property {number} [skillsInjected]
 * @property {number} [compactCount]
 */

/**
 * Build the round-benefit bar HTML from metrics.
 * @param {RoundMetrics} m
 * @returns {{ innerHtml: string, estSaved: number } | null} null when all-zero (render nothing).
 */
export function buildBenefitBar(m) {
  if (!m) return null;
  const fmt = fmtTokens;
  const cacheTok = m.cacheReadTokens || 0;
  const cacheCreate = m.cacheCreationTokens || 0;
  const toolHits = m.toolCacheHits || 0;
  const expHits = m.experienceHits || 0;
  const skills = m.skillsInjected || 0;
  const compact = m.compactCount || 0;

  // 估算节省 token：缓存命中(直接计入) + 工具复用(估 ~800/次) + 经验命中避免重试(估 ~1500/次)。
  // 技能注入属「精准注入、省全量 prompt」，不直接计为节省（避免误导），仅展示计数。
  const estSaved = cacheTok + toolHits * 800 + expHits * 1500;

  const parts = [];
  if (cacheTok > 0) parts.push(`💾 缓存命中 ${fmt(cacheTok)} tokens`);
  if (cacheCreate > 0) parts.push(`🆕 缓存写入 ${fmt(cacheCreate)} tokens`);
  if (toolHits > 0) parts.push(`⚡ 工具复用 ${toolHits} 次`);
  if (expHits > 0) parts.push(`🧠 经验 ${expHits}`);
  if (skills > 0) parts.push(`🎯 注入技能 ${skills}`);
  if (compact > 0) parts.push(`🗜️ 上下文压缩 ${compact} 次`);
  if (parts.length === 0) return null; // 全为 0 不渲染，避免噪声

  const innerHtml =
    `<span class="rb-title">📊 本轮回合收益</span> ${parts.join('<span class="rb-sep"> · </span> ')}` +
    (estSaved > 0 ? ` <span class="rb-sep">·</span> <span class="rb-item">≈ 节省 ${fmt(estSaved)} tokens</span>` : '') +
    ` <span class="rb-detail-toggle">详情</span>` +
    `<div class="rb-detail">缓存读取 ${cacheTok} · 缓存写入 ${cacheCreate} · 工具复用 ${toolHits} · 经验命中 ${expHits} · 注入技能 ${skills} · 上下文压缩 ${compact} 次` +
    `<br>估算节省 = 缓存读取 ${cacheTok} + 工具复用×800 + 经验命中×1500（仅供参考，真实值以缓存读取为准）</div>`;

  return { innerHtml, estSaved };
}
