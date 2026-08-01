/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 历史查看器（P5：降级——执行/审批/讨论已全部并入 AI 对话）
//
// 打开抽屉 → 加载 /api/plan/history → 分页列表 + 状态过滤。
// 不再包含手动输入 plan、审批闸、讨论舞台等已被聊天 SSE 取代的功能。
// ============================================================
'use strict';

import { safeStorage } from '../lib/storage.js';

/** @type {any} */
const Q = window.QCLI = window.QCLI || {};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PlanDrawer = {
  root: null,
  rendered: false,
  _page: 1,
  _filter: 'all',
  _loading: false,

  _ensureRendered() {
    const root = document.getElementById('plan-embed');
    if (!root) return;
    this.root = root;
    if (this.rendered) return;
    const body = root.querySelector('.plan-embed-body');
    if (!body) return;

    body.innerHTML = `
      <div class="plan-toolbar">
        <h3 class="plan-embed-title">📋 Plan 历史</h3>
        <div class="plan-filter-row">
          <select id="plan-history-filter" class="plan-filter">
            <option value="all">全部</option>
            <option value="done">✅ 完成</option>
            <option value="partial">⚠️ 部分</option>
            <option value="diverged">↗ 偏离</option>
            <option value="error">❌ 失败</option>
            <option value="rejected">🚫 驳回</option>
            <option value="cancelled">⏹ 取消</option>
          </select>
        </div>
      </div>
      <div id="plan-history-list" class="plan-history"></div>
      <div id="plan-history-pager" class="plan-pager"></div>
    `;

    document.getElementById('plan-history-filter').addEventListener('change', (e) => {
      this._filter = e.target.value;
      this._page = 1;
      this._loadHistory();
    });

    this.rendered = true;
  },

  open() {
    this._ensureRendered();
    if (!this.root) return;
    this.root.classList.add('open');
    this._page = 1;
    this._loadHistory();
  },

  close() {
    if (this.root) this.root.classList.remove('open');
  },

  async _loadHistory() {
    if (this._loading) return;
    const list = document.getElementById('plan-history-list');
    const pager = document.getElementById('plan-history-pager');
    if (!list) return;
    this._loading = true;
    list.innerHTML = '<div class="plan-history-loading">加载中…</div>';

    try {
      const params = new URLSearchParams({ page: String(this._page), limit: '20' });
      if (this._filter && this._filter !== 'all') params.set('status', this._filter);
      const res = await fetch('/api/plan/history?' + params.toString());
      if (!res.ok) { list.innerHTML = '<div class="plan-history-empty">RAG 回流已关闭或请求失败</div>'; return; }
      const data = await res.json();
      this._renderHistory(data, list, pager);
    } catch (e) {
      list.innerHTML = '<div class="plan-history-empty">加载异常：' + esc(e.message) + '</div>';
    } finally {
      this._loading = false;
    }
  },

  _renderHistory(data, list, pager) {
    const items = data.items || [];
    if (!items.length) {
      list.innerHTML = '<div class="plan-history-empty">暂无记录</div>';
      pager.innerHTML = '';
      return;
    }

    const statusLabel = { done: '✅', partial: '⚠️', diverged: '↗', error: '❌', rejected: '🚫', cancelled: '⏹' };
    let html = '';
    for (const it of items) {
      const st = statusLabel[it.status] || '•';
      const title = esc(it.title || it.objective || '(无标题)');
      const ts = it.created_at ? new Date(it.created_at).toLocaleString() : '';
      html += `<div class="plan-history-item" data-id="${esc(it.exec_id || '')}">
        <div class="plan-history-meta">${st} <strong>${title}</strong><span class="plan-history-time">${esc(ts)}</span></div>
        <div class="plan-history-detail">状态：${esc(it.status || '?')} · 步骤：${it.step_count || 0} · Agent：${esc(it.agent_id || 'ai')}</div>
      </div>`;
    }
    list.innerHTML = html;

    // 分页
    const total = data.total || items.length;
    const totalPages = Math.ceil(total / (data.limit || 20));
    let phtml = '';
    phtml += `<button ${this._page <= 1 ? 'disabled' : ''} class="plan-page-btn" id="plan-prev">← 上一页</button>`;
    phtml += `<span class="plan-page-info">${this._page} / ${totalPages}</span>`;
    phtml += `<button ${this._page >= totalPages ? 'disabled' : ''} class="plan-page-btn" id="plan-next">下一页 →</button>`;
    pager.innerHTML = phtml;

    const prev = document.getElementById('plan-prev');
    const next = document.getElementById('plan-next');
    if (prev) prev.addEventListener('click', () => { if (this._page > 1) { this._page--; this._loadHistory(); } });
    if (next) next.addEventListener('click', () => { if (this._page < totalPages) { this._page++; this._loadHistory(); } });
  },
};

Q.PlanDrawer = PlanDrawer;
export default PlanDrawer;
