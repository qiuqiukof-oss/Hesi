/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Plan 实时 stdout 控制台（P0b：可视化方向）
//
// 背景：原实现把每步 stdout 折叠进步骤气泡的 <details>（max-height 260px），
// 长命令跑起来时看不到「连续滚动流」，后台执行仍偏黑盒。
//
// 本模块在聊天抽屉底部内嵌一个**可折叠的实时输出控制台**：
//   - 常驻 DOM（挂到 #chat-drawer，位于 .chat-input-area 之前），
//     因此无论右侧面板 Tab 是否激活，后台 SSE 事件都能实时写入。
//   - plan 开始时自动浮现，结束时留在原地供回看（可最小化 / 复制全部）。
//   - 连续流：每个步骤一块 <pre>（raw textContent，不解释 HTML），
//     步骤之间用分隔行（▶/✔/✘ + 目标 + 状态）标注，读起来像终端日志。
//
// 接入方式：plan-stream.js 的 _handlePlanEvent 在顶部把事件转发给
// this._planConsoleEvent(evt)；本 mixin 只读取事件、不修改既有步骤气泡逻辑。
//
// 安全：所有动态文本一律 textContent 写入，绝不 innerHTML 拼接命令输出。
// ============================================================
'use strict';

import { stateOf } from './plan-step-bubble.js';

