/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// global-search-panel — Global Search Across All Tabs (Ctrl+Shift+A)
//
// Phase 2: Extracts global search panel from app.js.
// Searches across all tab buffers and renders grouped results.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{tabId:string, name?:string, cliId?:string, icon?:string, buffer?:string}} TabInfo */
/** @typedef {{lineNum:number, text:string}} SearchMatch */
/** @typedef {{tab:TabInfo, matches:SearchMatch[]}} SearchGroup */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

// ============================================================
// Open / Close / Toggle
// ============================================================

export function openGlobalSearch() {
  const panel = document.getElementById('global-search-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  const input = document.getElementById('global-search-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  const results = document.getElementById('global-search-results');
  if (results) results.innerHTML = '';
  const status = document.getElementById('global-search-status');
  if (status) status.classList.remove('visible');
}

export function closeGlobalSearch() {
  document.getElementById('global-search-panel')?.classList.add('hidden');
}

export function toggleGlobalSearch() {
  const panel = document.getElementById('global-search-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    openGlobalSearch();
  } else {
    closeGlobalSearch();
  }
}

// ============================================================
// Render results
// ============================================================

export function renderGlobalSearchResults(query) {
  const container = document.getElementById('global-search-results');
  if (!container) return;

  const status = /** @type {HTMLElement|null} */ (document.getElementById('global-search-status'));
  const count = document.getElementById('global-search-count');

  if (!query || query.length < 2) {
    container.innerHTML = '';
    if (count) count.textContent = '';
    if (status) status.classList.remove('visible');
    return;
  }

  const q = query.toLowerCase();
  const tabs = /** @type {TabInfo[]} */ (Q().Tabs?.tabs || []);
  let totalMatches = 0;
  /** @type {SearchGroup[]} */
  const groups = [];

  for (const tab of tabs) {
    if (!tab.buffer) continue;
    const lines = tab.buffer.split('\n');
    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        matches.push({ lineNum: i + 1, text: lines[i] });
      }
    }
    if (matches.length > 0) {
      groups.push({ tab, matches });
      totalMatches += matches.length;
    }
  }

  if (count) count.textContent = totalMatches > 0 ? `${totalMatches} \u6761` : '';

  if (groups.length === 0) {
    container.innerHTML = '<div class="gsr-empty">\u672a\u627e\u5230\u5339\u914d\u7ed3\u679c</div>';
    if (status) {
      status.textContent = `\u641c\u7d22 "${query}" \u2014 \u5171 0 \u6761`;
      status.classList.add('visible');
    }
    return;
  }

  if (status) {
    status.textContent = `\u641c\u7d22 "${query}" \u2014 \u5728 ${groups.length} \u4e2a\u7ec8\u7aef\u4e2d\u627e\u5230 ${totalMatches} \u6761`;
    status.classList.add('visible');
  }

  container.innerHTML = '';
  for (const group of groups) {
    const tab = group.tab;
    const groupDiv = document.createElement('div');
    groupDiv.className = 'gsr-tab-group';

    const header = document.createElement('div');
    header.className = 'gsr-tab-header';
    header.textContent = `${tab.icon || '\u25b8'} ${tab.name || tab.cliId || 'Terminal'}`;
    const span = document.createElement('span');
    span.textContent = ` (${group.matches.length})`;
    header.appendChild(span);
    groupDiv.appendChild(header);

    // Show max 50 matches per tab
    const maxShow = 50;
    const showMatches = group.matches.slice(0, maxShow);
    for (const m of showMatches) {
      const item = document.createElement('div');
      item.className = 'gsr-item';
      item.dataset.tabId = tab.tabId;

      const lineNum = document.createElement('span');
      lineNum.className = 'gsr-item-line';
      lineNum.textContent = m.lineNum;
      item.appendChild(lineNum);

      const text = document.createElement('span');
      text.className = 'gsr-item-text';
      const idx = m.text.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const before = m.text.slice(0, idx);
        const match = m.text.slice(idx, idx + query.length);
        const after = m.text.slice(idx + query.length);
        text.innerHTML = escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
      } else {
        text.textContent = m.text;
      }
      item.appendChild(text);

      item.addEventListener('click', () => {
        closeGlobalSearch();
        if (tab.tabId && Q().Tabs) {
          Q().Tabs.switch(tab.tabId);
        }
        const term = Q().Tabs?.term;
        if (term) term.focus();
      });

      groupDiv.appendChild(item);
    }

    if (group.matches.length > maxShow) {
      const more = document.createElement('div');
      more.className = 'gsr-empty';
      more.style.padding = '8px var(--space-2)';
      more.style.fontSize = '11px';
      more.textContent = `\u2026 \u8fd8\u6709 ${group.matches.length - maxShow} \u6761\u7ed3\u679c`;
      groupDiv.appendChild(more);
    }

    container.appendChild(groupDiv);
  }
}

// ============================================================
// Auto-init: wire up DOM events (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._globalSearchPatched) return;
  Q()._globalSearchPatched = true;

  Q().openGlobalSearch = openGlobalSearch;
  Q().closeGlobalSearch = closeGlobalSearch;
  Q().toggleGlobalSearch = toggleGlobalSearch;
  Q().renderGlobalSearchResults = renderGlobalSearchResults;

  // Keyboard: Escape to close
  document.addEventListener('keydown', (e) => {
    const panel = document.getElementById('global-search-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGlobalSearch();
      const term = Q().Tabs?.term;
      if (term) term.focus();
    }
  });

  // Real-time search on input
  document.getElementById('global-search-input')?.addEventListener('input', (e) => {
    renderGlobalSearchResults(e.target.value);
  });

  // Close button
  document.getElementById('global-search-close-btn')?.addEventListener('click', closeGlobalSearch);

  // Click background to close
  document.getElementById('global-search-bg')?.addEventListener('click', closeGlobalSearch);
});
