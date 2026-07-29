/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <theme-switcher> — Theme management module
//
// Phase 2: Extracts applyTheme / toggleTheme from app.js.
// Auto-initializes at import time (no DOM element required).
// Also defines a custom element for future declarative use.
//
// API on QCLI namespace:
//   Q.DARK_THEME / Q.LIGHT_THEME
//   Q.applyTheme(theme)
//   Q.toggleTheme()
//   Q.getPreferredTheme()
// ============================================================
// @ts-check
'use strict';

import { safeStorage } from '../lib/storage.js';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{background:string, foreground:string, cursor:string, cursorAccent:string, selection:string, black:string, red:string, green:string, yellow:string, blue:string, magenta:string, cyan:string, white:string, brightBlack:string, brightRed:string, brightGreen:string, brightYellow:string, brightBlue:string, brightMagenta:string, brightCyan:string, brightWhite:string}} XTermTheme */

export const DARK_THEME = {
  background: '#0d0e10',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#0d0e10',
  selection: 'rgba(99,102,241,0.3)',
  black: '#18181b', red: '#ef4444', green: '#22c55e', yellow: '#eab308',
  blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e4e4e7',
  brightBlack: '#71717a', brightRed: '#f87171', brightGreen: '#4ade80',
  brightYellow: '#facc15', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9', brightWhite: '#fafafa',
};

export const LIGHT_THEME = {
  background: '#fafafa',
  foreground: '#18181b',
  cursor: '#18181b',
  cursorAccent: '#fafafa',
  selection: 'rgba(99,102,241,0.2)',
  black: '#e4e4e7', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
  blue: '#6366f1', magenta: '#7c3aed', cyan: '#0891b2', white: '#18181b',
  brightBlack: '#a1a1aa', brightRed: '#ef4444', brightGreen: '#22c55e',
  brightYellow: '#eab308', brightBlue: '#818cf8', brightMagenta: '#a78bfa',
  brightCyan: '#22d3ee', brightWhite: '#09090b',
};

/**
 * Get preferred theme from localStorage or system preference
 * @returns {'dark'|'light'}
 */
