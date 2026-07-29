/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <theme-customizer> — Terminal background customization panel
//
// Provides color pickers for:
//   - Terminal inner background (xterm.js background + alpha)
//   - Terminal outer background (container behind terminal)
//   - Quick presets + custom save/reset
//
// Auto-wires the toggle button (#theme-customize-btn) and
// the popover panel (#theme-customizer) at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{panel:HTMLElement, toggleBtn:HTMLElement|null, closeBtn:HTMLElement|null, innerColor:HTMLInputElement|null, innerAlpha:HTMLInputElement|null, innerLabel:HTMLElement|null, outerColor:HTMLInputElement|null, outerLabel:HTMLElement|null, presets:NodeListOf<Element>, saveBtn:HTMLElement|null, resetBtn:HTMLElement|null}} CustomizerDom */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

// ── Preset definitions ──
const PRESETS = {
  'dark': {
    label: '暗色默认',
    innerBg: '#0d0e10',
    innerAlpha: 100,
    outerBg: '#0a0a0b',
  },
  'light': {
    label: '亮色默认',
    innerBg: '#fafafa',
    innerAlpha: 100,
    outerBg: '#f5f5f5',
  },
  'transparent-dark': {
    label: '半透暗色',
    innerBg: '#0d0e10',
    innerAlpha: 75,
    outerBg: '#0a0a0b',
  },
  'transparent-light': {
    label: '半透亮色',
    innerBg: '#fafafa',
    innerAlpha: 70,
    outerBg: '#f5f5f5',
  },
  'paper': {
    label: '纸质古书',
    innerBg: '#e8d5a3',
    innerAlpha: 92,
    outerBg: '#5c3a1e',
  },
};

// ── DOM refs (cached on first open) ──
/** @type {CustomizerDom|null} */
let dom = null;

/** @returns {CustomizerDom|null} */
function getDom() {
  if (dom) return dom;
  const el = document.getElementById('theme-customizer');
  if (!el) return null;
  dom = {
    panel: el,
    toggleBtn: document.getElementById('theme-customize-btn'),
    closeBtn: document.getElementById('tc-close'),
    innerColor: /** @type {HTMLInputElement|null} */ (document.getElementById('tc-inner-bg')),
    innerAlpha: /** @type {HTMLInputElement|null} */ (document.getElementById('tc-inner-alpha')),
    innerLabel: document.getElementById('tc-inner-label'),
    outerColor: /** @type {HTMLInputElement|null} */ (document.getElementById('tc-outer-bg')),
    outerLabel: document.getElementById('tc-outer-label'),
    presets: document.querySelectorAll('.tc-preset'),
    saveBtn: document.getElementById('tc-save-preset'),
    resetBtn: document.getElementById('tc-reset-default'),
  };
  return dom;
}

// ── Open / Close ──
export function open() {
  const d = getDom();
  if (!d || !d.panel) return;
  syncUIFromStorage();
  d.panel.classList.remove('hidden');
  // Use rAF to trigger CSS transition
  requestAnimationFrame(() => d.panel.classList.add('visible'));
}

export function close() {
  const d = getDom();
  if (!d || !d.panel) return;
  d.panel.classList.remove('visible');
  setTimeout(() => d.panel.classList.add('hidden'), 150);
}

export function toggle() {
  const d = getDom();
  if (!d || !d.panel) return;
  if (d.panel.classList.contains('visible')) {
    close();
  } else {
    open();
  }
}

// ── Sync UI from localStorage ──
function syncUIFromStorage() {
  const q = Q();
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const d = getDom();
  if (!d) return;

  const custom = q.getCustomTheme ? q.getCustomTheme() : null;

  // Inner bg
  let innerBg, innerAlpha;
  if (custom && custom.innerBg) {
    // Parse rgba to get color + alpha
    const rgba = parseRGBA(custom.innerBg);
    innerBg = rgba ? rgba.color : (theme === 'dark' ? '#0d0e10' : '#fafafa');
    innerAlpha = rgba ? rgba.alpha : 100;
  } else {
    innerBg = theme === 'dark' ? '#0d0e10' : '#fafafa';
    innerAlpha = 100;
  }
  d.innerColor.value = innerBg;
  d.innerAlpha.value = String(innerAlpha);
  updateInnerLabel(innerBg, innerAlpha);

  // Outer bg
  if (custom && custom.outerBg) {
    d.outerColor.value = custom.outerBg;
    d.outerLabel.textContent = custom.outerBg;
  } else {
    const defaultOuter = theme === 'dark' ? '#0a0a0b' : '#f5f5f5';
    d.outerColor.value = defaultOuter;
    d.outerLabel.textContent = defaultOuter;
  }

  // Update alpha slider gradient preview
  updateAlphaPreview(innerBg);
}

// ── Parse rgba() or hex → { color, alpha } ──
/**
 * @param {string} str
 * @returns {{color:string, alpha:number}|null}
 */
function parseRGBA(str) {
  if (!str) return null;
  // rgba(r, g, b, a)
  const rgbaMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const alpha = rgbaMatch[4] ? Math.round(parseFloat(rgbaMatch[4]) * 100) : 100;
    return { color: hex, alpha };
  }
  // hex
  if (str.startsWith('#')) {
    return { color: str, alpha: 100 };
  }
  return null;
}

// ── Update inner bg label ──
/** @param {string} hex @param {number} alpha */
function updateInnerLabel(hex, alpha) {
  const d = getDom();
  if (!d) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = (alpha / 100).toFixed(2);
  const rgba = `rgba(${r},${g},${b},${a})`;
  if (d.innerLabel) d.innerLabel.textContent = rgba;
}

