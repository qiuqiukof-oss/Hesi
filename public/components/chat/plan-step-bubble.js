/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Plan 步骤气泡（P1：把执行步骤并入对话时间线）
//
// 背景：原实现在 plan_start 时 append 一整张卡片，之后所有步骤在卡片
// **内部**就地更新；而讨论/审批/错误气泡是独立 append 到消息流末尾的。
// 用户视线在底部，进度却在顶部悄悄变 —— 这就是「不同步」的物理来源。
//
// 本模块把「一个步骤」渲染成一条独立气泡，按发生顺序 append 到消息流，
// 与讨论/审批气泡共用同一条时间线。总览条仍由 plan-stream.js 负责。
//
// 安全：步骤输出一律 textContent 写入 <pre>，不走 markdown/innerHTML
//       （命令输出可能含任意字符，不应被解释为 HTML）。
// ============================================================
'use strict';

/** 步骤状态 → { icon, label, cls }。plan-stream.js 也从这里取，保持单一真源。 */
export const STEP_STATE = {
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

export function stateOf(status) {
  return STEP_STATE[status] || { icon: '•', label: String(status || ''), cls: 'pending' };
}

/** 终态集合：到这些状态就停表、计入进度分子。 */
const TERMINAL = new Set([
  'done', 'completed', 'error', 'failed', 'blocked',
  'rejected', 'aborted', 'budget', 'loop', 'timeout', 'skipped',
]);

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

export const planStepBubbleMixin = {
  /** 事件 → 步骤唯一键（id 优先，退化到 #index）。 */
  _planStepKey(ev) {
    if (!ev) return '';
    if (ev.id) return String(ev.id);
    if (ev.stepId) return String(ev.stepId);
    if (typeof ev.index === 'number') return `#${ev.index}`;
    return '';
  },

  /**
   * 取（必要时创建）某步骤的气泡。
   * 乱序保护：终态事件先于 start 到达时，也能补建气泡后直接回填终态。
   * @returns {{root:HTMLElement,bubble:HTMLElement,icon:HTMLElement,badge:HTMLElement,head:HTMLElement,stateEl:HTMLElement,t0:number}|null}
   */
  _planEnsureStepBubble(ev) {
    if (!this.msgsEl) return null;
    if (!this._planStepBubbles) this._planStepBubbles = new Map();
    const key = this._planStepKey(ev);
    const existing = key && this._planStepBubbles.get(key);
    if (existing) return existing;

    this._planStepSeq = (this._planStepSeq || 0) + 1;
    const seq = typeof ev.index === 'number' ? ev.index + 1 : this._planStepSeq;
    const total = this._planTotalSteps || 0;

    const root = document.createElement('div');
    root.className = 'chat-message plan-message plan-step-message running';
    if (key) root.dataset.stepKey = key;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar plan-avatar plan-step-avatar';
    avatar.textContent = '⏳';
    root.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender plan-sender';
    sender.appendChild(document.createTextNode(total ? `步骤 ${seq}/${total} · ` : `步骤 ${seq} · `));
    const stateEl = document.createElement('span');
    stateEl.className = 'plan-step-state';
    stateEl.textContent = '执行中';
    sender.appendChild(stateEl);
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble plan-bubble plan-step-bubble';

    const head = document.createElement('div');
    head.className = 'plan-step-head';

    const icon = document.createElement('span');
    icon.className = 'plan-step-icon';
    icon.textContent = '⏳';
    head.appendChild(icon);

    const goal = document.createElement('span');
    goal.className = 'plan-step-goal';
    goal.textContent = ev.goal || ev.reason || key || '(步骤)';
    head.appendChild(goal);

    const badge = document.createElement('span');
    badge.className = 'plan-step-badge';
    badge.textContent = '执行中';
    head.appendChild(badge);

    bubble.appendChild(head);
    content.appendChild(bubble);
    root.appendChild(content);
    this.msgsEl.appendChild(root);

    const handle = { root, bubble, icon, badge, head, stateEl, goal, t0: Date.now(), key };
    if (key) this._planStepBubbles.set(key, handle);
    return handle;
  },

  /** 步骤 start：补 cwd chip / action / 输出区，并置为当前活跃气泡。 */
  _planStartStepBubble(ev) {
    const h = this._planEnsureStepBubble(ev);
    if (!h) return null;
    this._planActiveBubble = h;

    // Plan C：显示当前工作目录（cwd 跨步延续后可能非项目根），让用户看清命令落点
    if (ev.cwd && !h.head.querySelector('.plan-step-cwd')) {
      const chip = document.createElement('span');
      chip.className = 'plan-step-cwd';
      chip.textContent = `📂 ${ev.cwd}`;
      h.head.appendChild(chip);
    }

    if (ev.action && !h.bubble.querySelector('.plan-step-action')) {
      const act = document.createElement('code');
      act.className = 'plan-step-action';
      act.textContent = ev.action;
      h.bubble.appendChild(act);
    }

    const pre = this._planStepOutputPre(h);
    pre.textContent = ev.notice ? `⏳ ${ev.notice}` : '';
    return h;
  },

  /** 回填终态：图标/徽章/边框色 + 耗时。 */
  _planFinishStepBubble(h, ev) {
    if (!h) return;
    const st = stateOf(ev.status);
    const secs = h.t0 ? `${((Date.now() - h.t0) / 1000).toFixed(1)}s` : '';
    h.root.className = `chat-message plan-message plan-step-message ${st.cls}`;
    h.icon.textContent = st.icon;
    h.badge.textContent = ev.reason ? `${st.label} · ${ev.reason}` : st.label;
    h.stateEl.textContent = secs ? `${st.label} · ${secs}` : st.label;

    if (typeof ev.output === 'string' && ev.output.trim()) {
      const pre = this._planStepOutputPre(h);
      pre.textContent = ev.output;
      if (ev.outputTruncated) {
        const sum = pre.closest('details') && pre.closest('details').querySelector('summary');
        if (sum) sum.textContent = `输出（已截断，原长 ${ev.outputFullLength} 字符）`;
      }
    }

    if (typeof ev.stack === 'string' && ev.stack.trim() && !h.bubble.querySelector('.plan-step-stack')) {
      const det = document.createElement('details');
      det.className = 'plan-step-output plan-step-stack';
      const sum = document.createElement('summary');
      sum.textContent = '📋 查看堆栈';
      det.appendChild(sum);
      const pre = document.createElement('pre');
      pre.textContent = ev.stack.slice(0, 2000);
      det.appendChild(pre);
      h.bubble.appendChild(det);
    }

    if (this._planActiveBubble === h) this._planActiveBubble = null;
  },

  /** 取（必要时建）步骤气泡的输出 <pre>（折叠 details 内）。 */
  _planStepOutputPre(h) {
    let det = h.bubble.querySelector('details.plan-step-output:not(.plan-step-stack)');
    if (!det) {
      det = document.createElement('details');
      det.className = 'plan-step-output';
      const sum = document.createElement('summary');
      sum.textContent = '输出';
      det.appendChild(sum);
      det.appendChild(document.createElement('pre'));
      h.bubble.appendChild(det);
    }
    return det.querySelector('pre');
  },

  /** 增量输出：优先按 key 命中，找不到则落到当前活跃气泡（乱序兜底）。 */
  _planAppendStepChunk(ev, text) {
    if (!text) return;
    const key = this._planStepKey(ev);
    const h = (key && this._planStepBubbles && this._planStepBubbles.get(key)) || this._planActiveBubble;
    if (!h) return; // 找不到归属 → 丢弃，绝不建脏 DOM
    const pre = this._planStepOutputPre(h);
    pre.textContent += text;
    const det = pre.closest('details');
    if (det && !det.open) det.open = true;
  },

  /** 清空本轮步骤气泡状态（收尾时调用；DOM 保留在对话流里）。 */
  _planResetStepBubbles() {
    this._planStepBubbles = null;
    this._planActiveBubble = null;
    this._planStepSeq = 0;
    this._planTotalSteps = 0;
  },
};
