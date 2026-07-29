/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// uiStore — Theme, sidebar, font, language, and panel states
//
// Manages UI chrome: dark/light theme, sidebar collapse/width,
// terminal font size, language preference, and panel visibility.
// ============================================================
// @ts-check
'use strict';

import { createStore } from './createStore.js';
import { safeStorage } from '../lib/storage.js';

/**
 * @typedef {Object} UiState
 * @property {'dark'|'light'} theme
 * @property {boolean} sidebarCollapsed
 * @property {number} sidebarWidth
 * @property {number} terminalFontSize
 * @property {string} language - 'zh' | 'en'
 * @property {boolean} rightPanelVisible
 * @property {boolean} chatDrawerOpen
 * @property {number} chatDrawerHeight
 */

/** @returns {'dark'|'light'} */
function getSavedTheme() {
  const saved = safeStorage.get('qcli-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

/** @returns {number} */
function getSavedSidebarWidth() {
  const w = parseInt(safeStorage.get('qcli-sidebar-width', '240'), 10);
  if (w >= 160 && w <= 480) return w;
  return 240;
}

/** @returns {number} */
function getSavedFontSize() {
  const s = parseInt(safeStorage.get('qcli-font-size', '14'), 10);
  if (s >= 8 && s <= 32 && s !== 14) return s;
  return 14;
}

/** @returns {'zh'|'en'} */
function getSavedLanguage() {
  const lang = safeStorage.get('qcli-lang');
  if (lang === 'en' || lang === 'zh') return lang;
  return 'zh';
}

const initialState = {
  /** @type {'dark'|'light'} */
  theme: getSavedTheme(),
  /** @type {boolean} */
  sidebarCollapsed: safeStorage.get('qcli-sidebar-collapsed') === '1',
  /** @type {number} */
  sidebarWidth: getSavedSidebarWidth(),
  /** @type {number} */
  terminalFontSize: getSavedFontSize(),
  /** @type {string} */
  language: getSavedLanguage(),
  /** @type {boolean} */
  rightPanelVisible: false,
  /** @type {boolean} */
  chatDrawerOpen: safeStorage.get('qcli-chat-open') === '1',
  /** @type {number} */
  chatDrawerHeight: (() => {
    const h = parseInt(safeStorage.get('qcli-chat-height', '280'), 10);
    if (h >= 120) return h;
    return 280;
  })(),
};

export const uiStore = createStore(initialState);

// ── Persistence helpers (auto-save to localStorage on change) ──
uiStore.subscribe((state) => {
  safeStorage.set('qcli-theme', state.theme);
  safeStorage.set('qcli-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
  safeStorage.set('qcli-sidebar-width', String(state.sidebarWidth));
  safeStorage.set('qcli-font-size', String(state.terminalFontSize));
  safeStorage.set('qcli-lang', state.language);
  safeStorage.set('qcli-chat-open', state.chatDrawerOpen ? '1' : '0');
  safeStorage.set('qcli-chat-height', String(state.chatDrawerHeight));
});
