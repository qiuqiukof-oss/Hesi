/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// context-menu — Terminal right-click menu + output pins list
//
// Phase 2: Extracts showContextMenu, hideContextMenu,
// copySelection, pinSelectedOutput, searchSelection,
// pasteClipboard, renderPinnedList from app.js.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{id:string,text:string,pin?:any}} PinItem */
/** @typedef {{label:string,action:(selection:string,term:any)=>void}} PluginMenuItem */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

// ── Helpers ──

function termAccessor() {
  const tabs = Q().Tabs;
  return tabs ? tabs.term : null;
}

function wsSend(data) {
  const fn = Q().wsSend;
  if (fn) fn(data);
}

/** @param {string} msg @param {string} [type] */

// ── State ──
/** @type {string} */
let currentPinText = '';

// ============================================================
// Show / hide
// ============================================================

/**
 * Show context menu at position
 * @param {number} x
 * @param {number} y
 * @param {string} [selection]
 */
export function showContextMenu(x, y, selection) {
  const menu = document.getElementById('terminal-context-menu');
  if (!menu) return;
  currentPinText = selection || '';

  const hasSel = !!selection;
  menu.querySelectorAll('.ctx-copy, .ctx-pin, .ctx-search-sel, .ctx-divider-sel')
    .forEach(function(el) { el.classList.toggle('hidden', !hasSel); });
  menu.querySelectorAll('.ctx-paste, .ctx-clear, .ctx-search')
    .forEach(function(el) { el.classList.toggle('hidden', hasSel); });

  // ── Inject plugin menu items dynamically ──
  injectPluginMenuItems(menu, hasSel);

  // Clamp to viewport
  const menuW = Math.min(200, window.innerWidth - 16);
  const left = Math.min(x, window.innerWidth - menuW);
  const menuH = menu.scrollHeight || 180;
  const top = Math.min(y, window.innerHeight - menuH - 8);

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.classList.remove('hidden');
}

// ── Plugin menu injection ──
/**
 * @param {HTMLElement} menu
 * @param {boolean} hasSelection
 */
function injectPluginMenuItems(menu, hasSelection) {
  const UIR = Q().UIRegistry;
  if (!UIR) return;

  const items = UIR.getMenuItemsForContext(hasSelection);
  if (items.length === 0) return;

  // Remove previously injected items (cleanup before rebuild)
  const existing = menu.querySelectorAll('.ctx-plugin');
  existing.forEach(function(el) { el.remove(); });

  // Add divider before plugin items
  const divider = document.createElement('div');
  divider.className = 'ctx-divider ctx-plugin';
  menu.appendChild(divider);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const el = document.createElement('div');
    el.className = 'ctx-item ctx-plugin';
    el.textContent = item.label;      el.addEventListener('click', function(it) {
        return function() {
          hideContextMenu();
          const term = termAccessor();
          try { it.action(currentPinText, term); } catch (e) {
            console.warn('[ContextMenu] Plugin action error:', e);
          }
        };
      }(/** @type {PluginMenuItem} */ (item)));
    menu.appendChild(el);
  }
}

export function hideContextMenu() {
  const menu = document.getElementById('terminal-context-menu');
  if (menu) menu.classList.add('hidden');
}

// ============================================================
// Actions
// ============================================================

export function copySelection() {
  hideContextMenu();
  const term = termAccessor();
  if (!term) return;
  const selection = term.getSelection();
  if (selection) {
    navigator.clipboard.writeText(selection).catch(function(err) {
      console.warn('[Clipboard] Copy failed:', /** @type {Error} */ (err).message);
    });
    term.clearSelection();
  }
}

export async function pinSelectedOutput(selectionOverride, opts) {
  const text = (selectionOverride != null && String(selectionOverride).trim() !== '')
    ? selectionOverride
    : currentPinText;
  if (!text) return;
  const store = Q().PinStore;
  if (!store) return;
  const activeTab = Q().Tabs ? Q().Tabs.activeTabId : null;
  const tab = activeTab && Q().Tabs ? Q().Tabs.getTab(activeTab) : null;
  const skipPrompt = !!(opts && opts.skipPrompt);
  const defaultTitle = tab && tab.name ? 'Output from ' + tab.name : '';
  const title = skipPrompt ? defaultTitle : prompt('Pin title (optional):', defaultTitle);
  await store.add(
    String(text).replace(/(?:[@-Z\-_]|[[0-?]*[ -/]*[@-~])/g, '').trim(),
    tab && tab.cliId || '',
    tab && tab.name || '',
    title || ''
  );
  hideContextMenu();
  Q().showToast('📌 ' + ('已固定到输出剪贴板'), 'success');
  await renderPinnedList();
}

export function searchSelection() {
  if (!currentPinText) { hideContextMenu(); return; }
  hideContextMenu();
  const searchBar = document.getElementById('terminal-search-bar');
  const searchInput = document.getElementById('terminal-search-input');
  const searchResults = document.getElementById('terminal-search-results');
  if (searchBar) searchBar.classList.remove('hidden');
  if (searchInput) {
    searchInput.value = currentPinText;
    searchInput.focus();
  }
  // Trigger search
  const addon = Q().searchAddon;
  if (addon && searchResults) {
    addon.clearActiveSearch();
    const found = addon.findNext(currentPinText, { incremental: false });
    searchResults.textContent = found ? '🔍 1+' : '✗';
  }
}

export function pasteClipboard() {
  hideContextMenu();
  navigator.clipboard.readText().then(function(text) {
    if (text) wsSend({ type: 'input', data: text });
  }).catch(function(err) {
    console.warn('[Clipboard] Right-click paste failed:', /** @type {Error} */ (err).message);
  });
}

export async function renderPinnedList() {
  // Delegate to PinReport if available
  if (Q().PinReport && Q().PinReport.renderPinnedList) {
    return Q().PinReport.renderPinnedList();
  }
  // Fallback
  const container = document.getElementById('pinned-list');
  const section = document.getElementById('pinned-section');
  if (!container || !section) return;
  const store = Q().PinStore;
  if (!store) { section.classList.add('hidden'); return; }

  const pins = await store.getAll();
  if (pins.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '';
  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    (function(pinId, pinText) {
      const el = document.createElement('div');
      el.className = 'pin-item';

      const text = document.createElement('span');
      text.className = 'pin-item-text';
      text.textContent = pinText.slice(0, 200);
      el.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pin-item-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await store.remove(pinId);
        await renderPinnedList();
      });
      el.appendChild(removeBtn);

      el.addEventListener('click', function() {
        navigator.clipboard.writeText(/** @type {string} */ (pinText)).catch(function() {});
        Q().showToast('📋 ' + ('已复制到剪贴板'), 'success');
      });

      container.appendChild(el);
    })(pin.id, pin.text);
  }
}

// ============================================================
// Notification permission (small utility kept adjacent)
// ============================================================
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ============================================================
// Auto-init — patch onto QCLI for backward compat
// ============================================================
Promise.resolve().then(function() {
  const q = Q();
  q.showContextMenu = showContextMenu;
  q.hideContextMenu = hideContextMenu;
  q.requestNotificationPermission = requestNotificationPermission;
  q.copySelection = copySelection;
  q.pinSelectedOutput = pinSelectedOutput;
  q.searchSelection = searchSelection;
  q.pasteClipboard = pasteClipboard;
  q.renderPinnedList = renderPinnedList;
});