export function getPreferredTheme() {
  const saved = safeStorage.get('qcli-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'light';  // v0.2.5+: 默认亮色
}

/** @param {string} theme */
function _syncTermTheme(theme) {
  const Q = /** @type {QCLI} */ (window.QCLI || {});
  // Q.term is set by tabs.js to a real Terminal instance (or null).
  // During initial boot it's null until a tab creates a terminal.
  const term = Q.Tabs?.term || Q.term;
  if (term && typeof term.options !== 'undefined' && typeof term.options.theme !== 'undefined') {
    const xtermTheme = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    try {
      term.options.theme = xtermTheme;
      term.refresh(0, term.rows - 1);
    } catch (_) { /* terminal may be disposed during theme sync — non-critical, refresh on next tab switch */ }
  }
}

/**
 * Apply theme and persist to localStorage
 * @param {'dark'|'light'} theme
 */
export function applyTheme(theme) {
  const Q = window.QCLI || {};
  document.documentElement.setAttribute('data-theme', theme);
  if (Q.dom?.themeToggle) {
    Q.dom.themeToggle.textContent = theme === 'dark' ? '\ud83c\udf19' : '\u2600\ufe0f';
    Q.dom.themeToggle.title = theme === 'dark' ? '\u5207\u6362\u5230\u4eae\u8272\u4e3b\u9898' : '\u5207\u6362\u5230\u6df1\u8272\u4e3b\u9898';
  }
  _syncTermTheme(theme);
  safeStorage.set('qcli-theme', theme);
  if (Q.state) Q.state.theme = theme;
  if (Q.uiStore) Q.uiStore.setState({ theme });
}

/** Toggle between dark and light theme */
export function toggleTheme() {
  const Q = window.QCLI || {};
  const current = Q.state?.theme || document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ============================================================
// Custom Theme — Inner/Outer background override
// ============================================================
const CUSTOM_THEME_KEY = 'cli-q-custom-theme';

/**
 * Get custom theme settings from localStorage
 * @returns {{innerBg?:string, outerBg?:string, savedName?:string}|null}
 */
export function getCustomTheme() {
  return safeStorage.getJSON(CUSTOM_THEME_KEY);
}

/**
 * Save custom theme settings to localStorage
 * @param {{innerBg?:string, outerBg?:string, savedName?:string}} settings
 */
export function saveCustomTheme(settings) {
  safeStorage.setJSON(CUSTOM_THEME_KEY, settings);
}

/**
 * Apply custom inner background color with alpha
 * @param {string} colorWithAlpha - e.g. 'rgba(13,14,16,0.75)'
 */
export function applyCustomInnerBg(colorWithAlpha) {
  const s = getCustomTheme() || {};
  s.innerBg = colorWithAlpha;
  saveCustomTheme(s);
  // Mutate the active theme object so _syncTermTheme picks it up
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const obj = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
  obj.background = colorWithAlpha;
  _syncTermTheme(theme);
}

/**
 * Apply custom outer background color
 * @param {string} color - e.g. '#0a0a0b'
 */
export function applyCustomOuterBg(color) {
  const s = getCustomTheme() || {};
  s.outerBg = color;
  saveCustomTheme(s);
  document.documentElement.style.setProperty('--tc-outer-bg', color);
}

/** Restore custom background settings from localStorage */
export function applyCustomBgFromStorage() {
  const s = getCustomTheme();
  if (!s) return;
  if (s.outerBg) {
    document.documentElement.style.setProperty('--tc-outer-bg', s.outerBg);
  }
  if (s.innerBg) {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const obj = theme === 'dark' ? DARK_THEME : LIGHT_THEME;
    obj.background = s.innerBg;
    _syncTermTheme(theme);
  }
}

/** Reset all custom theme settings to defaults */
export function resetCustomTheme() {
  safeStorage.remove(CUSTOM_THEME_KEY);
  document.documentElement.style.removeProperty('--tc-outer-bg');
  DARK_THEME.background = '#0d0e10';
  LIGHT_THEME.background = '#fafafa';
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  _syncTermTheme(theme);
}

// ── Custom element (for future declarative use) ──
class ThemeSwitcher extends HTMLElement {
  connectedCallback() {
    const Q = window.QCLI || {};
    if (Q.uiStore) {
      this._unsub = Q.uiStore.subscribe((s) => _syncTermTheme(s.theme));
    }
  }
  disconnectedCallback() {
    if (this._unsub) this._unsub();
  }
}
customElements.define('theme-switcher', ThemeSwitcher);

// ── Auto-init at import time ──
// Listen for system theme changes
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!safeStorage.get('qcli-theme')) {
      applyTheme(e.matches ? 'light' : 'dark');
    }
  });
}

// Patch QCLI namespace (deferred to not conflict with app.js)
Promise.resolve().then(() => {
  const Q = window.QCLI || {};
  if (!Q._themePatched) {
    Q.DARK_THEME = DARK_THEME;
    Q.LIGHT_THEME = LIGHT_THEME;
    Q.getPreferredTheme = getPreferredTheme;
    Q.applyTheme = applyTheme;
    Q.toggleTheme = toggleTheme;
    Q.getCustomTheme = getCustomTheme;
    Q.saveCustomTheme = saveCustomTheme;
    Q.applyCustomInnerBg = applyCustomInnerBg;
    Q.applyCustomOuterBg = applyCustomOuterBg;
    Q.applyCustomBgFromStorage = applyCustomBgFromStorage;
    Q.resetCustomTheme = resetCustomTheme;
    Q._themePatched = true;
  }
  // Restore custom background overrides from localStorage
  if (window.QCLI?.applyCustomBgFromStorage) {
    window.QCLI.applyCustomBgFromStorage();
  }
});

export default ThemeSwitcher;
