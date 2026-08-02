/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// savings-icon — pure computation for the header savings ring icon
//
// Extracted from chat-panel.updateSavingsIcon (P2.1). Given the session's
// cumulative { saved, used, compact } token accounting, computes the ring
// geometry (SVG stroke dash), the percentage label, the tooltip text and the
// active flag. The component applies these to the DOM. Behavior is identical
// to the previous inline logic.
// ============================================================
// @ts-check
'use strict';

/** Ring radius (px) — must match the SVG circle r in the header button. */
export const RING_RADIUS = 24;
/** Circumference for r=24 (≈150.8). */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Compact number formatter: 1234 -> "1.2k". @param {number} n */
export function fmtTokens(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

/**
 * @typedef {Object} SessionSavings
 * @property {number} [saved]
 * @property {number} [used]
 * @property {number} [compact]
 */

/**
 * Compute the savings-icon presentation from cumulative session savings.
 * @param {SessionSavings} [s]
 * @returns {{ pct: number, strokeDasharray: string, strokeDashoffset: string, fillOpacity: string, title: string, active: boolean }}
 */
export function computeSavings(s) {
  const src = s || { saved: 0, used: 0, compact: 0 };
  const saved = src.saved || 0;
  const used = src.used || 0;
  const compact = src.compact || 0;
  const total = saved + used;
  const pct = total > 0 ? Math.round((saved / total) * 100) : 0;

  const C = RING_CIRCUMFERENCE;
  const fmt = fmtTokens;
  const title = total > 0
    ? `本会话已节省 ≈${fmt(saved)} tokens / 实际消耗 ${fmt(used)} tokens（约 ${pct}% 来自缓存命中 / 工具复用 / 经验命中）${compact > 0 ? ` · 上下文压缩 ${compact} 次` : ''}`
    : '本会话暂无节省记录';

  return {
    pct,
    strokeDasharray: C.toFixed(2),
    strokeDashoffset: (C * (1 - pct / 100)).toFixed(2),
    fillOpacity: pct > 0 ? '1' : '0.25',
    title,
    active: pct > 0,
  };
}
