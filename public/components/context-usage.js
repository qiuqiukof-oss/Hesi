// ============================================================
// context-usage — pure computation for the header context-usage ring
//
// P0.6（0.4 Phase 0）：单会话上下文窗口占用率显示。
// 数据来自 GET /api/chat/context-usage（v0.3.1 P1 幽灵截断治理落地的
// contextEstimate + ContextWindowManager 三层窗口策略）。
// 本模块只做纯计算（几何/色阶/文案），DOM 由 chat-panel 应用 ——
// 与 savings-icon.js 同款模式，共享圆环几何常量保证视觉一致。
//
// 色阶是「健康度」语义（占用越高越警示），非涨跌色：
//   <60% 绿 / 60–85% 黄 / 85–95% 橙 / ≥95% 红
// ============================================================
// @ts-check
'use strict';

import { RING_RADIUS, RING_CIRCUMFERENCE, fmtTokens } from './savings-icon.js';

export { RING_RADIUS, RING_CIRCUMFERENCE };

/** 色阶边界（含下界）→ [minPct, color, level] */
const LEVELS = [
  [95, '#c62828', 'critical'],
  [85, '#ef6c00', 'danger'],
  [60, '#f9a825', 'warn'],
  [0, '#2e7d32', 'normal'],
];

/** 窗口来源 → 中文说明（tooltip 用） */
const SOURCE_LABELS = {
  'effective-context': '手动 HESI_EFFECTIVE_CONTEXT',
  'model-map': '模型映射表',
  'fallback': '默认回退(200k)',
};

/**
 * @typedef {Object} ContextUsageData
 * @property {number} [contextEstimate]  当前上下文 token 估算
 * @property {number} [windowTokens]     有效窗口上限
 * @property {number} [compactThreshold] 压缩触发阈值
 * @property {string} [model]            模型名
 * @property {string} [source]           窗口来源
 */

/**
 * Compute the context-usage ring presentation.
 * @param {ContextUsageData} [d]
 * @returns {{ pct: number, strokeDasharray: string, strokeDashoffset: string,
 *             color: string, level: string, title: string, active: boolean }}
 */
export function computeContextUsage(d) {
  const src = d || {};
  const used = Number.isFinite(src.contextEstimate) && src.contextEstimate > 0 ? src.contextEstimate : 0;
  const win = Number.isFinite(src.windowTokens) && src.windowTokens > 0 ? src.windowTokens : 0;

  // pct 保留 1 位小数；圆环填充按上限 100 截断（估算可能瞬时超窗）
  const rawPct = win > 0 ? (used / win) * 100 : 0;
  const pct = Math.round(rawPct * 10) / 10;
  const fillPct = Math.min(pct, 100);

  let color = LEVELS[LEVELS.length - 1][1];
  let level = LEVELS[LEVELS.length - 1][2];
  for (const [min, c, l] of LEVELS) {
    if (pct >= Number(min)) { color = String(c); level = String(l); break; }
  }

  const C = RING_CIRCUMFERENCE;
  const parts = [];
  if (win > 0) {
    parts.push(`上下文占用 ${fmtTokens(used)} / 窗口 ${fmtTokens(win)}（${pct}%）`);
    if (Number.isFinite(src.compactThreshold) && src.compactThreshold > 0) {
      parts.push(`压缩阈值 ${fmtTokens(src.compactThreshold)}${used >= src.compactThreshold ? '（已达标，将触发压缩）' : ''}`);
    }
    if (src.model) parts.push(`模型 ${src.model}`);
    const sl = SOURCE_LABELS[src.source || ''] || null;
    if (sl) parts.push(`窗口来源：${sl}`);
    if (level === 'critical') parts.push('⚠ 接近窗口上限，建议开新会话或等待自动压缩');
  } else {
    parts.push('暂无上下文占用数据');
  }

  return {
    pct,
    strokeDasharray: C.toFixed(2),
    strokeDashoffset: (C * (1 - fillPct / 100)).toFixed(2),
    color,
    level,
    title: parts.join(' · '),
    active: win > 0 && used > 0,
  };
}
