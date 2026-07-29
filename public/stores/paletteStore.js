/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// paletteStore — Command Palette (Cmd+K) State
//
// Manages the command palette overlay: open/close, input,
// filtered results, and keyboard navigation selection.
// ============================================================
// @ts-check
'use strict';

import { createStore } from './createStore.js';

/**
 * @typedef {{ type: 'action'|'cli', id: string, icon: string, name: string, desc: string, category?: string }} PaletteItem
 */

/**
 * @typedef {Object} PaletteState
 * @property {boolean} open
 * @property {string} query - Current search text in palette input
 * @property {PaletteItem[]} items - All available items
 * @property {number} selectedIndex - Currently highlighted item index
 */

const initialState = {
  /** @type {boolean} */
  open: false,
  /** @type {string} */
  query: '',
  /** @type {PaletteItem[]} */
  items: [],
  /** @type {number} */
  selectedIndex: -1,
};

export const paletteStore = createStore(initialState);