export const planConsoleMixin = {
  /** 事件入口（由 plan-stream.js 转发，覆盖全部 plan 事件类型）。 */
  _planConsoleEvent(evt) {
    if (!evt || !evt.type) return;
    switch (evt.type) {
      case 'start':
        this._planConsoleReset(evt);
        break;
      case 'phase':
      case 'phase_done':
      case 'status':
      case 'chat_status':
        if (evt.message) this._planConsoleSetStatus(evt.message);
        break;
      case 'generated':
        this._planConsoleSetPlan(evt);
        break;
      case 'step':
        this._planConsoleStep(evt);
        break;
      case 'step_chunk':
        if (evt && typeof evt.chunk === 'string' && evt.chunk) this._planConsoleAppend(evt.chunk, 'stdout');
        break;
      case 'chat_token':
        if (evt && typeof evt.content === 'string' && evt.content) this._planConsoleAppend(evt.content, 'chat');
        break;
      case 'error':
        this._planConsoleError(evt);
        break;
      case 'done':
      case 'cancelled':
        this._planConsoleEnd(evt);
        break;
      default:
        break;
    }
  },

  /** 取（必要时建并插入）控制台 DOM。返回根节点或 null。 */
  _planConsoleEnsure() {
    const c = this._planConsole;
    if (c && c.root && c.root.isConnected) return c.root;
    const host = this.el;
    if (!host) return null;
    const inputArea = host.querySelector('.chat-input-area');
    if (!inputArea) return null;

    const root = document.createElement('div');
    root.className = 'plan-console';
    root.id = 'plan-console';

    const header = document.createElement('div');
    header.className = 'plan-console-header';

    const title = document.createElement('span');
    title.className = 'plan-console-title';
    title.textContent = '⚡ 实时输出';

    const pill = document.createElement('span');
    pill.className = 'plan-console-pill';
    pill.dataset.state = 'idle';
    pill.textContent = '空闲';

    const progress = document.createElement('span');
    progress.className = 'plan-console-progress';
    progress.textContent = '';

    const spacer = document.createElement('span');
    spacer.className = 'plan-console-spacer';

    const btnAuto = document.createElement('button');
    btnAuto.type = 'button';
    btnAuto.className = 'plan-console-btn is-active';
    btnAuto.dataset.act = 'autoscroll';
    btnAuto.textContent = '🔽 自动滚动';
    btnAuto.title = '实时跟随最新输出（关则停在当前位置）';

    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'plan-console-btn';
    btnCopy.dataset.act = 'copy';
    btnCopy.textContent = '📋 复制';
    btnCopy.title = '复制全部输出';

    const btnMin = document.createElement('button');
    btnMin.type = 'button';
    btnMin.className = 'plan-console-btn';
    btnMin.dataset.act = 'minimize';
    btnMin.textContent = '—';
    btnMin.title = '最小化 / 展开';

    header.appendChild(title);
    header.appendChild(pill);
    header.appendChild(progress);
    header.appendChild(spacer);
    header.appendChild(btnAuto);
    header.appendChild(btnCopy);
    header.appendChild(btnMin);

    const stream = document.createElement('div');
    stream.className = 'plan-console-stream';

    root.appendChild(header);
    root.appendChild(stream);

    // 插入到输入框之前（聊天抽屉底部上方），不挤压消息区为主
    host.insertBefore(root, inputArea);

    root.addEventListener('mouseenter', () => { if (this._planConsole) this._planConsole.hover = true; });
    root.addEventListener('mouseleave', () => { if (this._planConsole) this._planConsole.hover = false; });
    header.addEventListener('click', (e) => {
      const act = e.target && e.target.dataset && e.target.dataset.act;
      if (act === 'autoscroll') this._planConsoleToggleAuto();
      else if (act === 'copy') this._planConsoleCopy();
      else if (act === 'minimize') this._planConsoleToggleMin();
    });

    this._planConsole = {
      root, header, stream, pill, progress,
      autoscroll: true,
      minimized: false,
      hover: false,
      _lastKind: null,
      _total: 0,
      _done: 0,
      _stepGoal: {},
      _endTimer: null,
    };
    return root;
  },

  _planConsoleReset(evt) {
    const root = this._planConsoleEnsure();
    if (!root) return;
    const c = this._planConsole;
    c.stream.textContent = '';
    c._lastKind = null;
    c._stepGoal = {};
    c.minimized = false;
    root.classList.remove('minimized');
    this._planConsoleSetStatus(evt && evt.objective ? ('目标：' + evt.objective) : '准备中…', 'running');
    this._planConsoleSetProgress();
    if (c._endTimer) { clearTimeout(c._endTimer); c._endTimer = null; }
  },

  /** 从 plan 'generated' 事件拿到总步数（与 plan-stream 的计数解耦，避免时序落后）。 */
  _planConsoleSetPlan(ev) {
    const c = this._planConsole;
    if (!c) return;
    c._total = (ev && Array.isArray(ev.steps)) ? ev.steps.length : (this._planTotalSteps || 0);
    c._done = 0;
    this._planConsoleSetProgress();
  },

  _planConsoleSetStatus(text, state) {
    const c = this._planConsole;
    if (!c) return;
    if (state) c.pill.dataset.state = state;
    else if (text && /完成|结束|失败|中止|错误|出错/.test(text)) {
      c.pill.dataset.state = /失败|中止|错误|出错/.test(text) ? 'error' : 'done';
    }
    c.pill.textContent = text || '空闲';
  },

  _planConsoleSetProgress() {
    const c = this._planConsole;
    if (!c) return;
    const total = c._total || 0;
    const done = c._done || 0;
    c.progress.textContent = total ? (done + '/' + total) : '';
  },

  _planConsoleStep(ev) {
    if (!ev) return;
    const c = this._planConsole;
    if (!c) return;
    const status = ev.status;
    const st = stateOf(status);
    const seq = (typeof ev.index === 'number') ? (ev.index + 1) : '?';
    const total = c._total || 0;
    const key = ev.id || (typeof ev.index === 'number' ? ('#' + ev.index) : '');

    if (status === 'start') {
      const goal = ev.goal || ev.reason || (ev.id ? String(ev.id) : '(步骤)');
      if (key) c._stepGoal[key] = goal; // 记住 goal，terminal 事件缺 goal 时回退
      this._planConsoleSep(('▶ 步骤 ' + seq + '/' + (total || '?') + ' · ' + goal), 'running');
      c.pill.dataset.state = 'running';
      c.pill.textContent = ('执行中 · 步骤 ' + seq + '/' + (total || '?'));
      this._planConsoleSetProgress();
    } else {
      const goal = ev.goal || (key && c._stepGoal[key]) || ev.reason || (ev.id ? String(ev.id) : '(步骤)');
      const secs = (typeof ev.durationMs === 'number')
        ? (' · ' + (ev.durationMs / 1000).toFixed(1) + 's')
        : '';
      const suffix = ev.reason ? (' · ' + ev.reason) : '';
      this._planConsoleSep(((st.icon) + ' ' + goal + ' · ' + st.label + suffix + secs), st.cls);
      c._done = (c._done || 0) + 1;
      this._planConsoleSetProgress();
    }
  },

  /** 插入一条分隔行（步骤边界 / 状态变更）。之后下一个输出块会另起一行。 */
  _planConsoleSep(text, cls) {
    const c = this._planConsole;
    if (!c) return;
    const div = document.createElement('div');
    div.className = 'plan-console-sep' + (cls ? (' is-' + cls) : '');
    div.textContent = text;
    c.stream.appendChild(div);
    c._lastKind = null; // 强制下一个输出块另起
    if (c.autoscroll) c.stream.scrollTop = c.stream.scrollHeight;
  },

  /** 追加原始输出文本（命令 stdout/stderr 或 AI 管线 token）。 */
  _planConsoleAppend(text, kind) {
    const c = this._planConsole;
    if (!c || !text) return;
    const stream = c.stream;
    const last = stream.lastElementChild;
    const canAppend = last
      && last.classList
      && last.classList.contains('plan-console-out')
      && last.dataset.kind === kind
      && c._lastKind === kind;
    let pre;
    if (canAppend) {
      pre = last;
    } else {
      pre = document.createElement('pre');
      pre.className = 'plan-console-out' + (kind === 'chat' ? ' plan-console-out-chat' : '');
      pre.dataset.kind = kind;
      stream.appendChild(pre);
      c._lastKind = kind;
    }
    pre.textContent += text;
    if (c.autoscroll) stream.scrollTop = stream.scrollHeight;
  },

  _planConsoleError(ev) {
    const c = this._planConsole;
    if (!c) return;
    const msg = (ev && ev.message) || '自动执行出错';
    this._planConsoleSep(('❌ ' + msg), 'error');
    if (ev && typeof ev.stack === 'string' && ev.stack.trim()) {
      const pre = document.createElement('pre');
      pre.className = 'plan-console-out plan-console-out-err';
      pre.dataset.kind = 'err';
      pre.textContent = ev.stack.slice(0, 4000);
      c.stream.appendChild(pre);
      c._lastKind = 'err';
    }
    c.pill.dataset.state = 'error';
    c.pill.textContent = '错误';
  },

  _planConsoleEnd(ev) {
    const c = this._planConsole;
    if (!c) return;
    const ok = !ev || ev.ok !== false;
    const status = (ev && ev.status) || (ok ? 'done' : 'failed');
    const secs = ev && ev.durationMs ? (' · ' + (ev.durationMs / 1000).toFixed(1) + 's') : '';
    this._planConsoleSep(('⏹ 执行结束 · ' + status + secs), ok ? 'done' : 'error');
    c.pill.dataset.state = ok ? 'done' : 'error';
    c.pill.textContent = (ok ? '完成 · ' : '结束 · ') + status;
    c.progress.textContent = '';
    // 6s 后若用户没在看，自动最小化，避免占用空间
    if (c._endTimer) clearTimeout(c._endTimer);
    c._endTimer = setTimeout(() => {
      if (this._planConsole && !this._planConsole.hover && !this._planConsole.minimized) {
        this._planConsoleToggleMin();
      }
    }, 6000);
  },

  _planConsoleToggleAuto() {
    const c = this._planConsole;
    if (!c) return;
    c.autoscroll = !c.autoscroll;
    const btn = c.header.querySelector('[data-act="autoscroll"]');
    if (btn) {
      btn.classList.toggle('is-active', c.autoscroll);
      btn.textContent = c.autoscroll ? '🔽 自动滚动' : '⏸ 已暂停';
    }
    if (c.autoscroll) c.stream.scrollTop = c.stream.scrollHeight;
  },

  _planConsoleToggleMin() {
    const c = this._planConsole;
    if (!c) return;
    c.minimized = !c.minimized;
    c.root.classList.toggle('minimized', c.minimized);
    const btn = c.header.querySelector('[data-act="minimize"]');
    if (btn) btn.textContent = c.minimized ? '▢' : '—';
  },

  async _planConsoleCopy() {
    const c = this._planConsole;
    if (!c) return;
    const text = c.stream.textContent || '';
    if (!text.trim()) {
      if (window.QCLI && window.QCLI.showToast) window.QCLI.showToast('没有可复制的内容', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (window.QCLI && window.QCLI.showToast) window.QCLI.showToast('已复制全部输出', 'success');
    } catch {
      if (window.QCLI && window.QCLI.showToast) window.QCLI.showToast('复制失败，请手动选择', 'error');
    }
  },
};
