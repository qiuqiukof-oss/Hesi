/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <command-palette> — Web Component wrapping Cmd+K palette
//
// Phase 2: Extracts palette logic from app.js into a reusable
// Custom Element. Uses the existing DOM in index.html (Light DOM)
// so global CSS and external callers continue to work.
//
// API
//   element.open()
//   element.close()
//   Q.Palette.openPalette / closePalette (delegated)
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{id:string, icon:string, name:string, desc:string, category:string, type:string, _execute?:Function}} PaletteItem */

const COMMAND_ACTIONS = [
  { id: 'add-cli', icon: '\u2795', name: 'Add CLI', desc: 'Register a new CLI tool', category: 'action' },
  { id: 'discover', icon: '\u27f3', name: 'Discover CLIs', desc: 'Scan PATH for new CLI tools', category: 'action' },
  { id: 'toggle-theme', icon: '\ud83c\udfa8', name: 'Toggle Theme', desc: 'Switch between dark and light mode', category: 'action' },
  { id: 'toggle-sidebar', icon: '\ud83d\udcd0', name: 'Toggle Sidebar', desc: 'Collapse or expand the sidebar', category: 'action' },
  { id: 'reconnect', icon: '\ud83d\udd0c', name: 'Reconnect', desc: 'Re-establish WebSocket connection', category: 'action' },
  { id: 'clear-terminal', icon: '\ud83e\uddf9', name: 'Clear Terminal', desc: 'Reset the terminal display', category: 'action' },
  { id: 'reset-font', icon: '\ud83d\udd24', name: 'Reset Font Size', desc: 'Restore default terminal font size (14px)', category: 'action' },
  { id: 'custom-css', icon: '\ud83c\udfa8', name: 'Custom CSS', desc: 'Open the custom CSS editor to override styles', category: 'action' },
  { id: 'open-settings', icon: '\u2699\ufe0f', name: 'Settings', desc: 'Open the settings panel', category: 'action' },
  { id: 'open-history', icon: '\ud83d\udcdc', name: 'Command History', desc: 'Browse global command history (Ctrl+Shift+H)', category: 'action' },
  { id: 'open-snippets', icon: '\ud83d\udccb', name: 'Snippet Library', desc: 'Manage command snippets', category: 'action' },
  { id: 'open-workspaces', icon: '\ud83d\udcc2', name: 'Workspace Profiles', desc: 'Save and restore tab configurations', category: 'action' },
];

// ── Icon map (mirrored from cliStore for independence) ──
function getCLIIcon(name) {
  const icons = {
    opencode: '\u26a1', node: '\ud83d\udfe2',
    python: '\ud83d\udc0d', python3: '\ud83d\udc0d',
    git: '\u2387', docker: '\ud83d\udc33', kubectl: '\u2638',
    npm: '\ud83d\udce6', npx: '\ud83d\udce6', pnpm: '\ud83d\udce6',
    yarn: '\ud83d\udce6', bun: '\ud83e\udd5f',
    bash: '>_', zsh: '%', powershell: '\ud83e\ude9f', pwsh: '\ud83e\ude9f', cmd: '>',
    ssh: '\ud83d\udd10', mysql: '\ud83d\udc2c', redis: '\ud83d\udd34',
    mongosh: '\ud83c\udf43', cargo: '\ud83e\udd80', go: '\ud83d\udd37',
    deno: '\ud83e\udd95',
    vim: '\u270f\ufe0f', nvim: '\u270f\ufe0f', nano: '\u270f\ufe0f',
    tmux: '\u229e', lazygit: '\u2387', gh: '\ud83d\udc19',
    code: '\ud83d\udcbb', curl: '\ud83c\udf10', wget: '\u2b07',
    htop: '\ud83d\udcca', btop: '\ud83d\udcca',
    neofetch: '\ud83d\udda5', fastfetch: '\ud83d\udda5',
  };
  return icons[name] || '\u25b8';
}

/** @param {string} cat @returns {string} */
function getCategoryLabel(cat) {
  return cat === 'agent' ? 'Agent' : cat === 'directory' ? 'Env' : cat === 'tool' ? 'Tool' : cat || '';
}

// ── Helper: read QCLI CDN-exempt getCategoryIcon from Q namespace ──
function qGetCategoryIcon(cat) {
  try { return window.QCLI.getCategoryIcon(cat); } catch { return '\ud83d\udce6'; }
}

// ============================================================
class CommandPalette extends HTMLElement {
  constructor() {
    super();
    /** @type {boolean} */
    this._open = false;
    /** @type {Array} */
    this.items = [];
    /** @type {number} */
    this.selectedIndex = -1;
    /** @type {Array} */
    this._snippetCache = [];
    /** @type {Function|null} */
    this._unsubStore = null;
    // DOM refs — set in connectedCallback
    this.overlay = null;
    this.input = null;
    this.results = null;
  }

  // ── Lifecycle ──

