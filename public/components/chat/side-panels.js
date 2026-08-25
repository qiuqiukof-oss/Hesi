/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 侧边面板：黑板 / 围炉圆桌 / 抽屉缩放 / 导出（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：sidePanelsMixin，含 5 个方法。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, sidePanelsMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

export const sidePanelsMixin = {
  /** @param {boolean} [force] true=强制展开 / false=强制收起 / 省略=切换 */
  toggleBlackboardPanel(force) {
    const panel = document.getElementById('blackboard-embed');
    const frame = /** @type {HTMLIFrameElement|null} */ (document.getElementById('bb-embed-frame'));
    if (!panel || !frame) return;
    // 懒绑定 ✕ / Esc（容器在 body 末尾，bundle 同步执行时未解析，须点击时才绑）
    if (!this._bbCloseBound) {
      this._bbCloseBound = true;
      const closeBtn = document.getElementById('bb-embed-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleBlackboardPanel(false));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('hidden')) this.toggleBlackboardPanel(false);
      });
      this.bindDrawerResize('blackboard-embed', 'qcli-blackboard-width');
    }
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    if (show) {
      // 每次展开重新加载（拿到最新状态；关闭期间零轮询）
      frame.setAttribute('src', '/blackboard.html?embed=1');
    } else {
      frame.setAttribute('src', 'about:blank'); // 卸载页面，停止 iframe 内轮询
    }
    if (this.blackboardBtn) this.blackboardBtn.classList.toggle('active', show);
  },

  // ── Public: 围炉圆桌 嵌入抽屉（应用内直接渲染，引擎复用 Q.ChatAPI；无 iframe）──

  /** @param {boolean} [force] true=强制展开 / false=强制收起 / 省略=切换
   *  @param {string} [skin] 展开时指定皮肤（hearth / mahjong） */
  async toggleMahjongPanel(force, skin) {
    const panel = document.getElementById('mahjong-embed');
    if (!panel) return;
    const rt = window.QCLI && window.QCLI.RoundTableView;
    // 懒绑定 ✕ / Esc（容器在 body 末尾，bundle 同步执行时未解析，须点击时才绑）
    if (!this._mjCloseBound) {
      this._mjCloseBound = true;
      const closeBtn = document.getElementById('mj-embed-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.toggleMahjongPanel(false));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('hidden')) this.toggleMahjongPanel(false);
      });
      this.bindDrawerResize('mahjong-embed', 'qcli-mahjong-width');
    }
    const show = force !== undefined ? force : panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !show);
    if (show) {
      // P2-9：圆桌视图按需加载（首次打开时动态 import）
      let rt = window.QCLI && window.QCLI.RoundTableView;
      if (!rt && window.__hesiLoadRoundtable) {
        try { await window.__hesiLoadRoundtable(); } catch { /* ignore */ }
        rt = window.QCLI && window.QCLI.RoundTableView;
      }
      if (rt) rt.open(skin);   // 应用内渲染圆桌，引擎复用 chat-panel 的 Q.ChatAPI
    } else {
      if (rt) rt.close();
    }
    if (this.roundtableBtn) this.roundtableBtn.classList.toggle('active', show);
  },


  // ── Public: DSH 原生聊天引擎（Phase 2）—— 与 AI 助手并行，消息走 /api/dsh2/chat ──

  /**
   * 切换聊天引擎：AI 助手 ⇄ DSH（原生聊天）。
   * DSH 引擎模式下：输入框照常用，消息路由到 /api/dsh2/chat，
   * 思考/文本/工具卡片全部渲染进 Hesi 聊天框（与 /api/chat 同一事件协议）。
   * @param {boolean} [force] true=切到 DSH / false=切回 AI 助手 / 省略=切换
   */
  async toggleDshEngine(force) {
    const next = force !== undefined ? !!force : !this._dshEngine;
    if (this._dshEngine === next) return;
    this._dshEngine = next;
    if (next) {
      await this._refreshDshEngineStatus();
      this._startDshEnginePolling();
    } else {
      this._stopDshEnginePolling();
    }
    this._syncDshEngineUI();
    try { localStorage.setItem('qcli-dsh-engine', next ? '1' : '0'); } catch { /* ignore */ }
  },

  /** 同步 DSH 引擎 UI：标题/副标题/按钮高亮/状态条。 */
  _syncDshEngineUI() {
    const drawer = document.getElementById('chat-drawer');
    const title = drawer && drawer.querySelector('.chat-header-title');
    const subtitle = drawer && drawer.querySelector('.chat-header-subtitle');
    const statusEl = document.getElementById('dsh2-engine-status');
    if (this._dshEngine) {
      if (title) title.textContent = '🐋 DeepSeek Harness';
      if (subtitle) subtitle.textContent = 'DSH 引擎 · 原生聊天（进程内）';
      if (statusEl) statusEl.hidden = false;
    } else {
      if (title) title.textContent = '💬 AI 对话';
      if (subtitle) subtitle.textContent = '与 AI 助手交流';
      if (statusEl) statusEl.hidden = true;
    }
    if (this.dshEngineBtn) this.dshEngineBtn.classList.toggle('active', this._dshEngine);
    if (this._dshEngine) this._renderDshEngineStatus();
    // DSH 引擎模式下禁用 AI 讨论 / 自动执行 / 附件 / 核查控件
    this._syncDshEngineControls();
  },

  /** DSH 引擎模式下禁用讨论/自动执行/附件/核查控件（这些是 AI 助手编排能力，DSH 直通链路不生效）。 */
  _syncDshEngineControls() {
    const bar = document.getElementById('discuss-bar');
    if (bar) bar.classList.toggle('dsh-disabled', this._dshEngine);
    // 禁用附件/核查按钮；DSH 模式下不参与 Hesi 编排
    for (const id of ['chat-attach-btn', 'chat-verify-btn']) {
      const b = document.getElementById(id);
      if (b) b.disabled = this._dshEngine;
    }
    // 标题提示：DSH 模式下说明哪些能力不参与
    const discussSwitch = document.getElementById('discuss-switch');
    if (discussSwitch) {
      discussSwitch.title = this._dshEngine
        ? 'DSH 引擎模式下不可用（消息直达 DSH，不经过 Hesi 讨论编排）'
        : '开启后，你的指令会由 AI 助手与所选 CLI Agent（可多选）按回合协作讨论，过程实时可见';
    }
    const planSwitch = document.getElementById('plan-switch');
    if (planSwitch) {
      planSwitch.title = this._dshEngine
        ? 'DSH 引擎模式下不可用（消息直达 DSH，不经过 Hesi 计划/审批编排）'
        : '开启后自动拆解目标为可执行步骤并真实执行；同时勾选 AI 讨论→协作工作流（讨论→方案→实施）';
    }
  },

  /** 拉取 /api/dsh2/status 并缓存。 */
  async _refreshDshEngineStatus() {
    try {
      const r = await fetch('/api/dsh2/status');
      if (r.ok) this._dshEngineStatus = await r.json();
    } catch { /* ignore */ }
    return this._dshEngineStatus;
  },

  /** 渲染状态条（模型/会话数/错误）。 */
  _renderDshEngineStatus() {
    const statusEl = document.getElementById('dsh2-engine-status');
    if (!statusEl) return;
    const st = this._dshEngineStatus;
    if (!st) { statusEl.textContent = '⏳ 引擎状态未知'; statusEl.dataset.state = 'idle'; return; }
    if (st.running) {
      statusEl.textContent = `🟢 DSH 引擎运行中 · ${st.model || '未知模型'}` + (st.sessions ? ` · ${st.sessions} 会话` : '');
      statusEl.dataset.state = 'running';
    } else {
      statusEl.textContent = '🟠 DSH 引擎未就绪' + (st.error ? `：${st.error}` : '');
      statusEl.dataset.state = 'error';
    }
  },

  /** 引擎运行期间每 10s 刷新状态。 */
  _startDshEnginePolling() {
    this._stopDshEnginePolling();
    this._dshEngineTimer = setInterval(async () => {
      if (!this._dshEngine) return;
      await this._refreshDshEngineStatus();
      this._renderDshEngineStatus();
    }, 10_000);
  },

  _stopDshEnginePolling() {
    if (this._dshEngineTimer) {
      clearInterval(this._dshEngineTimer);
      this._dshEngineTimer = null;
    }
  },


  // ── Public: DSH（DeepSeek Harness）引擎 —— 与 AI 助手并行，随时切换 ──

  /**
   * 切换聊天引擎：AI 助手 ⇄ DSH。
   * DSH 模式下聊天区替换为 DSH 官方 Web UI（子进程由后端托管，端口经 /api/dsh 获取）。
   * @param {boolean} [force] true=进入 DSH / false=切回 AI 助手 / 省略=切换
   */
  async toggleDshMode(force) {
    const drawer = document.getElementById('chat-drawer');
    const panel = document.getElementById('dsh-embed');
    if (!drawer || !panel) return;
    const show = force !== undefined ? force : !drawer.classList.contains('dsh-mode');
    if (show) {
      await this._enterDshMode(drawer);
    } else {
      this._exitDshMode(drawer);
    }
    if (this.dshBtn) this.dshBtn.classList.toggle('active', show);
    try { localStorage.setItem('qcli-dsh-mode', show ? '1' : '0'); } catch { /* ignore */ }
  },

  /** 进入 DSH 模式：确保引擎运行 → 装载 iframe → 标题/状态切换。@param {HTMLElement} drawer */
  async _enterDshMode(drawer) {
    const statusEl = document.getElementById('dsh-embed-status');
    const frame = /** @type {HTMLIFrameElement|null} */ (document.getElementById('dsh-embed-frame'));
    const setStatus = (text, cls) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.dataset.state = cls || 'idle';
    };
    setStatus('⚙️ 正在启动 DSH 引擎…', 'starting');

    let st;
    try {
      st = await (await fetch('/api/dsh/status')).json();
    } catch { setStatus('❌ 无法连接 Hesi 后端', 'error'); return; }
    if (!st.available) {
      setStatus('❌ 未安装 DSH（npm i @deepseek-ai/dsh）', 'error');
      return;
    }
    if (!st.running) {
      try {
        st = await (await fetch('/api/dsh/start', { method: 'POST' })).json();
      } catch { setStatus('❌ DSH 启动请求失败', 'error'); return; }
    }
    if (!st.running || !st.port) {
      setStatus('❌ ' + (st.error || 'DSH 引擎启动失败'), 'error');
      return;
    }

    drawer.classList.add('dsh-mode');
    const title = drawer.querySelector('.chat-header-title');
    if (title) title.textContent = '🐋 DeepSeek Harness';
    const subtitle = drawer.querySelector('.chat-header-subtitle');
    if (subtitle) subtitle.textContent = 'DSH 引擎' + (st.version ? ' · ' + st.version : '');
    const url = `http://127.0.0.1:${st.port}/`;
    if (frame) frame.setAttribute('src', url);
    const openBtn = document.getElementById('dsh-embed-open');
    if (openBtn) openBtn.setAttribute('href', url);
    setStatus(
      st.keyConfigured
        ? `🟢 运行中 · 端口 ${st.port}`
        : `🟡 运行中（未配置 DeepSeek Key，可在设置页填入）· 端口 ${st.port}`,
      'running'
    );
    this._bindDshPanelOnce();
    this._dshStatusTimer = setInterval(() => this._refreshDshStatus(), 5_000);
  },

  /** 退出 DSH 模式，回到 AI 助手。@param {HTMLElement} drawer */
  _exitDshMode(drawer) {
    drawer.classList.remove('dsh-mode');
    const title = drawer.querySelector('.chat-header-title');
    if (title) title.textContent = '💬 AI 对话';
    const subtitle = drawer.querySelector('.chat-header-subtitle');
    if (subtitle) subtitle.textContent = '与 AI 助手交流';
    const frame = /** @type {HTMLIFrameElement|null} */ (document.getElementById('dsh-embed-frame'));
    if (frame) frame.setAttribute('src', 'about:blank'); // 卸载页面，停止 iframe 内轮询
    if (this._dshStatusTimer) { clearInterval(this._dshStatusTimer); this._dshStatusTimer = null; }
  },

  /** DSH 面板懒绑定（✕ / 重启 / Esc）。 */
  _bindDshPanelOnce() {
    if (this._dshBound) return;
    this._dshBound = true;
    const closeBtn = document.getElementById('dsh-embed-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.toggleDshMode(false));
    const restartBtn = document.getElementById('dsh-embed-restart');
    if (restartBtn) {
      restartBtn.addEventListener('click', async () => {
        const statusEl = document.getElementById('dsh-embed-status');
        if (statusEl) { statusEl.textContent = '🔄 正在重启…'; statusEl.dataset.state = 'starting'; }
        try {
          await fetch('/api/dsh/restart', { method: 'POST' });
          const st = await (await fetch('/api/dsh/status')).json();
          const frame = document.getElementById('dsh-embed-frame');
          if (st.running && st.port && frame) {
            frame.setAttribute('src', `http://127.0.0.1:${st.port}/`);
            if (statusEl) {
              statusEl.textContent = `🟢 已重启 · 端口 ${st.port}`;
              statusEl.dataset.state = 'running';
            }
          } else if (statusEl) {
            statusEl.textContent = '❌ 重启失败：' + (st.error || '未知错误');
            statusEl.dataset.state = 'error';
          }
        } catch { /* ignore */ }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const drawer = document.getElementById('chat-drawer');
        if (drawer && drawer.classList.contains('dsh-mode')) this.toggleDshMode(false);
      }
    });
  },

  /** 后台刷新引擎状态（仅更新状态条，不重载 iframe）。 */
  async _refreshDshStatus() {
    const statusEl = document.getElementById('dsh-embed-status');
    if (!statusEl) return;
    try {
      const st = await (await fetch('/api/dsh/status')).json();
      if (st.running) {
        statusEl.textContent = st.keyConfigured
          ? `🟢 运行中 · 端口 ${st.port}`
          : `🟡 运行中（未配置 DeepSeek Key）· 端口 ${st.port}`;
        statusEl.dataset.state = 'running';
      } else {
        statusEl.textContent = '⏹ 引擎未运行';
        statusEl.dataset.state = 'idle';
      }
    } catch { /* ignore */ }
  },

  // ── Drawer resize: 右侧抽屉可拖拽改变宽度，localStorage 记忆 ──
  bindDrawerResize(panelId, storageKey) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const handle = panel.querySelector('.drawer-resize-handle');
    if (!handle) return;
    if (handle.dataset.resizable === '1') return;
    handle.dataset.resizable = '1';
    const DEFAULT_W = 400;
    // restore saved width
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) panel.style.width = saved + 'px';
    } catch { /* ignore */ }
    const setWidth = (w) => { panel.style.width = Math.max(360, Math.min(Math.min(window.innerWidth * 0.85, 900), w)) + 'px'; };
    handle.addEventListener('dblclick', () => {
      setWidth(DEFAULT_W);
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    });
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.classList.add('resizing');
      document.body.classList.add('drawer-resizing');
      // 透明捕获层：拖拽期间盖住整屏（含 iframe），强制 mousemove/mouseup 留在父文档，
      // 避免鼠标移到黑板/圆桌的 iframe 上被其吞掉 mouseup，导致拖拽“黏住”不结束。
      const guard = document.createElement('div');
      guard.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:ew-resize;user-select:none';
      document.body.appendChild(guard);
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const minW = 360;
      const maxW = Math.min(window.innerWidth * 0.85, 900);
      const onMove = (ev) => {
        const dx = startX - ev.clientX; // 抽屉在右侧，向左拖增大、向右拖减小
        const w = Math.max(minW, Math.min(maxW, startW + dx));
        panel.style.width = w + 'px';
      };
      const onUp = () => {
        handle.classList.remove('resizing');
        document.body.classList.remove('drawer-resizing');
        if (guard.parentNode) guard.parentNode.removeChild(guard);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('mouseup', onUp);
        try { localStorage.setItem(storageKey, String(Math.round(panel.getBoundingClientRect().width))); } catch { /* ignore */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('mouseup', onUp, { once: true });
    });
  },

  // ── Public: Export chat ──

  exportChat() {
    if (this.messages.length === 0) {
      window.QCLI?.showToast?.('没有可导出的聊天记录', 'info');
      return;
    }
    const lines = ['# Hesi 聊天记录导出', '', `> 导出时间：${new Date().toLocaleString()}`, '', '---', ''];
    for (const m of this.messages) {
      const role = m.role === 'user' ? '👤 **You**' : '🟦 **AI 助手**';
      lines.push(role);
      lines.push('');
      lines.push(m.content || '（空消息）');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    const md = lines.join('\n');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `hesi-chat-${dateStr}.md`;
    this._downloadText(md, filename, 'text/markdown')
      .then((ok) => { if (ok) window.QCLI?.showToast?.('已导出聊天记录', 'success'); })
      .catch((err) => {
        console.error('[chat] export failed:', err);
        window.QCLI?.showToast?.('导出失败：' + (err && err.message ? err.message : String(err)), 'error');
      });
  },

  // 跨浏览器可靠下载：优先 File System Access API（showSaveFilePicker）。
  // 在 CDP / 自动化浏览器下，Chromium 会忽略 <a download> 的文件名，
  // 导致保存成“无扩展名”的文件——而 save-file-picker 的 suggestedName
  // 由我们提供、并在原生对话框中预填扩展名，不受该限制影响。
  // 不支持该 API 的浏览器回退到传统 <a download>。
  // 返回 Promise<boolean>：true=已保存，false=用户取消。
  async _downloadText(content, filename, mime = 'text/plain') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    if (typeof window.showSaveFilePicker === 'function') {
      let handle;
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
            { description: '纯文本', accept: { 'text/plain': ['.txt'] } },
          ],
        });
      } catch (err) {
        if (err && err.name === 'AbortError') return false; // 用户取消
        throw err;
      }
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }
    // 传统回退：<a download>
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 延迟清理，确保浏览器已触发下载
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
  },
};
