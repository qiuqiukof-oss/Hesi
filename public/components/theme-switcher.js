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
//   Q.DARK_THEME / Q.LIGHT_THEME  (只读 getter，从 --term-* 令牌实时派生)
//   Q.applyTheme(theme)
//   Q.toggleTheme()
//   Q.getPreferredTheme()
// ============================================================
// @ts-check
'use strict';

import { safeStorage } from '../lib/storage.js';
import { buildXtermThemeFor, applyTermThemeToAll } from '../lib/term-theme.js';

/** @typedef {import('../types').QCLI} QCLI */
// XTermTheme 类型已随调色板常量一起迁出，现由 lib/term-theme.js 负责构造。

// ── 调色板常量已移除（单一事实源改造）──
// 颜色现在只在 public/css/theme.css 的 --term-* 令牌中定义一次，
// 运行时由 lib/term-theme.js 用 getComputedStyle 派生为 xterm ITheme。
// 旧的 DARK_THEME / LIGHT_THEME 两份 JS 常量会与 CSS 令牌漂移，故删除；
// Q.DARK_THEME / Q.LIGHT_THEME 仍保留为兼容 getter（见文件末尾 namespace 补丁），
// 其值由对应主题的令牌实时派生，不再是独立事实源。

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

/**
 * 把当前主题同步到**全部**终端。
 *
 * 旧实现只取 `Q.Tabs?.term || Q.term`（当前活动的那一个），多 Tab 场景下
 * 其余终端不会刷新；现委托给 applyTermThemeToAll 遍历全部 Tab。
 * @returns {number} 同步成功的终端数
 */
function _syncTermTheme() {
  return applyTermThemeToAll();
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
  _syncTermTheme();
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
  // 不再 mutate 调色板常量：buildXtermTheme 会读取 localStorage 中的 innerBg，
  // 并以最高优先级覆盖 --term-bg（因此切主题时用户设定的 alpha 不会丢失）
  _syncTermTheme();
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
    // innerBg 由 buildXtermTheme 直接从 localStorage 读取并覆盖 --term-bg，
    // 这里只需触发一次同步即可。
    _syncTermTheme();
  }
}

/** Reset all custom theme settings to defaults */
export function resetCustomTheme() {
  safeStorage.remove(CUSTOM_THEME_KEY);
  document.documentElement.style.removeProperty('--tc-outer-bg');
  // 清掉 localStorage 后，buildXtermTheme 会自动回落到 --term-bg 令牌值，
  // 无需再手动把背景写回硬编码的 '#0d0e10' / '#fafafa'。
  _syncTermTheme();
}

// ── Custom element (for future declarative use) ──
class ThemeSwitcher extends HTMLElement {
  connectedCallback() {
    const Q = window.QCLI || {};
    if (Q.uiStore) {
      this._unsub = Q.uiStore.subscribe(() => _syncTermTheme());
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
    // 兼容 getter：旧代码可能读 Q.DARK_THEME / Q.LIGHT_THEME 取调色板。
    // 不再返回可变常量，而是按需从对应主题的 --term-* 令牌实时派生，
    // 保证外部读到的永远和 CSS 单一事实源一致（且外部 mutate 不会污染全局）。
    Object.defineProperty(Q, 'DARK_THEME', {
      configurable: true,
      enumerable: true,
      get: () => buildXtermThemeFor('dark'),
    });
    Object.defineProperty(Q, 'LIGHT_THEME', {
      configurable: true,
      enumerable: true,
      get: () => buildXtermThemeFor('light'),
    });
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