  connectedCallback() {
    this.overlay = document.getElementById('cp-overlay');
    this.input = document.getElementById('cp-input');
    this.results = document.getElementById('cp-results');

    if (!this.overlay) {
      console.warn('[CommandPalette] #cp-overlay not found in DOM');
      return;
    }

    this._setupEvents();
    this._refreshSnippetCache();

    // Sync with paletteStore if available
    const Q = window.QCLI || {};
    if (Q.paletteStore) {
      this._unsubStore = Q.paletteStore.subscribe((s) => {
        if (s.open && !this._open) this.open();
        else if (!s.open && this._open) this.close();
      });
    }

    // Register on QCLI namespace (deferred to not conflict with app.js init)
    this._patchQCLI();

    // Listen for CLI data changes to refresh items
    if (Q.cliStore) {
      this._unsubCLI = Q.cliStore.subscribe(() => {
        if (this._open) this._renderResults();
      });
    }
  }

  disconnectedCallback() {
    if (this._unsubStore) this._unsubStore();
    if (this._unsubCLI) this._unsubCLI();
  }

  // ── Public API ──

  open() {
    if (!this.overlay || !this.input || this._open) return;
    this.overlay.classList.remove('hidden');
    this.input.value = '';
    this.selectedIndex = -1;
    this.items = [];
    this._renderResults();
    requestAnimationFrame(() => { if (this.input) this.input.focus(); });
    this._open = true;

    // Sync to store
    const Q = window.QCLI || {};
    if (Q.paletteStore) Q.paletteStore.setState({ open: true });
  }

  close(focusTerminal) {
    if (!this.overlay || !this._open) return;
    this.overlay.classList.add('hidden');
    this._open = false;
    this.selectedIndex = -1;

    if (focusTerminal) {
      const Q = window.QCLI || {};
      const term = Q.Tabs?.term || Q.term;
      if (term && typeof term.focus === 'function') {
        setTimeout(() => { try { term.focus(); } catch (e) { /* terminal may be disposed after palette close — non-critical, user can focus manually */ } }, 0);
      }
    }

    // Sync to store
    const Q = window.QCLI || {};
    if (Q.paletteStore) Q.paletteStore.setState({ open: false });
  }

  // ── Internal setup ──

  _patchQCLI() {
    // Defer to next microtask so app.js synchronous init finishes first
    Promise.resolve().then(() => {
      const Q = window.QCLI || {};
      Q.Palette = Q.Palette || {};
      // Only override if not already patched
      if (!Q.Palette._patched) {
        Q.Palette.openPalette = () => this.open();
        Q.Palette.closePalette = (focusTerminal) => this.close(focusTerminal);
        Q.Palette._patched = true;
      }
    });
  }

  _setupEvents() {
    // Close on overlay backdrop click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close(false);
    });

    // Input filtering
    this.input.addEventListener('input', () => this._renderResults());

    // Keyboard navigation
    this.input.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this._navigate(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this._navigate(-1);
          break;
        case 'Enter':
          e.preventDefault();
          this._executeSelection();
          break;
        case 'Escape':
          e.preventDefault();
          this.close(true);
          break;
      }
    });
  }

  // ── Snippet cache ──

  async _refreshSnippetCache() {
    try {
      const Q = window.QCLI || {};
      if (Q.SnippetStore) {
        this._snippetCache = await Q.SnippetStore.getAll() || [];
      }
    } catch (e) {
      this._snippetCache = [];
    }
  }

  // ── Item building ──

  _buildItems() {
    /** @type {PaletteItem[]} */
    const items = [];

    // Static actions
    for (const action of COMMAND_ACTIONS) {
      items.push({ type: 'action', ...action });
    }

    // Plugin commands from UIRegistry
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    const UIR = Q.UIRegistry;
    if (UIR) {
      const pluginCmds = UIR.getCommands();
      for (const cmd of pluginCmds) {
        items.push({
          type: 'plugin',
          id: cmd.id,
          icon: cmd.icon,
          name: cmd.name,
          desc: cmd.desc,
          category: cmd.category || 'plugin',
          _execute: cmd.execute,
        });
      }
    }

    // CLI items
    const clis = Q.state?.clis || [];
    for (const cli of clis) {
      items.push({
        type: 'cli',
        id: cli.id,
        icon: getCLIIcon(cli.name),
        name: cli.name,
        desc: cli.version && cli.version !== 'unknown' ? `v${cli.version}` : (cli.type || 'CLI'),
        category: cli.category || 'tool',
      });
    }

    return items;
  }

  // ── Rendering ──

  _renderResults() {
    const query = this.input.value.toLowerCase().trim();
    let items = this._buildItems();

    if (query) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(query) ||
        (item.desc && item.desc.toLowerCase().includes(query))
      );
    }

