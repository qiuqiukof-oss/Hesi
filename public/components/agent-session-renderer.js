// ============================================================
// AgentSessionRenderer — Agent 实时输出渲染
//
// 从 chat-panel.js 中提取，负责 Agent 事件（agent_start/
// agent_output/agent_input/agent_done/agent_error/
// agent_cancelled/agent_timeout/agent_callback）的 DOM 渲染
// 和回呼徽章管理。
//
// 用法:
//   const renderer = new AgentSessionRenderer(chatPanel);
//   renderer.onAgentMetric(data);  // 处理 SSE 事件
//   renderer.flushAgentBuffer();  // 刷新缓冲事件
//   renderer.clear();             // 清理所有 session
// ============================================================
// @ts-check
'use strict';

class AgentSessionRenderer {
  /**
   * @param {Object} host - 宿主 ChatPanel 实例，需提供 scrollToBottom()
   */
  constructor(host) {
    /** @type {Object} */
    this._host = host;

    /**
     * Map<sessionId, { agent:string, status:string, headerEl:Element|null, textEl:Element|null, callbacks?:Array }>
     * @type {Map<string, {agent:string, status:string, headerEl:Element|null, textEl:Element|null, callbacks?:Array<{callbackId:string, question:string, answered:boolean}>}>}
     */
    this._agentSessions = new Map();

    /** @type {Array<{data: *}>} */
    this._agentOutputBuffer = [];
  }

  // ── 公共入口 ──

