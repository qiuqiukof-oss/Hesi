/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 「⚡ 自动执行」回合渲染（P2：Plan 执行器并入 AI 对话）
//
// 原型 mixin：planStreamMixin，含 _handlePlanEvent。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, planStreamMixin) 挂回。
//
// 与 _handleDiscussEvent 同构：后端 SSE 帧 → 一个常驻「执行卡片」气泡，
// 计划清单在 generated 时铺开，每个 plan_step 事件就地更新对应行的状态与输出。
//
// 安全：所有步骤输出一律 textContent 写入 <pre>，不走 markdown 渲染
//       （命令输出可能含任意字符，不应被解释为 HTML）。
// ============================================================
'use strict';

/** 步骤状态 → { icon, label, cls } */
const STEP_STATE = {
  pending: { icon: '○', label: '待执行', cls: 'pending' },
  start: { icon: '⏳', label: '执行中', cls: 'running' },
  done: { icon: '✅', label: '完成', cls: 'done' },
  completed: { icon: '✅', label: '完成', cls: 'done' },
  error: { icon: '❌', label: '失败', cls: 'error' },
  failed: { icon: '❌', label: '失败', cls: 'error' },
  blocked: { icon: '⛔', label: '已拦截', cls: 'blocked' },
  rejected: { icon: '🚫', label: '驳回', cls: 'blocked' },
  aborted: { icon: '⏹', label: '已中止', cls: 'blocked' },
  budget: { icon: '⚠️', label: '超预算', cls: 'warn' },
  loop: { icon: '⚠️', label: '熔断', cls: 'warn' },
  timeout: { icon: '⚠️', label: '超时', cls: 'warn' },
  skipped: { icon: '⤼', label: '跳过', cls: 'pending' },
  'await-approval': { icon: '🔒', label: '待审批', cls: 'warn' },
};

function stateOf(status) {
  return STEP_STATE[status] || { icon: '•', label: String(status || ''), cls: 'pending' };
}