// ── Update alpha slider gradient preview ──
/** @param {string} hex */
function updateAlphaPreview(hex) {
  const d = getDom();
  if (!d || !d.innerAlpha) return;
  d.innerAlpha.style.setProperty('--tc-inner-preview', hex || '#0d0e10');
}

// ── Apply inner bg ──
function applyInnerBg() {
  const d = getDom();
  if (!d || !d.innerColor || !d.innerAlpha) return;
  const hex = d.innerColor.value;
  const alpha = parseInt(d.innerAlpha.value, 10);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = (alpha / 100).toFixed(2);
  const rgba = `rgba(${r},${g},${b},${a})`;
  updateInnerLabel(hex, alpha);
  const q = Q();
  if (q.applyCustomInnerBg) q.applyCustomInnerBg(rgba);
}

// ── Apply outer bg ──
function applyOuterBg() {
  const d = getDom();
  if (!d || !d.outerColor || !d.outerLabel) return;
  const color = d.outerColor.value;
  d.outerLabel.textContent = color;
  const q = Q();
  if (q.applyCustomOuterBg) q.applyCustomOuterBg(color);
}

// ── Apply preset ──
/** @param {string} presetKey */
function applyPreset(presetKey) {
  const preset = PRESETS[/** @type {keyof typeof PRESETS} */ (presetKey)];
  if (!preset) return;
  const d = getDom();
  if (!d) return;

  // Update presets active state
  d.presets.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === presetKey);
  });

  // Apply light/dark base theme if applicable
  if (presetKey === 'dark' || presetKey === 'transparent-dark') {
    if (Q().applyTheme) Q().applyTheme('dark');
  } else if (presetKey === 'light' || presetKey === 'transparent-light' || presetKey === 'paper') {
    if (Q().applyTheme) Q().applyTheme('light');
  }

  // Apply inner bg
  d.innerColor.value = preset.innerBg;
  d.innerAlpha.value = String(preset.innerAlpha);
  updateAlphaPreview(preset.innerBg);
  const r = parseInt(preset.innerBg.slice(1, 3), 16);
  const g = parseInt(preset.innerBg.slice(3, 5), 16);
  const b = parseInt(preset.innerBg.slice(5, 7), 16);
  const a = (preset.innerAlpha / 100).toFixed(2);
  const rgba = `rgba(${r},${g},${b},${a})`;
  updateInnerLabel(preset.innerBg, preset.innerAlpha);
  if (Q().applyCustomInnerBg) Q().applyCustomInnerBg(rgba);

  // Apply outer bg
  d.outerColor.value = preset.outerBg;
  d.outerLabel.textContent = preset.outerBg;
  if (Q().applyCustomOuterBg) Q().applyCustomOuterBg(preset.outerBg);
}

// ── Save as preset ──
function saveAsPreset() {
  const d = getDom();
  if (!d || !d.innerColor || !d.innerAlpha || !d.outerColor) return;
  const innerHex = d.innerColor.value;
  const alpha = parseInt(d.innerAlpha.value, 10);
  const outerHex = d.outerColor.value;
  const name = prompt('预设名称：', '我的主题');
  if (!name) return;

  const r = parseInt(innerHex.slice(1, 3), 16);
  const g = parseInt(innerHex.slice(3, 5), 16);
  const b = parseInt(innerHex.slice(5, 7), 16);
  const a = (alpha / 100).toFixed(2);
  const innerRgba = `rgba(${r},${g},${b},${a})`;

  const q = Q();
  const custom = q.getCustomTheme ? q.getCustomTheme() : {};
  custom.innerBg = innerRgba;
  custom.outerBg = outerHex;
  custom.savedName = name;
  if (q.saveCustomTheme) q.saveCustomTheme(custom);
  if (Q().showToast) Q().showToast(`预设 "${name}" 已保存`, 'success');
}

// ── Reset all ──
function resetAll() {
  const d = getDom();
  if (!d) return;
  const q = Q();
  if (q.resetCustomTheme) q.resetCustomTheme();
  // Update UI for current theme
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  d.presets.forEach(btn => btn.classList.toggle('active', btn.dataset.theme === theme));
  syncUIFromStorage();
  if (Q().showToast) Q().showToast('已恢复默认主题', 'info');
}

// ── Click outside to close ──
function onDocumentClick(e) {
  const d = getDom();
  if (!d || !d.panel) return;
  if (!d.panel.classList.contains('visible')) return;
  const target = e.target;
  if (d.panel.contains(target)) return;
  if (d.toggleBtn && d.toggleBtn.contains(target)) return;
  close();
}

// ── Init ──
export function init() {
  const d = getDom();
  if (!d) {
    console.warn('[ThemeCustomizer] DOM elements not found');
    return;
  }

  // ── Toggle button ──
  if (d.toggleBtn) {
    d.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
  }

  // ── Close button ──
  if (d.closeBtn) {
    d.closeBtn.addEventListener('click', close);
  }

  // ── Color picker events ──
  if (d.innerColor) {
    d.innerColor.addEventListener('input', () => {
      updateAlphaPreview(d.innerColor.value);
      applyInnerBg();
    });
  }
  if (d.innerAlpha) {
    d.innerAlpha.addEventListener('input', () => {
      updateAlphaPreview(d.innerColor.value);
      applyInnerBg();
    });
  }
  if (d.outerColor) {
    d.outerColor.addEventListener('input', applyOuterBg);
  }

  // ── Preset buttons ──
  d.presets.forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.theme));
  });

  // ── Save / Reset ──
  if (d.saveBtn) d.saveBtn.addEventListener('click', saveAsPreset);
  if (d.resetBtn) d.resetBtn.addEventListener('click', resetAll);

  // ── Click outside ──
  document.addEventListener('click', onDocumentClick);
}

// ── Auto-init ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
