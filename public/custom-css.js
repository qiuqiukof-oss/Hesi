/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Custom CSS Module — Inject user-defined styles from localStorage
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

const STORAGE_KEY = 'qcli-custom-css';

import { safeStorage } from './lib/storage.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

let _escapeHandler = null;

/**
 * Load custom CSS from localStorage and inject it into the page.
 * Returns the current custom CSS string.
 */
export function loadCustomCSS() {
    let css = '';
    css = safeStorage.get(STORAGE_KEY, '');

    // Remove existing style tag if any
    const existing = document.getElementById('custom-css-style');
    if (existing) existing.remove();

    if (css.trim()) {
      const style = document.createElement('style');
      style.id = 'custom-css-style';
      style.textContent = css;
      document.head.appendChild(style);
    }

    return css;
  }

  /**
   * Save custom CSS to localStorage and reload it.
   * @param {string} css
   */
  function saveCustomCSS(css) {
    safeStorage.set(STORAGE_KEY, css);
    loadCustomCSS();
  }

  /**
   * Open the custom CSS editor overlay (a simple modal with textarea).
   */
  function openCSSEditor() {
    const overlay = document.getElementById('custom-css-overlay');
    if (!overlay) {
      createCSSEditor();
    }
    const editor = document.getElementById('custom-css-editor');
    const existing = document.getElementById('custom-css-style');
    if (editor) {
      editor.value = loadCustomCSS();
    }
    document.getElementById('custom-css-overlay').classList.remove('hidden');
    if (editor) {
      setTimeout(() => editor.focus(), 100);
    }
    // Re-attach escape handler if not already attached
    if (!_escapeHandler) {
      _escapeHandler = function escapeHandler(e) {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
          closeCSSEditor();
          document.removeEventListener('keydown', _escapeHandler);
          _escapeHandler = null;
        }
      };
      document.addEventListener('keydown', _escapeHandler);
    }
  }

  function closeCSSEditor() {
    const overlay = document.getElementById('custom-css-overlay');
    if (overlay) overlay.classList.add('hidden');
    // Remove escape handler
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
      _escapeHandler = null;
    }
  }

  /**
   * Create the CSS editor overlay dynamically if it doesn't exist in HTML.
   */
  function createCSSEditor() {
    const existing = document.getElementById('custom-css-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.id = 'custom-css-overlay';
    overlay.className = 'modal-overlay hidden';
    overlay.style.zIndex = '700';

    overlay.innerHTML = `
      <div class="modal" style="width:600px;max-width:90vw;">
        <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span>🎨</span>
          <span data-i18n="customCSS.title">Custom CSS</span>
        </h2>
        <p style="font-size:12px;color:var(--text-tertiary);margin-bottom:12px;line-height:1.5;">
          Override any style with your own CSS. Changes are saved to localStorage and applied immediately.
          Use <code style="font-family:var(--font-mono);font-size:11px;background:var(--bg-hover);padding:1px 5px;border-radius:3px;">--accent</code>,
          <code style="font-family:var(--font-mono);font-size:11px;background:var(--bg-hover);padding:1px 5px;border-radius:3px;">--bg-surface</code>, etc.
          <a href="#" id="custom-css-help-link" style="color:var(--accent);text-decoration:none;" onclick="document.getElementById('custom-css-editor').value='/* Hesi CSS Variables */\\n:root {\\n  --accent: #6366f1;\\n  --accent-sub: #06b6d4;\\n  --bg-ground: #0a0a0b;\\n  --text-primary: #fafafa;\\n}\\n';return false;">Show variables</a>
        </p>
        <textarea id="custom-css-editor" spellcheck="false" style="
          width:100%;
          height:300px;
          background:var(--bg-ground);
          border:1px solid var(--border-default);
          border-radius:var(--radius-lg);
          color:var(--text-primary);
          font-family:var(--font-mono);
          font-size:12px;
          line-height:1.6;
          padding:12px;
          outline:none;
          resize:vertical;
          tab-size:2;
        " placeholder="/* Write your custom CSS here */\\n:root {\\n  --accent: #ff6b6b;\\n}"></textarea>
        <div class="modal-actions" style="margin-top:12px;">
          <button type="button" id="custom-css-reset" class="secondary-btn" style="margin-right:auto;">Reset</button>
          <button type="button" id="custom-css-cancel" class="secondary-btn">Cancel</button>
          <button type="button" id="custom-css-apply" class="primary-btn">Apply</button>
        </div>
        <p id="custom-css-status" style="font-size:11px;color:var(--success);margin-top:8px;display:none;"></p>
      </div>
    `;

    document.body.appendChild(overlay);

    // Wire up events
    document.getElementById('custom-css-apply').addEventListener('click', () => {
      const editor = document.getElementById('custom-css-editor');
      if (editor) {
        saveCustomCSS(editor.value);
        const status = document.getElementById('custom-css-status');
        status.textContent = '✅ Custom CSS applied';
        status.style.display = '';
        setTimeout(() => { status.style.display = 'none'; }, 2000);
      }
    });

    document.getElementById('custom-css-cancel').addEventListener('click', closeCSSEditor);

    document.getElementById('custom-css-reset').addEventListener('click', () => {
      if (confirm('Reset all custom CSS? This cannot be undone.')) {
        saveCustomCSS('');
        document.getElementById('custom-css-editor').value = '';
        const status = document.getElementById('custom-css-status');
        status.textContent = '✅ Custom CSS reset';
        status.style.display = '';
        setTimeout(() => { status.style.display = 'none'; }, 2000);
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCSSEditor();
    });
  }

  // ── Initialise ──
  loadCustomCSS();

  // Legacy compat
  Q.CustomCSS = {
    load: loadCustomCSS,
    save: saveCustomCSS,
    open: openCSSEditor,
    close: closeCSSEditor,
  };

  // Auto-load custom CSS on page load
  if (document.readyState === 'complete') {
    loadCustomCSS();
  } else {
    window.addEventListener('load', loadCustomCSS);
  }
