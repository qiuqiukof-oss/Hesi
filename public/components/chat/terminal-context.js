// ============================================================
// 终端上下文：开关 / UI / fit·resize（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：terminalContextMixin，含 3 个方法：
//   _toggleTerminalContext / _updateTerminalToggleUI / _refitTerminal
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, terminalContextMixin) 挂回。
//
// 注：sendMessage 内深度耦合 SSE 控制流的「终端 hash 采集/增量装配」逻辑
// 按拆分方案风险警示保留在 sendMessage 编排中（仅读写 this._lastTerminalHash
// 等实例字段，不依赖本 mixin 方法），以保证行为零变化、零回归。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

import { safeStorage } from '../../lib/storage.js';

export const terminalContextMixin = {
  _toggleTerminalContext() {
    this._terminalContextEnabled = !this._terminalContextEnabled;
    safeStorage.set('qcli-terminal-context', this._terminalContextEnabled ? '1' : '0');
    this._updateTerminalToggleUI();
    const Q = window.QCLI || {};
    const msg = this._terminalContextEnabled
      ? (Q.__?.('chat.terminalOn') || '终端上下文已启用')
      : (Q.__?.('chat.terminalOff') || '终端上下文已禁用');
    if (Q.showToast) Q.showToast(msg, 'info');
  },

  _updateTerminalToggleUI() {
    if (!this.terminalToggleBtn) return;
    const Q = window.QCLI || {};
    if (this._terminalContextEnabled) {
      this.terminalToggleBtn.classList.add('active');
      this.terminalToggleBtn.title = Q.__?.('chat.terminalOn') || '终端上下文：已启用';
    } else {
      this.terminalToggleBtn.classList.remove('active');
      this.terminalToggleBtn.title = Q.__?.('chat.terminalOff') || '终端上下文：已禁用';
    }
  },

  _refitTerminal() {
    const Q = window.QCLI || {};
    requestAnimationFrame(() => {
      // tabs.js sets Q.Tabs.fitAddon to the real FitAddon instance (or null)
      const fa = Q.Tabs?.fitAddon || Q.fitAddon;
      if (fa && typeof fa.fit === 'function') {
        try { fa.fit(); } catch (e) { console.debug('[ChatPanel] fitAddon.fit:', e?.message); }
        const state = Q.state;
        if (state && state.launched) {
          const dims = fa.proposeDimensions();
          if (dims && Q.wsSend) {
            Q.wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: Q.Tabs?.activeTabId });
          }
        }
      }
    });
  },
};
