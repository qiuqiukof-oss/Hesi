/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Terminal Management — 终端初始化、字体缩放、尺寸自适应
//
// 原 app.js §3 (Lines 81-224) + §19 (restoreFontSize)
// ============================================================

/** @typedef {import('../types').QCLI} QCLI */

import { dom, state } from '../state.js';
import { termRef, fitAddonRef, webglAddonRef } from './shared.js';
import { safeStorage } from '../lib/storage.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});
const wsSend = (...args) => Q.wsSend(...args);

// ── Font constants ──
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_STEP = 1;

// ── Bridge: called by tabs.js to keep module-level references ──
Q.setActiveTerminal = function(t, f, w) {
  termRef.current = t;
  fitAddonRef.current = f;
  webglAddonRef.current = w;
};

function getBestFontFamily() {
  return "'Cascadia Code','Cascadia Mono','Consolas','Courier New',monospace";
}

function updateTerminalDims() {
  if (!dom.terminalDims) return;
  if (termRef.current && state.launched) {
    dom.terminalDims.textContent = `${termRef.current.cols}x${termRef.current.rows}`;
    dom.terminalDims.classList.remove('hidden');
  } else {
    dom.terminalDims.classList.add('hidden');
  }
}

function updateFontSizeDisplay() {
  if (!dom.terminalFontSize || !termRef.current) return;
  dom.terminalFontSize.textContent = `${termRef.current.options.fontSize}px`;
  dom.terminalFontSize.classList.remove('hidden');
}

function changeFontSize(delta) {
  if (!termRef.current) return;
  const current = termRef.current.options.fontSize;
  let newSize = delta === 0 ? 14 : current + delta * FONT_SIZE_STEP;
  newSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, newSize));
  if (newSize === current) return;
  termRef.current.options.fontSize = newSize;
  updateFontSizeDisplay();
  safeStorage.set('qcli-font-size', String(newSize));
  if (fitAddonRef.current) {
    requestAnimationFrame(() => {
      try { fitAddonRef.current.fit(); } catch (e) {
        console.warn('[Terminal] Resize fit error:', e?.message);
      }
      updateTerminalDims();
      if (state.launched) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: Q.Tabs?.activeTabId });
        }
      }
    });
  }
}

function restoreFontSize() {
  if (!termRef.current) return;
  const saved = safeStorage.get('qcli-font-size');
  if (saved) {
    const size = parseInt(saved, 10);
    if (size >= FONT_SIZE_MIN && size <= FONT_SIZE_MAX && size !== 14) {
      termRef.current.options.fontSize = size;
    }
  }
  updateFontSizeDisplay();
}

function initTerminal() {
  // Terminal creation is handled by Tabs._createTerminal() per tab
  // Standalone pages (plugin-plaza, quant, stocks, etc.) have no terminal DOM
  if (!dom.terminal) return;

  let resizeTimer = null;

  function handleResize() {
    if (!fitAddonRef.current) return;
    if (resizeTimer) return;
    resizeTimer = requestAnimationFrame(() => {
      resizeTimer = null;
      try { fitAddonRef.current.fit(); } catch (e) {
        console.warn('[Terminal] Resize fit error:', e?.message);
      }
      updateTerminalDims();
      if (state.launched) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: Q.Tabs?.activeTabId });
        }
      }
    });
  }

  const ro = new ResizeObserver(handleResize);
  ro.observe(dom.terminal);
  const container = dom.terminal.parentElement;
  if (container) ro.observe(container);
  window.addEventListener('resize', handleResize);

  function forceViewportScroll() {
    const vp = dom.terminal.querySelector('.xterm-viewport');
    if (vp) {
      vp.style.setProperty('overflow-y', 'scroll', 'important');
    }
  }

  forceViewportScroll();
  requestAnimationFrame(forceViewportScroll);
  const scrollInterval = setInterval(forceViewportScroll, 1000);

  window.addEventListener('beforeunload', () => {
    clearInterval(scrollInterval);
  });

  // Middle-click: copy to terminal
  dom.terminal.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      const t = Q.term || Q.Tabs?.term;
      if (!t) return;
      const selection = t.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).then(() => {
          t.clearSelection();
        }).catch(err => {
          console.warn('[Clipboard] Middle-click copy failed:', err.message);
        });
      }
    }
  });

  // Right-click: context menu
  dom.terminal.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.xterm-screen') || !state.launched) return;
    e.preventDefault();
    const t = Q.term || Q.Tabs?.term;
    const selection = t?.getSelection ? t.getSelection() : '';
    if (Q.showContextMenu) Q.showContextMenu(e.clientX, e.clientY, selection);
  });
}

// ── Focus terminal on click (safe — guarded in case dom.terminal is null) ──
if (dom.terminal) {
  dom.terminal.addEventListener('click', () => {
    if (termRef.current) termRef.current.focus();
  });
}

// ── Export on Q namespace ──
Q.changeFontSize = changeFontSize;
Q.updateFontSizeDisplay = updateFontSizeDisplay;
Q.restoreFontSize = restoreFontSize;
Q.updateTerminalDims = updateTerminalDims;
// Q.term and Q.fitAddon are set by tabs.js _updateActiveGlobals with real Terminal instances.
// Do NOT set them to wrapper objects here (causes TypeErrors in theme-switcher etc.)
Q._termRef = termRef;
Q._fitAddonRef = fitAddonRef;

export { initTerminal, restoreFontSize, changeFontSize, updateFontSizeDisplay, updateTerminalDims };
