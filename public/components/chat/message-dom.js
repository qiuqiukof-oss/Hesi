// ============================================================
// 渲染 / DOM（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：messageDomMixin，含 renderAll / _handleDiscussEvent /
// appendToDOM / scrollToBottom。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, messageDomMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

import { renderMarkdown } from '../message-render.js';

export const messageDomMixin = {
  renderAll() {
    if (!this.msgsEl) return;
    this.msgsEl.innerHTML = '';
    for (const msg of this.messages) {
      this.appendToDOM(msg, false);
    }
    this.scrollToBottom();
  },

  // ── AI 讨论模式：把每一轮发言渲染成独立、带标签的气泡 ──
  _handleDiscussEvent(evt) {
    if (!this.msgsEl) return;
    if (evt.type === 'start') {
      // 新发言方开始：移除思考指示器，开一个带标签的新气泡
      this.removeThinking();
      const Q = window.QCLI || {};
      const div = document.createElement('div');
      div.className = 'chat-message discuss-message discuss-' + (evt.speaker || 'ai');
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar discuss-avatar ' + (evt.speaker === 'cli' ? 'cli-avatar' : evt.speaker === 'summary' ? 'summary-avatar' : 'ai-avatar');
      avatar.textContent = evt.speaker === 'cli' ? '🟩' : evt.speaker === 'summary' ? '📋' : '🟦';
      div.appendChild(avatar);
      const content = document.createElement('div');
      content.className = 'msg-content';
      const sender = document.createElement('div');
      sender.className = 'msg-sender discuss-sender';
      const roundTxt = evt.round ? ` · 第 ${evt.round} 轮` : '';
      sender.textContent = (evt.label || 'AI 助手') + roundTxt;
      content.appendChild(sender);
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble discuss-bubble';
      content.appendChild(bubble);
      div.appendChild(content);
      this.msgsEl.appendChild(div);
      this._discussActive = true;
      this._activeDiscussBubble = bubble;
      this._discussText = '';
      this._discussPendingMsg = { role: evt.speaker === 'cli' ? 'tool' : 'assistant', content: '', _speaker: evt.speaker, _label: evt.label };
      this.scrollToBottom();
    } else if (evt.type === 'end') {
      // 发言结束：把气泡最终内容落盘到消息历史
      if (this._activeDiscussBubble) {
        this._activeDiscussBubble.innerHTML = renderMarkdown(this._discussText || '（无内容）');
        requestAnimationFrame(() => { if (window.QCLI?.MermaidRenderer) window.QCLI.MermaidRenderer.renderAll(); });
      }
      if (this._discussPendingMsg) {
        this._discussPendingMsg.content = this._discussText || '（无内容）';
        this.messages.push(this._discussPendingMsg);
      }
      this._discussActive = false;
      this._activeDiscussBubble = null;
      this._discussText = '';
      this._discussPendingMsg = null;
      this._saveHistory();
      this.scrollToBottom();
    } else if (evt.type === 'stats') {
      // 讨论结束后的 token 消耗报告（圆桌 vs 单模型 成本可见）
      const s = evt.stats || {};
      const agents = s.agents || 0;
      const rounds = s.rounds || 0;
      const cliEst = s.cliEstTokens || 0;
      const cliChars = s.cliOutputChars || 0;
      const div = document.createElement('div');
      div.className = 'chat-message discuss-message discuss-stats';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble discuss-stats-bubble';
      bubble.innerHTML = `<div class="discuss-stats-title">💱 本次讨论 token 消耗</div>`
        + `<div class="discuss-stats-row">AI 助手 / 汇总（API 精确）：输入 <b>${s.aiInputTokens || 0}</b> · 输出 <b>${s.aiOutputTokens || 0}</b></div>`
        + `<div class="discuss-stats-row">CLI Agent（${agents} 个 · ${rounds} 轮）：估算输出 ≈ <b>${cliEst}</b> token（${cliChars} 字符，其内部消耗未计入）</div>`
        + `<div class="discuss-stats-hint">提示：多 Agent 圆桌会随「Agent 数 × 轮数」近似超线性放大 token，质量提升并非免费。</div>`;
      div.appendChild(bubble);
      this.msgsEl.appendChild(div);
      this._saveHistory();
      this.scrollToBottom();
    }
  },

  appendToDOM(msg, animate = true) {
    if (!this.msgsEl) return;
    const Q = window.QCLI || {};
    const div = document.createElement('div');
    div.className = 'chat-message' + (msg.role === 'user' ? ' user-message' : '');
    if (!animate) div.style.animation = 'none';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar' + (msg.role === 'assistant' ? ' ai-avatar' : '');
    avatar.textContent = msg.role === 'user' ? '👤' : '🤖';
    div.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = msg.role === 'user' ? (Q.__?.('chat.sender.you') || 'You') : (Q.__?.('chat.sender.ai') || 'AI');
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + (msg.role === 'user' ? 'user-bubble' : 'ai-bubble');
    if (msg.role === 'assistant') {
      bubble.innerHTML = renderMarkdown(msg.content);
      // 渲染 Mermaid 流程图
      requestAnimationFrame(() => {
        if (window.QCLI?.MermaidRenderer) {
          window.QCLI.MermaidRenderer.renderAll();
        }
      });
    } else {
      if (Array.isArray(msg.attachments) && msg.attachments.length) {
        const attWrap = document.createElement('div');
        attWrap.className = 'msg-attachments';
        for (const a of msg.attachments) attWrap.appendChild(this._renderAttachmentItem(a));
        bubble.appendChild(attWrap);
      }
      if (msg.content) {
        const txt = document.createElement('div');
        txt.textContent = msg.content;
        bubble.appendChild(txt);
      }
    }
    content.appendChild(bubble);

    // 回滚改良（P2）：assistant 消息且服务端打了 seq 时，在气泡下方渲染操作区。
    // 纯 textContent 建节点（防 XSS）；无 seq（讨论/工具/旧消息）则不显示。
    if (msg.role === 'assistant' && Number.isInteger(msg.seq)) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'msg-action-btn msg-edit-btn';
      editBtn.textContent = '✎ 重新编辑';
      editBtn.title = '回滚到该轮之前并预填提问；发送后才执行回滚（发送前不回滚）';
      editBtn.addEventListener('click', () => this._startEditMode(msg));
      actions.appendChild(editBtn);

      const regenBtn = document.createElement('button');
      regenBtn.type = 'button';
      regenBtn.className = 'msg-action-btn msg-regen-btn';
      regenBtn.textContent = '↺ 重新生成';
      regenBtn.title = '回滚到该轮之前并用原提问重新生成';
      regenBtn.addEventListener('click', () => this._regenerate(msg));
      actions.appendChild(regenBtn);

      const histBtn = document.createElement('button');
      histBtn.type = 'button';
      histBtn.className = 'msg-action-btn msg-hist-btn';
      histBtn.textContent = '🕘 历史轮次';
      histBtn.title = '打开历史轮次面板（高级：回滚到任意一轮）';
      histBtn.addEventListener('click', () => this.openHistoryPanel());
      actions.appendChild(histBtn);

      content.appendChild(actions);
    }

    div.appendChild(content);
    this.msgsEl.appendChild(div);
  },

  scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.msgsEl) this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
    });
  },
};
