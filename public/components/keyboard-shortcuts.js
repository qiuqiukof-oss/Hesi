/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <keyboard-shortcuts> — Global keyboard shortcuts module
//
// Phase 2: Extracts document keydown handler from app.js.
// Auto-initializes at import time. All external references
// go through the QCLI namespace.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

function isInput(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (e.target.closest('.xterm-helper-textarea')) return true;
  return false;
}

/** @param {KeyboardEvent} e */
function onKeydown(e) {
  const Q = /** @type {QCLI} */ (window.QCLI || {});
  const ctrl = e.ctrlKey || e.metaKey;

  // ── Cmd+K / Ctrl+K → toggle command palette ──
  if (ctrl && e.key === 'k' && !e.repeat) {
    const cpInput = document.getElementById('cp-input');
    if (e.target === cpInput) return;
    e.preventDefault();
    if (cpInput === document.activeElement) {
      Q.Palette?.closePalette?.();
    } else {
      Q.Palette?.openPalette?.();
    }
    return;
  }

  // ── Ctrl+P → open palette (alternative) ──
  if (ctrl && e.key === 'p' && !e.repeat && !isInput(e)) {
    e.preventDefault();
    Q.Palette?.openPalette?.();
    return;
  }

  // ── Ctrl+Shift+R → reconnect ──
  if (ctrl && e.shiftKey && e.key === 'r' && !e.repeat) {
    e.preventDefault();
    if (Q.terminalStore) Q.terminalStore.setState({ reconnectAttempts: 0 });
    Q.connectWS?.();
    Q.loadCLIs?.();
    return;
  }

  // ── Ctrl+Shift+F → toggle terminal search ──
  if (ctrl && e.shiftKey && e.key === 'f' && !e.repeat && !isInput(e)) {
    e.preventDefault();
    Q.toggleSearchBar?.();
    return;
  }

  // ── Ctrl+Shift+H → toggle history panel ──
  if (ctrl && e.shiftKey && e.key === 'h' && !e.repeat && !isInput(e)) {
    e.preventDefault();
    const hp = document.getElementById('history-panel');
    if (hp?.classList.contains('hidden')) {
      Q.openHistoryPanel?.();
    } else {
      Q.closeHistoryPanel?.();
    }
    return;
  }

  // ── Ctrl+Shift+A → toggle global search ──
  if (ctrl && e.shiftKey && (e.key === 'a' || e.key === 'A') && !e.repeat && !isInput(e)) {
    e.preventDefault();
    Q.toggleGlobalSearch?.();
    return;
  }

  // ── Ctrl+= / Ctrl+- / Ctrl+0 → font zoom ──
  if (ctrl && (e.key === '=' || e.key === '+') && !e.repeat) {
    e.preventDefault();
    Q.changeFontSize?.(1);
    return;
  }
  if (ctrl && (e.key === '-' || e.key === '_') && !e.repeat) {
    e.preventDefault();
    Q.changeFontSize?.(-1);
    return;
  }
  if (ctrl && e.key === '0' && !e.repeat) {
    e.preventDefault();
    Q.changeFontSize?.(0);
    return;
  }

  // ── Escape → close modal / search ──
  if (e.key === 'Escape') {
    if (!Q.dom?.addOverlay?.classList.contains('hidden')) {
      Q.hideAddModal?.();
    }
    if (Q.searchBarVisible?.()) {
      Q.hideSearchBar?.();
      e.preventDefault();
    }
  }

  // ── Ctrl+/ → toggle shortcut cheat sheet ──
  if (ctrl && e.key === '/' && !e.repeat && !isInput(e)) {
    e.preventDefault();
    Q.Shortcuts?.toggle?.();
    return;
  }

  // ── Ctrl+Shift+S → open snippets panel ──
  if (ctrl && e.shiftKey && (e.key === 's' || e.key === 'S') && !e.repeat && !isInput(e)) {
    e.preventDefault();
    Q.openSnippetPanel?.();
    return;
  }

  // ── Ctrl+L → clear terminal (only when launched) ──
  if (ctrl && e.key === 'l' && Q.state?.launched) {
    e.preventDefault();
    const term = Q.Tabs?.term || Q.term;
    if (term && typeof term.reset === 'function') {
      try { term.reset(); } catch (_) { /* terminal reset may fail if terminal is disposed — non-critical, Ctrl+L still works on next render */ }
    }
  }
}

// ── Custom element (for future declarative use) ──
class KeyboardShortcuts extends HTMLElement {
  connectedCallback() {
    this._handler = (e) => onKeydown(e);
    document.addEventListener('keydown', this._handler);
  }
  disconnectedCallback() {
    if (this._handler) {
      document.removeEventListener('keydown', this._handler);
      this._handler = null;
    }
  }
}
customElements.define('keyboard-shortcuts', KeyboardShortcuts);

// ── Auto-init at import time ──
// Listener is attached in connectedCallback of <keyboard-shortcuts> custom element
// and cleaned up in disconnectedCallback. No module-level listener needed.

export default KeyboardShortcuts;
