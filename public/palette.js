/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Command Palette Module
//
// Phase 2: Delegates to <command-palette> Web Component.
// Keeps backward compat: Q.Palette namespace, loadSnippets.
// ============================================================
'use strict';

// Import the Web Component — triggers customElements.define('command-palette')
// The component's _patchQCLI() (deferred via microtask) will overwrite
// Q.Palette.openPalette / closePalette after app.js runs.
import './components/command-palette.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/**
 * @typedef {Object} PaletteAPI
 * @property {boolean} open
 * @property {HTMLElement|null} input
 * @property {HTMLElement|null} results
 * @property {HTMLElement|null} overlay
 * @property {number} highlightedIdx
 * @property {Array} items
 * @property {null|Function} openPalette
 * @property {null|Function} closePalette
 * @property {null|Function} init
 */

/** @type {PaletteAPI} */
export const Palette = {
  // Legacy refs (kept for backward compat with old callers)
  open: false,
  input: null,
  results: null,
  overlay: null,
  highlightedIdx: 0,
  items: [],
  openPalette: null,
  closePalette: null,
  init: null,

  // ── Snippet integration (used by app.js _refreshSnippetCache) ──
  /**
   * Load all snippets from store.
   * @returns {Promise<Array>}
   */
  async loadSnippets() {
    if (!Q.SnippetStore) return [];
    return await Q.SnippetStore.getAll();
  },
};

Q.Palette = Palette;
