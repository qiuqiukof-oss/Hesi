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
  toggleMahjongPanel(force, skin) {
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
      if (rt) rt.open(skin);   // 应用内渲染圆桌，引擎复用 chat-panel 的 Q.ChatAPI
    } else {
      if (rt) rt.close();
    }
    if (this.roundtableBtn) this.roundtableBtn.classList.toggle('active', show);
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
