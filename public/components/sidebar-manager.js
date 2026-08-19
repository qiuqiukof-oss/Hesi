/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// sidebar-manager — Sidebar toggle + draggable resize
//
// Phase 2: Extracts sidebar toggle, resize handle, and
// associated event handlers from app.js.
// Auto-patches QCLI namespace + wires events at import time.
// ============================================================
// @ts-check
'use strict';

import { safeStorage } from '../lib/storage.js';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }
/** @returns {{[key:string]: any}} */
function dom() { return Q().dom || {}; }
/** @returns {{[key:string]: any}} */
function state() { return Q().state || {}; }

function __(key) {
  const fn = Q().__;
  return fn ? fn(key) : key;
}

function wsSend(data) {
  const fn = Q().wsSend;
  if (fn) fn(data);
}

function refitTerminal() {
  const fa = Q().Tabs?.fitAddon;
  if (!fa) return;
  try { fa.fit(); } catch (e) { /* fitAddon may fail if terminal not visible yet — non-critical, retried on next frame */ }
  const s = state();
  if (s.launched) {
    const dims = fa.proposeDimensions();
    if (dims) {
      wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: Q().Tabs?.activeTabId });
    }
  }
}

// ============================================================
// Toggle
// ============================================================

export function toggleSidebar(forceState) {
  const d = dom();
  if (!d.sidebar) return;
  const isCollapsed = forceState !== undefined
    ? forceState
    : !d.sidebar.classList.contains('collapsed');

  d.sidebar.classList.toggle('collapsed', isCollapsed);
  if (d.sidebarToggle) {
    d.sidebarToggle.textContent = isCollapsed ? '\u25b6' : '\u25c0';
    d.sidebarToggle.title = isCollapsed
      ? __('sidebar.toggle.expand')
      : __('sidebar.toggle.collapse');
  }

  safeStorage.set('qcli-sidebar-collapsed', isCollapsed ? '1' : '0');

  // Re-fit terminal after CSS transition
  setTimeout(refitTerminal, 280);
}

// ============================================================
// Width persistence
// ============================================================

export function getSidebarWidth() {
  const saved = safeStorage.get('qcli-sidebar-width');
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= 160 && w <= 480) return w;
  }
  return 240;
}

export function applySidebarWidth(width) {
  document.documentElement.style.setProperty('--sidebar-width', width + 'px');
  const d = dom();
  if (d.sidebar) { d.sidebar.style.width = ''; d.sidebar.style.minWidth = ''; }
  safeStorage.set('qcli-sidebar-width', String(width));
}

// ============================================================
// Auto-init (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._sidebarPatched) return;
  Q()._sidebarPatched = true;

  Q().toggleSidebar = toggleSidebar;
  Q().getSidebarWidth = getSidebarWidth;
  Q().applySidebarWidth = applySidebarWidth;

  const d = dom();

  // ── Sidebar toggle button ──
  if (d.sidebarToggle) {
    d.sidebarToggle.addEventListener('click', () => toggleSidebar());
  }

  // ── Restore saved collapsed state ──
  if (safeStorage.get('qcli-sidebar-collapsed') === '1') {
    toggleSidebar(true);
  }

  // ── Mobile overlay ──
  const mobileOverlay = document.getElementById('sidebar-mobile-overlay');
  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', () => toggleSidebar(true));
  }

  // ── Ctrl+B toggle ──
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.repeat) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleSidebar();
    }
  });

  // ── Resize handle ──
  const resizeHandle = document.getElementById('sidebar-resize-handle');
  let isResizing = false;
  let currentResizeWidth = getSidebarWidth();
  let resizeRAF = null;

  // Restore saved width
  applySidebarWidth(currentResizeWidth);

  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      if (d.sidebar) d.sidebar.classList.add('dragging');
      resizeHandle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // Add mousemove/mouseup listeners only during resize
      function onMouseMove(e) {
        if (!isResizing) return;
        if (resizeRAF) return;
        resizeRAF = requestAnimationFrame(() => {
          resizeRAF = null;
          let width = e.clientX;
          if (width < 160) width = 160;
          if (width > 480) width = 480;
          currentResizeWidth = width;
          document.documentElement.style.setProperty('--sidebar-width', width + 'px');
        });
      }

      function onMouseUp() {
        if (!isResizing) return;
        isResizing = false;
        if (resizeRAF) {
          cancelAnimationFrame(resizeRAF);
          resizeRAF = null;
        }
        if (d.sidebar) d.sidebar.classList.remove('dragging');
        resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        applySidebarWidth(currentResizeWidth);

        // Re-fit terminal after resize
        requestAnimationFrame(refitTerminal);

        // Remove the temporary listeners
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
});
