/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2.1 记忆时间轴 —— 纯函数组件（零 DOM 副作用、可单测）
// 范式：computeTimeline(session) 纯计算 + renderMemoryTimeline(container, sessionId) 渲染
// 复用 docs/context-usage.md 的「纯函数组件」约定（与 savings-icon.js 同款）。
// 入 main bundle（import 于 main.js）。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/**
 * 纯函数：从时间轴数据派生统计信息（节点数、压缩点、角色分布、时间跨度）。
 * @param {{events?:Array<any>, turns?:Array<any>}} data
 */
export function computeTimeline(data) {
  const events = Array.isArray(data && data.events) ? data.events : [];
  const byRole = {};
  let checkpoints = 0;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue; // 容错：跳过非对象条目
    if (e.kind === 'checkpoint') { checkpoints++; continue; }
    if (e.kind === 'message') byRole[e.role] = (byRole[e.role] || 0) + 1;
  }
  const tsList = events.map((e) => (e && e.ts) || 0).filter(Boolean);
  return {
    total: events.length,
    checkpoints,
    byRole,
    firstTs: tsList.length ? Math.min.apply(null, tsList) : 0,
    lastTs: tsList.length ? Math.max.apply(null, tsList) : 0,
  };
}

/**
 * 渲染记忆时间轴到指定容器。
 * @param {HTMLElement} container
 * @param {string} sessionId
 */
export async function renderMemoryTimeline(container, sessionId) {
  if (!container) return;
  if (!sessionId) {
    container.innerHTML = '<div class="tl-empty">未选择会话，无法加载时间轴。先在左侧选一个会话或发一条消息。</div>';
    return;
  }
  container.innerHTML = '<div class="tl-loading">加载时间轴…</div>';
  let data;
  try {
    const r = await fetch('/api/memory/sessions/' + encodeURIComponent(sessionId) + '/timeline');
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  } catch (e) {
    container.innerHTML = '<div class="tl-empty">加载失败：' + escapeHtml(e.message) + '</div>';
    return;
  }
  const events = Array.isArray(data.events) ? data.events : [];
  const turns = Array.isArray(data.turns) ? data.turns : [];
  if (!events.length && !turns.length) {
    container.innerHTML = '<div class="tl-empty">该会话暂无时间轴数据（还没有消息或压缩检查点）。</div>';
    return;
  }

  const summary = computeTimeline(data);
  const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '');

  let html = '<div class="tl-summary">'
    + '<span>事件 ' + summary.total + '</span>'
    + '<span>🧊 压缩点 ' + summary.checkpoints + '</span>';
  if (summary.firstTs) html += '<span>' + escapeHtml(fmt(summary.firstTs)) + ' 起</span>';
  html += '</div>';

  html += '<div class="tl-track">';
  for (const e of events) {
    const isCk = e.kind === 'checkpoint';
    const cls = isCk ? 'tl-node checkpoint' : ('tl-node ' + (e.role === 'user' ? 'user' : 'assistant'));
    const dot = isCk ? '🧊' : (e.role === 'user' ? '🙋' : '🤖');
    const title = isCk
      ? ('压缩检查点 #' + e.seq + (e.label ? '：' + e.label : ''))
      : (String(e.role) + (e.tokens ? ' · ' + e.tokens + ' tok' : ''));
    html += '<div class="' + cls + '">'
      + '<div class="tl-dot">' + dot + '</div>'
      + '<div class="tl-card" data-ts="' + (e.ts || 0) + '">'
      + '<div class="tl-time">' + escapeHtml(fmt(e.ts)) + '</div>'
      + '<div class="tl-title">' + escapeHtml(title) + '</div>'
      + (e.preview ? '<div class="tl-preview">' + escapeHtml(e.preview) + '</div>' : '')
      + '</div></div>';
  }
  if (turns.length) {
    let totalSaved = 0;
    let totalUsed = 0;
    for (const t of turns) { totalSaved += (t.estSaved || 0); totalUsed += (t.actualUsed || 0); }
    html += '<div class="tl-node savings">'
      + '<div class="tl-dot">💡</div>'
      + '<div class="tl-card"><div class="tl-title">收益累计（' + turns.length + ' 轮）</div>'
      + '<div class="tl-preview">估算节省 ' + Math.round(totalSaved) + ' tok · 实际消耗 ' + Math.round(totalUsed) + ' tok</div>'
      + '</div></div>';
  }
  html += '</div>';
  container.innerHTML = html;

  // 点击卡片展开/收起长预览
  container.querySelectorAll('.tl-card').forEach((card) => {
    const preview = card.querySelector('.tl-preview');
    if (!preview) return;
    card.classList.add('collapsed');
    card.addEventListener('click', () => card.classList.toggle('collapsed'));
  });
}

const MemoryTimeline = { renderMemoryTimeline, computeTimeline };
if (typeof window !== 'undefined' && window.QCLI) window.QCLI.MemoryTimeline = MemoryTimeline;
export default MemoryTimeline;
