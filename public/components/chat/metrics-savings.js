/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 指标 / 节省展示（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：metricsSavingsMixin，含 6 个方法。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, metricsSavingsMixin) 挂回。
//
// 纯计算部分已在 P2.1 抽至 ./benefit-bar.js / ./savings-icon.js /
// ./context-usage.js；本模块只负责 DOM 装配与事件绑定。
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

import { buildBenefitBar } from '../benefit-bar.js';
import { computeSavings } from '../savings-icon.js';
import { computeContextUsage } from '../context-usage.js';
import { safeStorage } from '../../lib/storage.js';

export const metricsSavingsMixin = {
  renderRoundBenefit(m) {
    const msgsEl = this.msgsEl;
    if (!msgsEl || !m) return;
    // 只保留一条：移除上一轮收益条
    const existing = msgsEl.querySelector('.hesi-round-benefit');
    if (existing) existing.remove();

    // 纯计算部分抽至 ./benefit-bar.js（P2.1）；此处只负责 DOM 创建与事件绑定。
    const built = buildBenefitBar(m);
    if (!built) return; // 全为 0 不渲染，避免噪声

    const bar = document.createElement('div');
    bar.className = 'hesi-round-benefit';
    bar.innerHTML = built.innerHtml;

    const toggle = bar.querySelector('.rb-detail-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => bar.classList.toggle('open'));
    }

    msgsEl.appendChild(bar);
    this.scrollToBottom();
  },

  // ── 会话级 token 节省百分比图标（M5 后续增强）──
  // ── 会话级节省记账（v0.3.1 后续：持久化到 session.turnMetrics，单一数据源）──

  /** 从服务端 session.turnMetrics 求和，种子化当前会话的累计节省（刷新/切会话/回滚时调用） */
  _seedSavingsFromTurnMetrics(turnMetrics, sessionId) {
    let saved = 0, used = 0, compact = 0;
    if (Array.isArray(turnMetrics)) {
      for (const t of turnMetrics) {
        saved += (t.saved != null ? t.saved : (t.estSaved || 0));
        used += (t.used != null ? t.used : (t.actualUsed || 0));
        compact += (t.compactCount || 0);
      }
    }
    this._sessionSavings = { saved, used, compact };
    if (sessionId) {
      this.updateSavingsIcon(sessionId);
      this.updateContextUsage(sessionId); // P0.6：切会话/刷新时同步占用率
    }
  },

  /** 构建本轮收益对象（与后端日志/收益条同口径） */
  _buildTurnMetric() {
    const rm = this._roundMetrics || {};
    const estSaved = (rm.cacheRead || 0) + (rm.toolReuse || 0) * 800 + (rm.exp || 0) * 1500;
    return {
      ts: Date.now(),
      cacheRead: rm.cacheRead || 0,
      cacheWrite: rm.cacheWrite || 0,
      toolReuse: rm.toolReuse || 0,
      exp: rm.exp || 0,
      skills: rm.skills || 0,
      compactCount: rm.compactCount || 0,
      compactedMsgs: rm.compactedMsgs || 0,
      estSaved,
      actualUsed: this._roundUsed,
    };
  },

  /** 本轮结束：持久化收益到服务端 + 累加内存累计并刷新图标（弃用 safeStorage，改为单一数据源） */
  _recordTurnMetrics(sessionId) {
    if (!sessionId) return;
    const metric = this._buildTurnMetric();
    // 累加进内存累计（轮内实时更新图标，refresh/回滚时由 _seedSavingsFromTurnMetrics 重建）
    if (!this._sessionSavings) this._sessionSavings = { saved: 0, used: 0 };
    this._sessionSavings.saved += metric.estSaved;
    this._sessionSavings.used += metric.actualUsed;
    this.updateSavingsIcon(sessionId);
    // P0.6 主路径：一轮完整回复后拉取最新占用率（stream 结束后 contextEstimate 已写回）
    this.updateContextUsage(sessionId);
    // best-effort 持久化到服务端 session.turnMetrics
    if (window.QCLI?.MemorySession?.recordTurnMetrics) {
      window.QCLI.MemorySession.recordTurnMetrics(sessionId, metric).catch(() => {});
    }
  },

  /** 刷新头部百分比圆环图标（对应单独会话，切换时即时更新） */
  updateSavingsIcon(sessionId) {
    const btn = this.savingsBtn;
    if (!btn) return;
    // 纯计算部分抽至 ./savings-icon.js（P2.1）；此处只负责写 DOM。
    const v = computeSavings(this._sessionSavings);
    const pctEl = btn.querySelector('.savings-pct');
    if (pctEl) pctEl.textContent = v.pct + '%';
    const fill = btn.querySelector('.savings-fill');
    if (fill) {
      fill.style.strokeDasharray = v.strokeDasharray;
      fill.style.strokeDashoffset = v.strokeDashoffset;
      fill.style.opacity = v.fillOpacity;
    }
    btn.title = v.title;
    btn.classList.toggle('active', v.active);
  },

  /**
   * P0.6：刷新头部上下文占用率圆环（第二个圆环，色阶=健康度）。
   * 数据来自只读端点 /api/chat/context-usage；失败静默——占用显示是增强，
   * 绝不打扰主聊天流程。不常驻轮询：仅在一轮完成 / 切会话时调用。
   */
  async updateContextUsage(sessionId) {
    const btn = this.contextBtn;
    if (!btn || !sessionId) return;
    try {
      let model = '';
      try { model = safeStorage.get('qcli-ai-model', '') || ''; } catch { /* ignore */ }
      const qs = `sessionId=${encodeURIComponent(sessionId)}${model ? `&model=${encodeURIComponent(model)}` : ''}`;
      const r = await fetch(`/api/chat/context-usage?${qs}`);
      if (!r.ok) return;
      const data = await r.json();
      // 纯计算部分在 ./context-usage.js；此处只负责写 DOM（与 savings 同款分工）。
      const v = computeContextUsage(data);
      const pctEl = btn.querySelector('.savings-pct');
      if (pctEl) {
        pctEl.textContent = v.active ? `${Math.round(v.pct)}%` : '--';
        pctEl.style.color = v.active ? v.color : '';
      }
      const fill = btn.querySelector('.savings-fill');
      if (fill) {
        fill.style.strokeDasharray = v.strokeDasharray;
        fill.style.strokeDashoffset = v.strokeDashoffset;
        fill.style.stroke = v.color;
        fill.style.opacity = v.active ? '1' : '0.25';
      }
      btn.title = v.title;
      btn.classList.toggle('active', v.active);
    } catch { /* 静默降级 */ }
  },
};