  /**
   * Agent 事件统一入口（从 ws-router 经由 Q.ChatUI.onAgentMetric 转发）
   * @param {{ ev:string, agent?:string, sessionId?:string, data?:*, error?:string, exitCode?:number, callbackId?:string, question?:string }} data
   */
  onAgentMetric(data) {
    if (!data || !data.ev) return;

    const ev = data.ev;
    const agent = data.agent || 'agent';
    const sessionId = data.sessionId || agent;

    // ── 确保 thinking-indicator 存在（不存在则缓冲） ──
    const ensureSessionsContainer = () => {
      const indicator = document.getElementById('thinking-indicator');
      if (!indicator) {
        this._agentOutputBuffer.push({ data });
        return null;
      }
      const bubble = indicator.querySelector('.msg-bubble');
      if (!bubble) return null;

      let sessionsEl = bubble.querySelector('.agent-sessions');
      if (!sessionsEl) {
        sessionsEl = document.createElement('div');
        sessionsEl.className = 'agent-sessions';
        const statusEl = bubble.querySelector('.thinking-status');
        if (statusEl) {
          statusEl.parentNode.insertBefore(sessionsEl, statusEl.nextSibling);
        } else {
          bubble.appendChild(sessionsEl);
        }
      }
      return sessionsEl;
    };

    /** 获取或创建单个 Session 的容器行 */
    const getSessionRow = (sessionsEl) => {
      if (!sessionsEl) return null;

      let row = sessionsEl.querySelector(`.agent-session-${CSS.escape(sessionId)}`);
      if (!row) {
        row = document.createElement('div');
        row.className = `agent-session agent-session-${CSS.escape(sessionId)}`;
        row.dataset.sessionId = sessionId;
        row.innerHTML = '<div class="agent-session-header"></div><pre class="agent-session-text"></pre>';
        sessionsEl.appendChild(row);
      }
      return row;
    };

    // ── 处理不同事件类型 ──

    if (ev === 'agent_start') {
      this._agentSessions.set(sessionId, { agent, status: 'starting', headerEl: null, textEl: null });

      const sessionsEl = ensureSessionsContainer();
      if (!sessionsEl) return;

      const row = getSessionRow(sessionsEl);
      if (row) {
        const header = row.querySelector('.agent-session-header');
        const text = row.querySelector('.agent-session-text');
        if (header) {
          header.textContent = `⚡ ${agent} 工作中...`;
          header.dataset.status = 'running';
        }
        if (text) text.textContent = '';
        const session = this._agentSessions.get(sessionId);
        if (session) {
          session.status = 'starting';
          session.headerEl = header;
          session.textEl = text;
        }
        row.style.display = '';
        this._scrollToBottom();
      }

    } else if (ev === 'agent_output') {
      const session = this._agentSessions.get(sessionId);
      if (!session || session.status === 'done' || session.status === 'error' ||
          session.status === 'cancelled' || session.status === 'timeout') return;

      if (session.status === 'starting') session.status = 'running';

      if (session.textEl) {
        const chunk = data.data || '';
        session.textEl.textContent += chunk;
        if (session.textEl.textContent.length > 4000) {
          session.textEl.textContent = '[...输出过长，省略部分内容...]\n' + session.textEl.textContent.slice(-2000);
        }
        this._scrollToBottom();
      }

    } else if (ev === 'agent_input') {
      const session = this._agentSessions.get(sessionId);
      if (!session || session.status === 'done' || session.status === 'error' ||
          session.status === 'cancelled' || session.status === 'timeout') return;

      // 标记该 session 的所有待处理回呼为已回答
      if (session.callbacks && session.callbacks.length > 0) {
        const hadPending = session.callbacks.some(c => !c.answered);
        if (hadPending) {
          for (const cb of session.callbacks) {
            if (!cb.answered) { cb.answered = true; cb.answeredAt = Date.now(); }
          }
          if (session.headerEl) {
            const badge = session.headerEl.querySelector('.agent-callback-badge');
            if (badge) {
              badge.className = 'agent-callback-badge answered';
              badge.textContent = '✅ 已回复';
              badge.title = '';
              clearTimeout(badge._removeTimer);
              badge._removeTimer = setTimeout(() => { if (badge) badge.remove(); }, 3000);
            }
          }
        }
      }

      // 在 header 中显示输入指示
      if (session.headerEl) {
        let hint = session.headerEl.querySelector('.agent-input-hint');
        if (!hint) {
          hint = document.createElement('span');
          hint.className = 'agent-input-hint';
          session.headerEl.appendChild(hint);
        }
        const inputPreview = (data.input || '').slice(0, 60);
        hint.textContent = ` 📨 已发送: "${inputPreview}${data.input?.length > 60 ? '...' : ''}"`;
        clearTimeout(hint._fadeTimer);
        hint._fadeTimer = setTimeout(() => {
          hint.classList.add('fading');
          setTimeout(() => { if (hint) hint.remove(); }, 600);
        }, 3000);
      }

    } else if (ev === 'agent_done') {
      const session = this._agentSessions.get(sessionId);
      if (!session) return;
      session.status = 'done';
      if (session.headerEl) {
        const exitCode = data.exitCode;
        const icon = exitCode === 0 ? '✅' : '⚠️';
        session.headerEl.textContent = `${icon} ${agent} 已完成 (exit: ${exitCode})`;
        session.headerEl.dataset.status = 'done';
      }

    } else if (ev === 'agent_error') {
      const session = this._agentSessions.get(sessionId);
      if (!session) return;
      session.status = 'error';
      if (session.headerEl) {
        session.headerEl.textContent = `❌ ${agent} 出错: ${data.error || '未知错误'}`;
        session.headerEl.dataset.status = 'error';
      }

    } else if (ev === 'agent_cancelled') {
      const session = this._agentSessions.get(sessionId);
      if (!session) return;
      session.status = 'cancelled';
      if (session.headerEl) {
        session.headerEl.textContent = `⏹️ ${agent} 已取消`;
        session.headerEl.dataset.status = 'cancelled';
      }

    } else if (ev === 'agent_timeout') {
      const session = this._agentSessions.get(sessionId);
      if (!session) return;
      session.status = 'timeout';
      if (session.headerEl) {
        session.headerEl.textContent = `⏱️ ${agent} 已超时`;
        session.headerEl.dataset.status = 'timeout';
      }

    } else if (ev === 'agent_callback') {
      const session = this._agentSessions.get(sessionId);
      if (!session) return;
      const callbackId = data.callbackId || '';
      const question = data.question || '';

      if (!session.callbacks) session.callbacks = [];
      session.callbacks.push({ callbackId, question, answered: false });

      if (session.headerEl) {
        let badge = session.headerEl.querySelector('.agent-callback-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'agent-callback-badge pending';
          session.headerEl.appendChild(badge);
        }
        const unanswered = session.callbacks.filter(c => !c.answered).length;
        badge.textContent = `💬 ${unanswered} 个求助`;
        badge.title = question.slice(0, 300);
      }
    }
  }

  // ── 缓冲刷新 ──

  /** 当 thinking-indicator 就绪时，刷新所有缓冲的 Agent 事件 */
  flushAgentBuffer() {
    if (this._agentOutputBuffer.length === 0) return;
    const buf = this._agentOutputBuffer;
    this._agentOutputBuffer = [];
    for (const item of buf) {
      this.onAgentMetric(item.data);
    }
  }

  // ── 清理 ──

  /** 清空所有 session 状态和缓冲 */
  clear() {
    this._agentSessions.clear();
    this._agentOutputBuffer = [];
  }

  // ── 内部 ──

  /** 委托到宿主的 scrollToBottom */
  _scrollToBottom() {
    if (this._host && typeof this._host.scrollToBottom === 'function') {
      this._host.scrollToBottom();
    }
  }
}

export default AgentSessionRenderer;
