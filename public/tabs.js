/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Tab Manager — Multi-Session Terminal Tabs
//
// Uses ES module imports for xterm and addons (bundled via esbuild)
// instead of global script tags.
// ============================================================
'use strict';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { safeStorage } from './lib/storage.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ── Media file link provider (shared class, not per-terminal) ──
class MediaFileLinkProvider {
  constructor(terminal, handler) {
    this._terminal = terminal;
    this._handler = handler;
    this._regex = /[\w\-.\/\\]*[/\\][\w\-.\/\\]+[\.](jpe?g|png|gif|webp|svg|avif|bmp|mp4|webm|ogg|mov)\b/gi;
  }
  provideLinks(y, callback) {
    const lineIndex = y - 1;
    const line = this._terminal.buffer.active.getLine(lineIndex);
    if (!line) { callback(undefined); return; }
    const text = line.translateToString();
    const links = [];
    const rex = new RegExp(this._regex.source, this._regex.flags);
    let match;
    while ((match = rex.exec(text)) !== null) {
      const uri = match[0];
      links.push({
        range: { start: { x: match.index + 1, y }, end: { x: match.index + uri.length, y } },
        text: uri,
        activate: this._handler,
      });
    }
    callback(links.length > 0 ? links : undefined);
  }
}

export const Tabs = {
    /** @type {Array<{tabId:string, cliId:string, name:string, icon:string, buffer:string, init?:string, pinned?:boolean, term:Terminal, fitAddon:FitAddon, webglAddon:WebglAddon|null, searchAddon:SearchAddon|null, container:HTMLDivElement}>} */
    tabs: [],
    /** @type {string|null} */
    activeTabId: null,
    /** @type {Terminal|null} — points to active tab's terminal */
    term: null,
    /** @type {FitAddon|null} — points to active tab's fitAddon */
    fitAddon: null,
    /** @type {number|null} — periodic save interval id */
    _saveInterval: null,
    /** @type {RegExp} — ANSI escape sequence regex */
    _ansiRe: /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    /** @type {Object.<string, string[]>} — buffered output before tab creation */
    _pendingOutput: {},
    /** @type {number} — source index during drag-and-drop */
    _dragSourceIndex: -1,

    // ── Font helper ──
    _getBestFontFamily() {
      // 末尾追加 CJK 字体，避免中文在 xterm canvas 中因缺字形而显示为方框（乱码）
      return "'Cascadia Code','Cascadia Mono','Consolas','Courier New','Microsoft YaHei','微软雅黑','SimSun','PingFang SC',monospace";
    },

    // ──────────────────────────────────────────────
    // Terminal factory — creates a new xterm.js Terminal
    // with all addons and handlers for a tab.
    // ──────────────────────────────────────────────
    _createTerminal(container) {
      const fitAddon = new FitAddon();

      let webglAddon = null;
      // Check WebGL2 support before creating addon (browser may not support it)
      let glSupported = false;
      try {
        const c = document.createElement("canvas");      glSupported = !!(c.getContext("webgl2") || c.getContext("experimental-webgl2"));
    } catch(e) { console.debug('[Tabs] WebGL detection error:', e?.message); }
      if (glSupported) {
        try { webglAddon = new WebglAddon(); } catch (e) { webglAddon = null; }
      }

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: this._getBestFontFamily(),
        fontSize: 14,
        lineHeight: 1.2,
        letterSpacing: 0,
        theme: {
          background: 'rgba(13, 14, 16, 0.85)',
          foreground: '#e4e4e7',
          cursor: '#e4e4e7',
          cursorAccent: '#0d0e10',
          selection: 'rgba(99,102,241,0.3)',
          black: '#18181b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#6366f1',
          magenta: '#a78bfa',
          cyan: '#22d3ee',
          white: '#e4e4e7',
          brightBlack: '#71717a',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#818cf8',
          brightMagenta: '#c4b5fd',
          brightCyan: '#67e8f9',
          brightWhite: '#fafafa',
        },
        allowTransparency: true,
        scrollback: 5000,
        allowProposedApi: true,
        mouseEvents: true,
        macOptionIsMeta: true,
        customGlyphs: true,
        rescaleOverlappingGlyphs: true,
        minimumContrastRatio: 4.5,
        smoothScrollDuration: 200,
      });

      term.loadAddon(fitAddon);
      try {
        term.loadAddon(new WebLinksAddon());
      } catch (e) { console.debug('[Tabs] WebLinksAddon load failed:', e?.message); }

      // SearchAddon
      let searchAddon = null;
      try {
        searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);
      } catch (e) { searchAddon = null; }

      // Media file link provider
      try {
        term.registerLinkProvider(new MediaFileLinkProvider(term, (event, uri) => {
          event.preventDefault();
          const filename = uri.split('/').pop().split('\\').pop();
          if (window.QCLI.Upload?.handleMediaClick) window.QCLI.Upload.handleMediaClick(filename);
        }));
      } catch (e) {
        console.warn('[MediaLink] Failed to register link provider:', e.message);
      }

      // WebGL addon
      if (webglAddon) {
        try { term.loadAddon(webglAddon); } catch (e) { webglAddon = null; }
      }

      term.open(container);

      // Restore saved font size
      const saved = safeStorage.get('qcli-font-size');
      if (saved) {
        const size = parseInt(saved, 10);
        if (size >= 8 && size <= 32 && size !== 14) {
          term.options.fontSize = size;
        }
      }

      // onData — send input to backend, delegate history capture
      term.onData((data) => {
        if (Q.state?.launched || this.activeTabId) {
          const tid = this.activeTabId;
          Q.wsSend?.({ type: 'input', data, tabId: tid });
          Q._handleInputCapture?.(data, tid);
        }
      });

      // Ctrl+Shift+C/V clipboard
      term.attachCustomKeyEventHandler((e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'c' && !e.repeat) {
          const sel = term.getSelection();
          if (sel) {
            navigator.clipboard.writeText(sel).catch(err => console.warn('[Clipboard] Copy failed:', err.message));
            term.clearSelection();
          }
          return false;
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'v' && !e.repeat) {
          navigator.clipboard.readText().then(text => {
            if (text && Q.state?.launched) Q.wsSend?.({ type: 'input', data: text });
          }).catch(err => console.warn('[Clipboard] Paste failed:', err.message));
          return false;
        }
        return true;
      });

      return { term, fitAddon, webglAddon, searchAddon };
    },

    // ──────────────────────────────────────────────
    // Update all global terminal references to point
    // to the specified tab's terminal.
    // ──────────────────────────────────────────────
    _updateActiveGlobals(tabId) {
      const tab = this.getTab(tabId);
      if (!tab) return;
      this.term = tab.term;
      this.fitAddon = tab.fitAddon;
      Q.term = tab.term;
      Q.fitAddon = tab.fitAddon;
      Q.webglAddon = tab.webglAddon;
      Q.searchAddon = tab.searchAddon;
      Q.Tabs.term = tab.term;
      Q.Tabs.fitAddon = tab.fitAddon;
      // Sync app.js module-level let variables via Q bridge
      if (Q.setActiveTerminal) {
        Q.setActiveTerminal(tab.term, tab.fitAddon, tab.webglAddon);
      }
    },

    // ──────────────────────────────────────────────
    // Show/hide tab terminal containers by tabId.
    // ──────────────────────────────────────────────
    _switchDisplay(tabId) {
      for (const tab of this.tabs) {
        tab.container.style.display = tab.tabId === tabId ? 'block' : 'none';
      }
    },

    /**
     * Create a new tab — creates a .tab-terminal div + new xterm.Terminal.
     */
    create(tabId, cliId, name, icon, init) {
      this.saveActiveTerminal();

      // Create container div
      const container = document.createElement('div');
      container.className = 'tab-terminal';
      container.dataset.tabId = tabId;
      container.style.display = 'none';
      document.getElementById('terminal').appendChild(container);

      // Create terminal for this tab
      const { term, fitAddon, webglAddon, searchAddon } = this._createTerminal(container);

      const newTab = {
        tabId, cliId, name, icon, init: init || '',
        buffer: '', pinned: false,
        _createdAt: Date.now(),
        term, fitAddon, webglAddon, searchAddon, container,
      };
      this.tabs.push(newTab);
      this.activeTabId = tabId;

      // Show this tab, hide others
      this._switchDisplay(tabId);

      // Hide welcome overlay
      const welcome = document.getElementById('welcome-overlay');
      if (welcome) welcome.classList.add('hidden');

      // Update globals to point at this tab's terminal
      this._updateActiveGlobals(tabId);

      // Fit on next frame
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch (e) { console.debug('[Tabs] fitAddon.fit in create:', e?.message); }
      });

      this.render();

      // Flush any output that arrived before the tab existed
      this._flushPendingOutput(tabId);

      // Persist
      this._persistTab(tabId);
      this._startPeriodicSave();

      return newTab;
    },

    /**
     * Switch to an existing tab by id — just hide/show containers.
     */
    switch(tabId) {
      if (tabId === this.activeTabId) return;

      this.saveActiveTerminal();
      if (this.activeTabId) {
        this._persistTab(this.activeTabId);
      }

      // Clear partial command input (shouldn't carry over)
      if (Q.resetInputBuffer) Q.resetInputBuffer();

      this.activeTabId = tabId;
      this._switchDisplay(tabId);
      this._updateActiveGlobals(tabId);

      // Fit the newly visible terminal
      requestAnimationFrame(() => {
        try { this.fitAddon?.fit(); } catch (e) { console.debug('[Tabs] fitAddon.fit in switch:', e?.message); }
      });

      this.render();
    },

    /**
     * Close a tab — disposes the terminal, removes DOM, kills PTY.
     */
    close(tabId) {
      const idx = this.tabs.findIndex(t => t.tabId === tabId);
      if (idx === -1) return;

      const tab = this.tabs[idx];

      // Kill PTY on backend
      if (Q.wsSend) Q.wsSend({ type: 'kill', tabId });

      // Clean up pending output
      delete this._pendingOutput[tabId];

      // 清理该 tab 的 Mermaid 缓冲区
      if (window.QCLI?.TerminalMermaid) {
        window.QCLI.TerminalMermaid.cleanupTab(tabId);
      }

      // Remove from IndexedDB
      if (window.QCLI?.SessionStore) window.QCLI.SessionStore.removeTab(tabId);

      // Dispose terminal
      if (tab.term) {
        try { tab.term.dispose(); } catch (e) { console.debug('[Tabs] term.dispose in close:', e?.message); }
      }

      // Remove container from DOM
      if (tab.container && tab.container.parentNode) {
        tab.container.parentNode.removeChild(tab.container);
      }

      // Remove from array
      this.tabs.splice(idx, 1);

      // Handle active tab change
      if (this.activeTabId === tabId) {
        if (this.tabs.length > 0) {
          const nextIdx = Math.min(idx, this.tabs.length - 1);
          const nextTab = this.tabs[nextIdx];
          this.activeTabId = nextTab.tabId;
          this._switchDisplay(nextTab.tabId);
          this._updateActiveGlobals(nextTab.tabId);
          requestAnimationFrame(() => {
            try { this.fitAddon?.fit(); } catch (e) { console.debug('[Tabs] fitAddon.fit after close:', e?.message); }
          });
        } else {
          // No more tabs — show welcome
          this.activeTabId = null;
          this.term = null;
          this.fitAddon = null;
          Q.term = null;
          Q.fitAddon = null;
          Q.webglAddon = null;
          Q.searchAddon = null;
          Q.Tabs.term = null;
          Q.Tabs.fitAddon = null;
          if (Q.setActiveTerminal) Q.setActiveTerminal(null, null, null);
          this._stopPeriodicSave();
          const welcome = document.getElementById('welcome-overlay');
          if (welcome) welcome.classList.remove('hidden');
          const activeLabel = document.getElementById('active-cli-label');
          if (activeLabel) activeLabel.textContent = 'No CLI running';
          const activeVersion = document.getElementById('active-cli-version');
          if (activeVersion) activeVersion.textContent = '';
        }
      }

      this.render();
    },

    /**
     * Move a tab (drag-and-drop).
     */
    move(fromIdx, toIdx) {
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= this.tabs.length || toIdx >= this.tabs.length) return;
      const [tab] = this.tabs.splice(fromIdx, 1);
      this.tabs.splice(toIdx, 0, tab);
      this._persistAllTabs();
      this.render();
    },

    /**
     * Toggle pin state for a tab.
     */
    togglePin(tabId) {
      const tab = this.getTab(tabId);
      if (!tab) return;
      tab.pinned = !tab.pinned;
      this._persistTab(tabId);
      this.render();
    },

    /**
     * Get tabs sorted with pinned ones first.
     */
    getPinnedFirst() {
      return [...this.tabs].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return 0;
      });
    },

    /**
     * Save active tab's terminal content to its plain-text buffer.
     * Used for IndexedDB persistence (not for tab switching).
     */
    saveActiveTerminal() {
      if (!this.activeTabId || !this.term) return;
      const tab = this.getTab(this.activeTabId);
      if (!tab) return;

      try {
        const buffer = this.term.buffer.active;
        const lines = [];
        const len = buffer.length;
        for (let y = 0; y < len; y++) {
          const line = buffer.getLine(y);
          if (line) lines.push(line.translateToString());
        }
        tab.buffer = lines.join('\n');
      } catch (e) { console.debug('[Tabs] saveActiveTerminal buffer read:', e?.message); }
    },

    /**
     * Restore a tab's buffered content to its own terminal.
     * Used during session restore from IndexedDB.
     */
    restoreTabBuffer(tabId) {
      const tab = this.getTab(tabId);
      if (!tab || !tab.buffer || !tab.term) return;
      try {
        tab.term.write(tab.buffer);
      } catch (e) { console.debug('[Tabs] restoreTabBuffer write:', e?.message); }
    },

    /**
     * Append PTY output to the correct tab's terminal and plain-text buffer.
     * @param {string} data - Raw PTY output
     * @param {string} [tabId] - The originating tab's ID
     */
    appendOutput(data, tabId) {
      const targetTabId = tabId || this.activeTabId;
      if (!targetTabId) return;

      const tab = this.getTab(targetTabId);
      if (!tab) return;

      // Write to the tab's terminal (always — even background tabs keep their
      // own xterm.js state so switching is instant with no corruption)
      if (tab.term) {
        tab.term.write(data);
      } else {
        // Buffer for before tab creation
        if (!this._pendingOutput[targetTabId]) this._pendingOutput[targetTabId] = [];
        this._pendingOutput[targetTabId].push(data);
      }

      // Always update plain-text buffer for persistence
      const plain = data.replace(this._ansiRe, '');
      tab.buffer = (tab.buffer || '') + plain;
      if (tab.buffer.length > 100000) tab.buffer = tab.buffer.slice(-50000);

      // 检测终端输出中的 Mermaid 图表代码块
      if (window.QCLI?.TerminalMermaid && plain.includes('```')) {
        window.QCLI.TerminalMermaid.feedOutput(targetTabId, plain);
      }
    },

    /**
     * Get a tab by id.
     */
    getTab(tabId) {
      return this.tabs.find(t => t.tabId === tabId);
    },

    /**
     * Render the tab bar UI.
     */
    render() {
      const bar = document.getElementById('tab-bar');
      if (!bar) return;

      bar.innerHTML = '';

      for (const tab of this.tabs) {
        const el = document.createElement('div');
        el.className = 'tab-item' + (tab.tabId === this.activeTabId ? ' active' : '');
        el.dataset.tabId = tab.tabId;
        el.draggable = true;
        el.dataset.dragIndex = this.tabs.indexOf(tab);
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.tabId);
          el.classList.add('dragging');
          this._dragSourceIndex = this.tabs.indexOf(tab);
        });
        el.addEventListener('dragend', () => {
          el.classList.remove('dragging');
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
          this._dragSourceIndex = -1;
        });
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
          el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', () => {
          el.classList.remove('drag-over');
        });
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.remove('drag-over');
          const fromIdx = this._dragSourceIndex;
          const toIdx = this.tabs.indexOf(tab);
          if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
            this.move(fromIdx, toIdx);
          }
          this._dragSourceIndex = -1;
        });
        el.title = tab.name || tab.cliId || 'Terminal';

        // CLI category color accent
        const clis = window.QCLI?.state?.clis || [];
        const cliObj = clis.find(c => c.id === tab.cliId);
        if (cliObj?.category) {
          el.dataset.category = cliObj.category;
        }

        // Icon
        const icon = document.createElement('span');
        icon.className = 'tab-icon';
        icon.textContent = tab.icon || '\u25b6';
        el.appendChild(icon);

        // Name
        const name = document.createElement('span');
        name.className = 'tab-name';
        name.textContent = tab.name || tab.cliId || 'Terminal';
        el.appendChild(name);

        // Pin button
        const pinBtn = document.createElement('button');
        pinBtn.className = 'tab-pin' + (tab.pinned ? ' pinned' : '');
        pinBtn.textContent = tab.pinned ? '\ud83d\udccd' : '\ud83d\udccc';
        pinBtn.title = tab.pinned ? 'Unpin tab' : 'Pin tab';
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.togglePin(tab.tabId);
        });
        el.appendChild(pinBtn);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.title = 'Close tab';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.close(tab.tabId);
        });
        el.appendChild(closeBtn);

        // Click to switch
        el.addEventListener('click', () => {
          this.switch(tab.tabId);
        });

        // Middle-click to close
        el.addEventListener('auxclick', (e) => {
          if (e.button === 1) {
            e.preventDefault();
            this.close(tab.tabId);
          }
        });

        bar.appendChild(el);
      }

      // Update tab bar visibility
      bar.classList.toggle('has-tabs', this.tabs.length > 0);
    },

    /**
     * Close all tabs (for reconnection / cleanup).
     */
    closeAll() {
      this._pendingOutput = {};
      this._persistAllTabs();

      for (const tab of this.tabs) {
        if (Q.wsSend) Q.wsSend({ type: 'kill', tabId: tab.tabId });
        if (tab.term) {
          try { tab.term.dispose(); } catch (e) { console.debug('[Tabs] term.dispose in closeAll:', e?.message); }
        }
        if (tab.container && tab.container.parentNode) {
          tab.container.parentNode.removeChild(tab.container);
        }
      }
      this.tabs = [];
      this.activeTabId = null;
      this.term = null;
      this.fitAddon = null;
      Q.term = null;
      Q.fitAddon = null;
      Q.webglAddon = null;
      Q.searchAddon = null;
      Q.Tabs.term = null;
      Q.Tabs.fitAddon = null;
      if (Q.setActiveTerminal) Q.setActiveTerminal(null, null, null);
      this._stopPeriodicSave();
      this.render();
      const welcome = document.getElementById('welcome-overlay');
      if (welcome) welcome.classList.remove('hidden');
    },

    // ──────────────────────────────────────────────
    // Pending Output + Session Persistence Helpers
    // ──────────────────────────────────────────────

    /**
     * Flush any output that was buffered before a tab was created.
     */
    _flushPendingOutput(tabId) {
      const pending = this._pendingOutput[tabId];
      if (!pending || pending.length === 0) return;

      const tab = this.getTab(tabId);
      if (!tab) return;

      // Batch-concatenate plain text for the buffer
      const plainText = pending
        .map(d => d.replace(this._ansiRe || /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, ''))
        .join('');
      tab.buffer = (tab.buffer || '') + plainText;
      if (tab.buffer.length > 100000) tab.buffer = tab.buffer.slice(-50000);

      // Write to this tab's terminal
      if (tab.term) {
        const rawText = pending.join('');
        tab.term.write(rawText);
      }

      delete this._pendingOutput[tabId];
    },

    /**
     * Save a single tab to IndexedDB.
     */
    _persistTab(tabId) {
      if (!window.QCLI?.SessionStore) return;
      const tab = this.getTab(tabId);
      if (!tab) return;

      window.QCLI.SessionStore.saveTab(tabId, {
        cliId: tab.cliId,
        name: tab.name,
        icon: tab.icon,
        init: tab.init || '',
        pinned: !!tab.pinned,
        buffer: tab.buffer || '',
        status: tabId === this.activeTabId ? 'active' : 'inactive',
      });
    },

    /**
     * Save all tabs to IndexedDB.
     */
    _persistAllTabs() {
      for (const tab of this.tabs) {
        this._persistTab(tab.tabId);
      }
      if (window.QCLI?.SessionStore) {
        window.QCLI.SessionStore.flushSaves();
      }
    },

    /**
     * Start periodic save interval (every 15 seconds).
     */
    _startPeriodicSave() {
      if (this._saveInterval) return;
      this._saveInterval = setInterval(() => {
        if (this.activeTabId) {
          this.saveActiveTerminal();
          this._persistTab(this.activeTabId);
        }
      }, 15000);
    },

    /**
     * Stop the periodic save interval.
     */
    _stopPeriodicSave() {
      if (this._saveInterval) {
        clearInterval(this._saveInterval);
        this._saveInterval = null;
      }
    },

    /**
     * Restore tabs from IndexedDB data — creates terminals for each.
     * Called by the session restore overlay.
     */
    restoreSessions(sessions) {
      if (!sessions || sessions.length === 0) return;

      this.saveActiveTerminal();

      for (const session of sessions) {
        if (this.getTab(session.tabId)) continue;

        // Create terminal for this restored session
        const container = document.createElement('div');
        container.className = 'tab-terminal';
        container.dataset.tabId = session.tabId;
        container.style.display = 'none';
        document.getElementById('terminal').appendChild(container);

        const { term, fitAddon, webglAddon, searchAddon } = this._createTerminal(container);

        const tab = {
          tabId: session.tabId,
          cliId: session.cliId,
          name: session.name,
          icon: session.icon || '\u25b6',
          init: session.init || '',
          buffer: session.buffer || '',
          _createdAt: Date.now(),
          term, fitAddon, webglAddon, searchAddon, container,
        };
        this.tabs.push(tab);

        // Write buffered content to the terminal
        if (tab.buffer && tab.term) {
          try { tab.term.write(tab.buffer); } catch (e) { console.debug('[Tabs] restoreSessions buffer write:', e?.message); }
        }
      }

      // Switch to the first restored tab (or keep current if none)
      if (this.tabs.length > 0 && !this.activeTabId) {
        this.activeTabId = this.tabs[0].tabId;
        this._switchDisplay(this.activeTabId);
        this._updateActiveGlobals(this.activeTabId);
        requestAnimationFrame(() => {
          try { this.fitAddon?.fit(); } catch (e) { console.debug('[Tabs] fitAddon.fit in restoreSessions:', e?.message); }
        });
        const welcome = document.getElementById('welcome-overlay');
        if (welcome) welcome.classList.add('hidden');
      }

      this.render();
      this._startPeriodicSave();
    },
  };

// Legacy compat
Q.Tabs = Tabs;

// ── Save all tabs on page unload ──
window.addEventListener('beforeunload', () => {
  if (Tabs.tabs.length > 0) {
    Tabs.saveActiveTerminal();
    Tabs._persistAllTabs();
  }
});