export const planStreamMixin = {
  /**
   * 处理一帧「自动执行」事件。
   * @param {{type:string,[k:string]:any}} evt 已剥掉 plan_ 前缀的事件
   */
  _handlePlanEvent(evt) {
    if (!this.msgsEl || !evt) return;
    const t = evt.type;

    if (t === 'start') {
      this.removeThinking();
      this._planCard = this._createPlanCard(evt.objective || '');
      this._planStepRows = new Map();
      this._planText = '';
      this.scrollToBottom();
      return;
    }

    if (t === 'phase' || t === 'phase_done') {
      if (evt.label) this._setPlanStatus(evt.label);
      return;
    }

    if (t === 'collab_summary') {
      const title = evt.title || '📋 讨论结论';
      const text = evt.text || '';
      if (text) this._planNote(`${title}\n${text}`, 'info');
      return;
    }

    // Fix #2: 协作流中讨论阶段业务错误（API Key 缺失/伙伴不可达）单独渲染：
    // 红色备注 + 不收尾卡片（让后续 plan_error / plan_done 继续走主流程）。
    if (t === 'discuss_error') {
      const msg = (evt && evt.message) || '讨论阶段出错';
      if (this._planCard) this._planNote(`⚠️ 讨论错误：${msg}`, 'warn');
      return;
    }

    // ⚠️ 兼容两种写法：后端 sseEventName 把连字符转下划线（await-approval→await_approval），
    // chat-api 剥 plan_ 前缀后前端拿到的是下划线版；直接发连字符版也保留（双保险）
    if (t === 'await-approval' || t === 'await_approval') {
      if (this._sessionAutoApprove) {
        // 用户已选择「本次会话始终允许」→ 自动通过，不弹气泡
        const execId = (evt.step && evt.step.execId) || '';
        if (execId) fetch('/api/plan/' + encodeURIComponent(execId) + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      } else {
        this._renderApprovalBubble(evt.step);
        this.scrollToBottom();
      }
      return;
    }

    if (t === 'approval-resolved' || t === 'approval_resolved') {
      this._updateApprovalBubble(evt);
      this.scrollToBottomIfNear();
      return;
    }

    if (t === 'error') {
      this._renderErrorBubble(evt);
      this.scrollToBottom();
      if (this._planCard) this._finishPlanCard({ ok: false, status: 'error' }, true);
      return;
    }

    if (t === 'cancelled') {
      if (this._planCard) {
        this._planNote('⏹ ' + (evt.reason || '客户端断开'), 'warn');
        this._finishPlanCard({ ok: false, status: 'cancelled' }, true);
      }
      return;
    }

    if (!this._planCard) return; // 未开卡（异常序）→ 忽略，避免脏 DOM

    if (t === 'status') {
      this._setPlanStatus(evt.message || '');
    } else if (t === 'generated') {
      this._renderPlanSteps(evt);
    } else if (t === 'step') {
      this._updatePlanStep(evt);
    } else if (t === 'step_chunk') {
      // P3：命令型步骤的 stdout/stderr 增量帧，逐块追加到对应步骤输出区（真流式）
      this._appendPlanChunk(evt);
    } else if (t === 'chat_token') {
      this._appendPlanLive(evt.content || '');
    } else if (t === 'chat_status') {
      this._setPlanStatus(evt.message || '');
    } else if (t === 'done') {
      this._finishPlanCard(evt);
    }
    this.scrollToBottomIfNear();
  },

  // ── DOM 构造 ──

  _createPlanCard(objective) {
    const div = document.createElement('div');
    div.className = 'chat-message plan-message';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar plan-avatar';
    avatar.textContent = '⚡';
    div.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender plan-sender';
    sender.appendChild(document.createTextNode('自动执行 · '));
    const statusEl = document.createElement('span');
    statusEl.className = 'plan-status-text';
    statusEl.textContent = '准备中…';
    sender.appendChild(statusEl);
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble plan-bubble';

    if (objective) {
      const obj = document.createElement('div');
      obj.className = 'plan-objective';
      obj.textContent = objective;
      bubble.appendChild(obj);
    }

    const list = document.createElement('ol');
    list.className = 'plan-steps';
    bubble.appendChild(list);

    const notes = document.createElement('div');
    notes.className = 'plan-notes';
    bubble.appendChild(notes);

    content.appendChild(bubble);
    div.appendChild(content);
    this.msgsEl.appendChild(div);

    return { root: div, statusEl, bubble, list, notes };
  },

  _setPlanStatus(text) {
    if (this._planCard && this._planCard.statusEl) this._planCard.statusEl.textContent = text;
  },

  _renderPlanSteps(evt) {
    const card = this._planCard;
    if (!card) return;
    card.list.innerHTML = '';
    this._planStepRows = new Map();
    const steps = Array.isArray(evt.steps) ? evt.steps : [];
    this._setPlanStatus(`已拆解 ${steps.length} 步，开始执行…`);
    for (const s of steps) {
      const li = document.createElement('li');
      li.className = 'plan-step pending';
      li.dataset.stepId = s.id || '';

      const head = document.createElement('div');
      head.className = 'plan-step-head';

      const icon = document.createElement('span');
      icon.className = 'plan-step-icon';
      icon.textContent = '○';
      head.appendChild(icon);

      const goal = document.createElement('span');
      goal.className = 'plan-step-goal';
      goal.textContent = s.goal || s.id || '';
      head.appendChild(goal);

      const badge = document.createElement('span');
      badge.className = 'plan-step-badge';
      badge.textContent = '待执行';
      head.appendChild(badge);

      li.appendChild(head);

      if (s.action) {
        const act = document.createElement('code');
        act.className = 'plan-step-action';
        act.textContent = s.action;
        li.appendChild(act);
      }

      card.list.appendChild(li);
      this._planStepRows.set(s.id || `#${s.index}`, { li, icon, badge });
      if (typeof s.index === 'number') this._planStepRows.set(`#${s.index}`, { li, icon, badge });
    }
  },

  _updatePlanStep(ev) {
    const card = this._planCard;
    if (!card) return;
    const key = ev.id || (typeof ev.index === 'number' ? `#${ev.index}` : '');
    let row = this._planStepRows.get(key);
    // Plan 被 autoReplan 改写过 → 清单里没有这一行，补一条，绝不丢事件
    if (!row) {
      const li = document.createElement('li');
      li.className = 'plan-step pending';
      const head = document.createElement('div');
      head.className = 'plan-step-head';
      const icon = document.createElement('span');
      icon.className = 'plan-step-icon';
      const goal = document.createElement('span');
      goal.className = 'plan-step-goal';
      goal.textContent = ev.goal || ev.reason || key || '(新步骤)';
      const badge = document.createElement('span');
      badge.className = 'plan-step-badge';
      head.appendChild(icon); head.appendChild(goal); head.appendChild(badge);
      li.appendChild(head);
      card.list.appendChild(li);
      row = { li, icon, badge };
      if (key) this._planStepRows.set(key, row);
    }

    // 闸门驳回是 LLM 生成 plan 最常见的失败模式：必须把「缺什么」说清楚，
    // 否则用户只看到一个「驳回」不知所措。
    if (ev.status === 'rejected' && Array.isArray(ev.missing) && ev.missing.length) {
      this._planNote(`🚫 计划未通过可验证性闸门，缺少可机器验证的：${ev.missing.join('、')}`, 'warn');
    }

    const st = stateOf(ev.status);
    row.li.className = `plan-step ${st.cls}`;
    row.icon.textContent = st.icon;
    row.badge.textContent = ev.reason ? `${st.label} · ${ev.reason}` : st.label;
    this._setPlanStatus(`${st.label}：${ev.goal || key}`);
    this._planActiveRow = row;

    if (ev.status === 'start') {
      // 为轨道 B（AI 管线）的实时 token 预留输出区
      this._planLiveEl = this._ensureStepOutput(row.li);
      this._planLiveEl.textContent = '';
      return;
    }

    if (typeof ev.output === 'string' && ev.output.trim()) {
      const pre = this._ensureStepOutput(row.li);
      pre.textContent = ev.output;
      if (ev.outputTruncated) {
      const det = pre.closest('details');
      const sum = det && det.querySelector('summary');
      if (sum) sum.textContent = `输出（已截断，原长 ${ev.outputFullLength} 字符）`;
      }
    }
    if (typeof ev.stack === 'string' && ev.stack.trim()) {
      const li = row.li;
      let stackDet = li.querySelector('details.plan-step-stack');
      if (!stackDet) {
        stackDet = document.createElement('details');
        stackDet.className = 'plan-step-output plan-step-stack';
        const sum = document.createElement('summary');
        sum.textContent = '📋 查看堆栈';
        stackDet.appendChild(sum);
        const pre = document.createElement('pre');
        pre.textContent = ev.stack.slice(0, 2000);
        stackDet.appendChild(pre);
        li.appendChild(stackDet);
      }
    }
    this._planLiveEl = null;
  },

  _ensureStepOutput(li) {
    let det = li.querySelector('details.plan-step-output');
    if (!det) {
      det = document.createElement('details');
      det.className = 'plan-step-output';
      const sum = document.createElement('summary');
      sum.textContent = '输出';
      det.appendChild(sum);
      const pre = document.createElement('pre');
      det.appendChild(pre);
      li.appendChild(det);
    }
    return det.querySelector('pre');
  },

  _appendPlanLive(text) {
    if (!this._planLiveEl || !text) return;
    this._planLiveEl.textContent += text;
    const det = this._planLiveEl.closest('details');
    if (det && !det.open) det.open = true;
  },

  /** P3：命令型步骤的 stdout/stderr 增量帧，逐块追加到对应步骤输出 <pre>。 */
  _appendPlanChunk(evt) {
    const card = this._planCard;
    if (!card || !evt || typeof evt.chunk !== 'string' || !evt.chunk) return;
    const key = evt.stepId || (typeof evt.index === 'number' ? `#${evt.index}` : '');
    const row = (key && this._planStepRows && this._planStepRows.get(key)) || this._planActiveRow || null;
    if (!row) return;
    const pre = this._ensureStepOutput(row.li);
    pre.textContent += evt.chunk;
    const det = pre.closest('details');
    if (det && !det.open) det.open = true;
    this.scrollToBottomIfNear();
  },

  _planNote(text, kind) {
    const card = this._planCard;
    if (!card) return;
    const p = document.createElement('div');
    p.className = `plan-note plan-note-${kind || 'info'}`;
    p.textContent = text;
    card.notes.appendChild(p);
  },

  /** P4-2：渲染审批闸内联对话气泡（Approve/Reject 按钮）。 */
  _renderApprovalBubble(step) {
    if (!step || !this.msgsEl) return;
    const execId = step.execId || '';
    const goal = (step.goal || step.id || '').slice(0, 200);
    const action = typeof step.action === 'string' ? step.action.slice(0, 300) : '';
    const risk = step.risk ? ('风险：' + step.risk) : '';

    const div = document.createElement('div');
    div.className = 'chat-message plan-message plan-approval';
    div.innerHTML =
      '<div class="msg-avatar plan-avatar" style="background:#f59e0b">🔒</div>' +
      '<div class="msg-content"><div class="msg-sender plan-sender">审批闸 · 需人工确认</div>' +
      '<div class="msg-bubble plan-bubble plan-approval-bubble">' +
      '<div class="plan-approval-goal">' + this._escapeHtml(goal) + '</div>' +
      (action ? '<code class="plan-approval-action">' + this._escapeHtml(action) + '</code>' : '') +
      (risk ? '<div class="plan-approval-risk">' + this._escapeHtml(risk) + '</div>' : '') +
      '<div class="plan-approval-btns">' +
      '<button class="plan-ag-approve btn btn-primary btn-sm" type="button">✅ 通过</button>' +
      '<button class="plan-ag-always btn btn-sm" type="button">⚡ 本次会话始终允许</button>' +
      '<button class="plan-ag-reject btn btn-sm" type="button">⛔ 驳回并中止</button></div>' +
      '<div class="plan-approval-status"></div></div></div>';
    const bubble = div.querySelector('.plan-approval-bubble');
    div.querySelector('.plan-ag-approve').addEventListener('click', () => this._resolveApproval(execId, 'approve', bubble));
    div.querySelector('.plan-ag-always').addEventListener('click', () => { this._sessionAutoApprove = true; this._resolveApproval(execId, 'approve', bubble); });
    div.querySelector('.plan-ag-reject').addEventListener('click', () => this._resolveApproval(execId, 'reject', bubble));
    this.msgsEl.appendChild(div);
    this._planApprovalEl = div;
  },

  /** P4-2：收到 approval-resolved 后更新气泡状态。 */
  _updateApprovalBubble(evt) {
    const el = this._planApprovalEl;
    if (!el) return;
    const status = el.querySelector('.plan-approval-status');
    if (status) {
      status.textContent = evt.timedOut ? '⏱ 超时（视为驳回），已中止'
        : (evt.approved === true ? '✅ 已通过，继续执行…' : '🚫 已驳回——当前步骤跳过，后续步骤中止');
      const btns = el.querySelectorAll('button');
      btns.forEach((b) => { b.disabled = true; });
    }
    this._planApprovalEl = null;
  },

  /** P4-3：渲染红色错误气泡到主对话线程（可展开堆栈）。 */
  _renderErrorBubble(evt) {
    if (!this.msgsEl) return;
    const msg = evt.message || '自动执行出错';
    const stack = typeof evt.stack === 'string' && evt.stack.trim() ? evt.stack : null;
    const div = document.createElement('div');
    div.className = 'chat-message plan-message plan-error-msg';
    div.innerHTML =
      '<div class="msg-avatar plan-avatar" style="background:#dc2626">❌</div>' +
      '<div class="msg-content">' +
      '<div class="msg-sender plan-sender">自动执行 · 错误</div>' +
      '<div class="msg-bubble plan-bubble plan-error-bubble">' +
      '<div class="plan-error-text">' + this._escapeHtml(msg) + '</div>' +
      (stack ? '<details class="plan-error-stack"><summary>📋 查看堆栈</summary><pre>' + this._escapeHtml(stack.slice(0, 2000)) + '</pre></details>' : '') +
      '</div></div>';
    this.msgsEl.appendChild(div);
  },

  /** P4-2：POST /api/plan/<execId>/approve|reject，状态由 approval-resolved 事件统一更新。 */
  async _resolveApproval(execId, kind, bubble) {
    const btns = bubble && bubble.querySelectorAll('button');
    if (btns) btns.forEach((b) => { b.disabled = true; });
    try {
      await fetch('/api/plan/' + encodeURIComponent(execId) + '/' + kind, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* 网络异常由 approval-resolved 事件覆盖，这里仅禁按钮 */ }
  },

  _escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /** 收尾：写终态、落盘到消息历史（供刷新后回看）。 */
  _finishPlanCard(evt, isFailure) {
    const card = this._planCard;
    if (!card) return;
    const ok = !!evt.ok;
    const status = evt.status || (ok ? 'done' : 'failed');
    const secs = evt.durationMs ? ` · ${(evt.durationMs / 1000).toFixed(1)}s` : '';
    this._setPlanStatus(`${ok ? '✅ 执行完成' : (isFailure ? '⏹ 已结束' : '⚠️ 未完成')} · ${status}${secs}`);
    card.root.classList.add(ok ? 'plan-ok' : 'plan-fail');

    if (evt.acceptance) {
      const acc = evt.acceptance;
      const passed = acc.ok === true || acc.passed === true;
      this._planNote(`${passed ? '✅' : '⚠️'} 验收：${passed ? '通过' : '未通过'}`, passed ? 'info' : 'warn');
    }
    if (evt.branch) this._planNote(`🌿 执行分支：${evt.branch}`, 'info');

    // 落盘：只存一条可读摘要，避免把整卡 DOM 塞进 localStorage
    const lines = [`⚡ 自动执行：${status}${secs}`];
    card.list.querySelectorAll('.plan-step').forEach((li) => {
      const goal = li.querySelector('.plan-step-goal');
      const badge = li.querySelector('.plan-step-badge');
      lines.push(`- ${(li.querySelector('.plan-step-icon') || {}).textContent || ''} ${goal ? goal.textContent : ''} · ${badge ? badge.textContent : ''}`);
    });
    card.notes.querySelectorAll('.plan-note').forEach((n) => lines.push(n.textContent));
    this.messages.push({ role: 'assistant', content: lines.join('\n'), _planSummary: true });
    this._saveHistory();

    this._planCard = null;
    this._planStepRows = null;
    this._planLiveEl = null;
    this._planActiveRow = null;
    this._planApprovalEl = null;
    this._sessionAutoApprove = false;
  },
};
