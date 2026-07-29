/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Shortcuts Panel — Keyboard shortcut cheat sheet + customization
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ── Master shortcut definitions ──
  const DEFAULT_SHORTCUTS = [
    // Terminal
    { id: 'term-clear',   keys: ['Ctrl', 'L'],              desc: 'Clear screen',               category: 'terminal' },
    { id: 'term-copy',    keys: ['Ctrl', 'Shift', 'C'],     desc: 'Copy selection',             category: 'terminal' },
    { id: 'term-paste',   keys: ['Ctrl', 'Shift', 'V'],     desc: 'Paste from clipboard',       category: 'terminal' },
    { id: 'term-search',  keys: ['Ctrl', 'Shift', 'F'],     desc: 'Toggle terminal search',     category: 'terminal' },
    { id: 'term-font-in', keys: ['Ctrl', '='],              desc: 'Increase font size',         category: 'terminal' },
    { id: 'term-font-out',keys: ['Ctrl', '-'],              desc: 'Decrease font size',         category: 'terminal' },
    { id: 'term-font-reset',keys: ['Ctrl', '0'],            desc: 'Reset font size',            category: 'terminal' },

    // Navigation
    { id: 'nav-sidebar',  keys: ['Ctrl', 'B'],              desc: 'Toggle sidebar',             category: 'navigation' },
    { id: 'nav-search',   keys: ['Ctrl', 'F'],              desc: 'Focus CLI search',           category: 'navigation' },
    { id: 'nav-palette',  keys: ['Ctrl', 'K'],              desc: 'Open command palette',       category: 'navigation' },
    { id: 'nav-palette-alt',keys: ['Ctrl', 'P'],            desc: 'Open command palette (alt)', category: 'navigation' },
    { id: 'nav-shortcuts',keys: ['Ctrl', '/'],              desc: 'Toggle shortcut cheat sheet',category: 'navigation' },

    // Panels
    { id: 'panel-history',keys: ['Ctrl', 'Shift', 'H'],     desc: 'Toggle command history',     category: 'panels' },
    { id: 'panel-chat',   keys: ['Ctrl', 'I'],              desc: 'Toggle AI chat',             category: 'panels' },
    { id: 'panel-globalsearch',keys: ['Ctrl', 'Shift', 'A'],desc: 'Search across all terminals',category: 'panels' },
    { id: 'panel-snippets',keys: ['Ctrl', 'Shift', 'S'],    desc: 'Open snippets panel',        category: 'panels' },

    // Actions
    { id: 'action-reconnect',keys: ['Ctrl', 'Shift', 'R'],  desc: 'Reconnect WebSocket',        category: 'actions' },
    { id: 'action-close', keys: ['Esc'],                     desc: 'Close modal / search bar',   category: 'actions' },
    { id: 'action-mid-copy',keys: ['Middle Click'],          desc: 'Copy selected text',         category: 'actions' },
    { id: 'action-right-paste',keys: ['Right Click'],        desc: 'Paste (context menu)',       category: 'actions' },
  ];

  // ── Category labels ──
  const CATEGORY_LABELS = {
    terminal:   '🖥️  Terminal',
    navigation: '🧭  Navigation',
    panels:     '📋  Panels',
    actions:    '⚡  Actions',
  };

  const CATEGORY_ORDER = ['terminal', 'navigation', 'panels', 'actions'];

  /**
   * Format key array to display string.
   * e.g. ['Ctrl', 'Shift', 'F'] → 'Ctrl+Shift+F'
   */
  function formatKeys(keys) {
    return keys.join('+');
  }

  // ── Panel HTML ──
  let overlay = null;

  function ensurePanel() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'shortcuts-panel-overlay';
    overlay.className = 'modal-overlay hidden';

    let bodyHTML = '';
    for (const cat of CATEGORY_ORDER) {
      const items = DEFAULT_SHORTCUTS.filter(s => s.category === cat);
      if (items.length === 0) continue;
      bodyHTML += `<div class="shortcuts-category"><div class="shortcuts-category-title">${CATEGORY_LABELS[cat] || cat}</div>`;
      for (const s of items) {
        bodyHTML +=
          `<div class="shortcut-row" data-id="${s.id}">` +
            `<span class="shortcut-key">${formatKeys(s.keys)}</span>` +
            `<span class="shortcut-arrow">→</span>` +
            `<span class="shortcut-desc">${s.desc}</span>` +
          `</div>`;
      }
      bodyHTML += `</div>`;
    }

    overlay.innerHTML = `
      <div class="modal shortcuts-modal">
        <div class="settings-header">
          <h2>⌨️ Keyboard Shortcuts</h2>
          <button id="shortcuts-close-btn" class="settings-close-btn">✕</button>
        </div>
        <div class="shortcuts-body">
          ${bodyHTML}
        </div>
        <div class="shortcuts-footer">
          <span class="shortcuts-hint">Press <kbd>Ctrl</kbd>+<kbd>/</kbd> to toggle this panel</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('shortcuts-close-btn').addEventListener('click', closePanel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePanel();
    });
  }

  function openPanel() {
    ensurePanel();
    overlay.classList.remove('hidden');
  }

  function closePanel() {
    if (overlay) overlay.classList.add('hidden');
  }

  function togglePanel() {
    if (overlay && !overlay.classList.contains('hidden')) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ── Conflict detection ──
  function detectConflicts() {
    const seen = {}; // key combo → { id, desc }
    const conflicts = [];

    for (const s of DEFAULT_SHORTCUTS) {
      const combo = formatKeys(s.keys);
      if (seen[combo]) {
        conflicts.push({
          combo,
          a: seen[combo],
          b: { id: s.id, desc: s.desc },
        });
      } else {
        seen[combo] = { id: s.id, desc: s.desc };
      }
    }

    if (conflicts.length > 0) {
      console.warn('⚠️ [QCLI Shortcuts] Detected ' + conflicts.length + ' shortcut conflict(s):');
      for (const c of conflicts) {
        console.warn(
          '  "' + c.combo + '" → "' + c.a.id + '" (' + c.a.desc + ')  <->  "' +
          c.b.id + '" (' + c.b.desc + ')'
        );
      }
    }
    return conflicts;
  }

  // Auto-detect conflicts on load
  if (typeof window !== 'undefined' && window.console) {
    detectConflicts();
  }

  // ── Export API ──
  export const Shortcuts = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    getAll: () => DEFAULT_SHORTCUTS,
    detectConflicts,
  };
  // Legacy compat
  Q.Shortcuts = Shortcuts;

  // Escape key closes the panel if open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
      closePanel();
      // Don't prevent default — let the main Escape handler also fire
    }
  });
