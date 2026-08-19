/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 历史 / 会话 / 回滚 / 历史面板（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：historySessionMixin，含 11 个方法。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, historySessionMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

import { safeStorage } from '../../lib/storage.js';

export const historySessionMixin = {
  _loadHistory() {
    // Memory subsystem takes over session persistence server-side. When enabled,
    // the current session's messages are loaded via Q.MemorySession.init()
    // (which fires onSessionChange). Legacy localStorage is kept only as the
    // fallback for when the subsystem is disabled (MEMORY_ENABLED=false).
    const Q = window.QCLI || {};
    if (Q.MemorySession && Q.MemorySession.enabled) return;
    const msgs = safeStorage.getJSON('qcli-chat-history');
    if (Array.isArray(msgs) && msgs.length > 0) {
      this.messages = msgs;
      const welcome = this.msgsEl?.querySelector('.welcome-msg');
      if (welcome) welcome.remove();
      this.renderAll();
    }
  },

  _saveHistory() {
    // When the memory subsystem owns persistence, do nothing here — the server
    // stores messages. Otherwise keep the legacy localStorage backup.
    const Q = window.QCLI || {};
    if (Q.MemorySession && Q.MemorySession.enabled) return;
    const toSave = this.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    safeStorage.setJSON('qcli-chat-history', toSave.slice(-50));
  },

  // Stable per-message id so the server can idempotently merge re-sent history.
  _genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  },

  // Apply a server session's messages to the panel (called on load / switch).
  _applySession(id, msgs) {
    // 发送进行中（含 ensureCurrent 异步解析）不要覆盖本地已渲染的消息，
    // 否则刚发出的带附件消息会被“发送前”的服务器会话覆盖而消失。
    if (this.sending) return;
    const Q = window.QCLI || {};
    const arr = Array.isArray(msgs) ? msgs : [];
    this.messages = arr.map(m => ({
      id: (m && m.id) || this._genId(),
      role: (m && m.role) || 'assistant',
      content: (m && m.content != null) ? String(m.content) : '',
      ...(m && Array.isArray(m.attachments) ? { attachments: m.attachments } : {}),
      // 回滚改良：透传服务端打在该消息上的 seq（该消息所基于的检查点），
      // 使消息气泡可渲染「重新编辑 / 重新生成」按钮；无 seq 则不显示。
      ...(m && Number.isInteger(m.seq) ? { seq: m.seq } : {}),
    }));
    // Always re-render, even for an empty session — otherwise the stale DOM
    // from the previously-viewed session lingers in the panel.
    this.renderAll();
    if (this.messages.length === 0 && this.msgsEl && !this.msgsEl.querySelector('.welcome-msg')) {
      this.msgsEl.innerHTML = `
        <div class="chat-message welcome-msg">
          <div class="msg-avatar ai-avatar">🤖</div>
          <div class="msg-content">
            <div class="msg-sender">${Q.__?.('chat.sender.ai') || "AI Assistant"}</div>
            <div class="msg-bubble ai-bubble">${Q.__?.('chat.welcome') || "Hello! I'm your AI assistant. How can I help you?"}</div>
          </div>
        </div>`;
    }
    this.scrollToBottom();
    // 切换会话/刷新：从服务端 session.turnMetrics 重建节省累计（单一数据源）。
    // 这样重启服务/刷新页面后，图标与收益条都能恢复，且回滚后经 _applySession 自动回退。
    if (Q.MemorySession && Q.MemorySession.enabled && id) {
      fetch('/api/memory/sessions/' + encodeURIComponent(id))
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (s) this._seedSavingsFromTurnMetrics(s.turnMetrics, id); })
        .catch(() => {});
    } else {
      this._sessionSavings = { saved: 0, used: 0 };
      this.updateSavingsIcon(id);
    }
  },

  // M2b (v0.3.1): 回滚到上一轮检查点（撤销本轮，恢复本轮开始前的安全态）
  // turn 传数字 → 回滚到指定轮次（多轮回滚）；不传 → 兼容 ⏪ 回滚一轮。
  async rollbackSession(turn) {
    const id = this._sessionId;
    if (!id) { console.warn('[ChatPanel] 无会话可回滚（未启用服务端会话持久化）'); return; }
    if (this.sending) return;
    try {
      const resp = await fetch(`/api/memory/sessions/${encodeURIComponent(id)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof turn === 'number' ? { turn } : {}),
      });
      if (!resp.ok) { console.warn('[ChatPanel] 回滚失败', resp.status); return; }
      const data = await resp.json();
      if (!data || !data.ok) { console.warn('[ChatPanel] 无检查点可回滚'); return; }
      this._applySession(id, data.messages || []);
      this._closeHistoryPanel();
    } catch (e) {
      console.warn('[ChatPanel] 回滚错误', e && e.message);
    }
  },

  // Phase 2：回滚前二次确认（列出将还原/删除的文件副作用）
  async confirmRollback(seq) {
    const id = this._sessionId;
    if (!id || this.sending) return;
    let files = [];
    try {
      const resp = await fetch(`/api/memory/sessions/${encodeURIComponent(id)}/rollback-preview?seq=${encodeURIComponent(seq)}`);
      if (resp.ok) { const d = await resp.json(); files = (d && d.files) || []; }
    } catch (e) {
      console.warn('[ChatPanel] 回滚预览失败（直接回滚）', e && e.message);
    }
    if (!files.length) return this.rollbackSession(seq); // 无文件副作用 → 直接回滚
    this._showRollbackConfirm(seq, files);
  },

  _showRollbackConfirm(seq, files) {
    this._closeRollbackConfirm();
    const overlay = document.createElement('div');
    overlay.className = 'chat-rollback-confirm-overlay';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) this._closeRollbackConfirm(); });
    const box = document.createElement('div');
    box.className = 'chat-rollback-confirm-box';
    const title = document.createElement('div');
    title.className = 'chat-rollback-confirm-title';
    title.textContent = `回滚到 #${seq} 将影响以下文件`;
    const listEl = document.createElement('div');
    listEl.className = 'chat-rollback-confirm-list';
    files.forEach((f) => {
      const row = document.createElement('div');
      row.className = `chat-rollback-confirm-item fx-${f.action}`;
      const tag = document.createElement('span');
      tag.className = 'chat-rollback-confirm-tag';
      tag.textContent = f.action === 'delete' ? '删除' : f.action === 'restore' ? '还原' : '过大·跳过';
      const p = document.createElement('span');
      p.className = 'chat-rollback-confirm-path';
      p.textContent = f.path;
      row.appendChild(tag); row.appendChild(p);
      listEl.appendChild(row);
    });
    const hint = document.createElement('div');
    hint.className = 'chat-rollback-confirm-hint';
    hint.textContent = '确认后将把以上文件恢复到该轮开始时的状态（覆盖回滚期间的新改动）。对话内容同步回滚。';
    const actions = document.createElement('div');
    actions.className = 'chat-rollback-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chat-rollback-confirm-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this._closeRollbackConfirm());
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'chat-rollback-confirm-ok';
    ok.textContent = '确认回滚';
    ok.addEventListener('click', () => {
      this._closeRollbackConfirm();
      this.rollbackSession(seq);
    });
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(title); box.appendChild(listEl); box.appendChild(hint); box.appendChild(actions);
    overlay.appendChild(box);
    const host = this.el || document.getElementById('chat-drawer');
    if (host) host.appendChild(overlay);
  },

  _closeRollbackConfirm() {
    const stray = document.querySelector('.chat-rollback-confirm-overlay');
    if (stray) stray.remove();
  },

  // 🕘 多轮回滚：打开历史轮次选择浮层
  async openHistoryPanel() {
    const id = this._sessionId;
    if (!id) { console.warn('[ChatPanel] 无会话（未启用服务端会话持久化）'); return; }
    this._closeHistoryPanel();
    let list = [];
    try {
      const resp = await fetch(`/api/memory/sessions/${encodeURIComponent(id)}/checkpoints`);
      if (resp.ok) { const d = await resp.json(); list = (d && d.checkpoints) || []; }
    } catch (e) { console.warn('[ChatPanel] 读取检查点失败', e && e.message); }
    const overlay = this._renderHistoryPanel(list);
    const host = this.el || document.getElementById('chat-drawer');
    if (host) host.appendChild(overlay);
  },

  // 渲染轮次面板（纯 textContent，避免 XSS）
  _renderHistoryPanel(list) {
    const overlay = document.createElement('div');
    overlay.className = 'chat-history-overlay';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) this._closeHistoryPanel(); });
    const box = document.createElement('div');
    box.className = 'chat-history-panel';
    const title = document.createElement('div');
    title.className = 'chat-history-title';
    title.textContent = '历史轮次回滚';
    const close = document.createElement('button');
    close.className = 'chat-history-close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', () => this._closeHistoryPanel());
    title.appendChild(close);
    box.appendChild(title);
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-history-empty';
      empty.textContent = '暂无检查点（先发送几轮对话）';
      box.appendChild(empty);
    } else {
      const ul = document.createElement('div');
      ul.className = 'chat-history-list';
      list.slice().reverse().forEach((c) => { // 倒序：最新轮在上
        const item = document.createElement('button');
        item.className = 'chat-history-item';
        item.type = 'button';
        const seq = document.createElement('span');
        seq.className = 'chat-history-seq';
        seq.textContent = `#${c.seq}`;
        const label = document.createElement('span');
        label.className = 'chat-history-label';
        label.textContent = c.label || '初始';
        const time = document.createElement('span');
        time.className = 'chat-history-time';
        time.textContent = c.ts ? new Date(c.ts).toLocaleString() : '';
        item.appendChild(seq); item.appendChild(label); item.appendChild(time);
        item.addEventListener('click', () => this.confirmRollback(c.seq));
        ul.appendChild(item);
      });
      box.appendChild(ul);
    }
    overlay.appendChild(box);
    return overlay;
  },

  _closeHistoryPanel() {
    const stray = document.querySelector('.chat-history-overlay');
    if (stray) stray.remove();
  },
};