this.results.innerHTML = '';

    if (items.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'cp-empty';
      emptyDiv.textContent = 'No results for "' + this.input.value + '"';
      this.results.appendChild(emptyDiv);
      this.items = [];
      this.selectedIndex = -1;
      return;
    }

    this.items = items;
    if (this.selectedIndex >= items.length) this.selectedIndex = items.length - 1;
    if (this.selectedIndex < 0 && items.length > 0) this.selectedIndex = 0;

    // Group by type
    const actionItems = items.filter(i => i.type === 'action');
    const cliItems = items.filter(i => i.type === 'cli');

    const fragment = document.createDocumentFragment();

    if (actionItems.length > 0) {
      const label = document.createElement('div');
      label.className = 'cp-section-label';
      label.textContent = 'Actions';
      fragment.appendChild(label);

      for (const item of actionItems) {
        fragment.appendChild(this._createItemEl(item));
      }
    }

    if (cliItems.length > 0) {
      const label = document.createElement('div');
      label.className = 'cp-section-label';
      label.textContent = `CLIs (${cliItems.length})`;
      fragment.appendChild(label);

      for (const item of cliItems) {
        fragment.appendChild(this._createItemEl(item));
      }
    }

    this.results.appendChild(fragment);
    this._updateHighlight();
    this._scrollToSelected();
  }

  _createItemEl(item) {
    const el = document.createElement('div');
    el.className = 'cp-item';
    el.dataset.index = String(this.items.indexOf(item));

    const icon = document.createElement('span');
    icon.className = 'cp-item-icon';
    icon.textContent = item.icon || '\u25b8';
    el.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'cp-item-body';

    const name = document.createElement('div');
    name.className = 'cp-item-name';
    name.textContent = item.name;
    body.appendChild(name);

    if (item.desc) {
      const desc = document.createElement('div');
      desc.className = 'cp-item-desc';
      desc.textContent = item.desc;
      body.appendChild(desc);
    }

    el.appendChild(body);

    const badge = document.createElement('span');
    badge.className = `cp-item-badge ${item.type === 'action' ? 'action' : item.category}`;
    badge.textContent = item.type === 'action' ? 'Cmd' : getCategoryLabel(item.category);
    el.appendChild(badge);

    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index, 10);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this._executeSelection();
      }
    });

    el.addEventListener('mouseenter', () => {
      const idx = parseInt(el.dataset.index, 10);
      if (idx >= 0) {
        this.selectedIndex = idx;
        this._updateHighlight();
      }
    });

    return el;
  }

  // ── Navigation ──

  _navigate(direction) {
    if (this.items.length === 0) return;
    this.selectedIndex += direction;
    if (this.selectedIndex < 0) this.selectedIndex = this.items.length - 1;
    if (this.selectedIndex >= this.items.length) this.selectedIndex = 0;
    this._updateHighlight();
    this._scrollToSelected();
  }

  _updateHighlight() {
    const all = this.results.querySelectorAll('.cp-item');
    all.forEach((el, i) => {
      el.classList.toggle('highlighted', i === this.selectedIndex);
    });
  }

  _scrollToSelected() {
    const highlighted = this.results.querySelector('.cp-item.highlighted');
    if (highlighted) {
      try { highlighted.scrollIntoView({ block: 'nearest' }); } catch (e) { console.debug('[Palette] scrollIntoView:', e?.message); }
    }
  }

  // ── Execution ──

  _executeSelection() {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.items.length) return;
    const item = this.items[this.selectedIndex];
    this.close();

    const Q = /** @type {QCLI} */ (window.QCLI || {});

    switch (item.type) {
      case 'cli':
        if (Q.Sidebar?.launchCLI) Q.Sidebar.launchCLI(item.id);
        break;
      case 'plugin':
        if (item._execute) item._execute();
        break;
      case 'action':
        switch (item.id) {
          case 'add-cli':
            if (Q.Sidebar?.showAddModal) Q.Sidebar.showAddModal();
            break;
          case 'discover':
            if (Q.Sidebar?.discoverCLIs) Q.Sidebar.discoverCLIs();
            break;
          case 'toggle-theme':
            if (Q.toggleTheme) Q.toggleTheme();
            break;
          case 'toggle-sidebar':
            if (Q.toggleSidebar) Q.toggleSidebar();
            break;
          case 'reconnect':
            if (Q.terminalStore) Q.terminalStore.setState({ reconnectAttempts: 0 });
            if (Q.connectWS) Q.connectWS();
            if (Q.loadCLIs) Q.loadCLIs();
            break;
          case 'clear-terminal': {
            const term = Q.Tabs?.term || Q.term;
            if (term && typeof term.reset === 'function') {
              try { term.reset(); } catch (e) { /* terminal reset may fail if terminal is disposed — non-critical */ }
            }
            break;
          }
          case 'reset-font':
            if (Q.changeFontSize) Q.changeFontSize(0);
            break;
          case 'custom-css':
            if (Q.CustomCSS?.open) Q.CustomCSS.open();
            break;
          case 'open-settings':
            if (Q.Settings?.open) Q.Settings.open();
            break;
          case 'open-history':
            if (Q.openHistoryPanel) Q.openHistoryPanel();
            break;
          case 'open-snippets':
            if (Q.openSnippetPanel) Q.openSnippetPanel();
            break;
          case 'open-workspaces':
            if (Q.openWorkspacePanel) Q.openWorkspacePanel();
            break;
        }
        break;
    }
  }
}

customElements.define('command-palette', CommandPalette);

export default CommandPalette;
