/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// history-panel — Global Command History Panel (Ctrl+Shift+H)
//
// Phase 2: Extracts openHistoryPanel, closeHistoryPanel,
// renderHistoryList from app.js.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }
/** @returns {{[key:string]: any}} */
function state() { return Q().state || {}; }

// ============================================================
// Open / Close
// ============================================================

export async function openHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  await renderHistoryList('');
  const searchInput = document.getElementById('history-search-input');
  if (searchInput) {
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 100);
  }
}

export function closeHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (panel) panel.classList.add('hidden');
}

// ============================================================
// Render
// ============================================================

async function getStore() { return Q().HistoryStore || null; }

export async function renderHistoryList(query) {
  const container = document.getElementById('history-list');
  if (!container) return;
  const store = await getStore();
  if (!store) {
    container.innerHTML = '<div class="history-empty">History store not available</div>';
    return;
  }

  const results = await store.search(query || '');
  const count = document.getElementById('history-count');
  if (count) {
    count.textContent = results.length > 0 ? `${results.length} \u6761` : '';
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="history-empty">\u6682\u65e0\u547d\u4ee4\u5386\u53f2</div>';
    return;
  }

  container.innerHTML = '';
  for (const item of results) {
    const el = document.createElement('div');
    el.className = 'history-item';

    // Icon
    const icon = document.createElement('span');
    icon.className = 'history-item-icon';
    icon.textContent = item.favorite ? '\u2b50' : '\u2318';
    el.appendChild(icon);

    // Command text
    const cmd = document.createElement('span');
    cmd.className = 'history-item-command';
    cmd.textContent = item.command;
    el.appendChild(cmd);

    // Tab name
    if (item.tabName) {
      const tab = document.createElement('span');
      tab.className = 'history-item-tab';
      tab.textContent = item.tabName;
      el.appendChild(tab);
    }

    // Timestamp
    const time = document.createElement('span');
    time.className = 'history-item-time';
    const d = new Date(item.timestamp || Date.now());
    const isToday = new Date().toDateString() === d.toDateString();
    time.textContent = isToday
      ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    el.appendChild(time);

    // Favorite toggle
    const favBtn = document.createElement('button');
    favBtn.className = 'history-fav-btn' + (item.favorite ? ' favorited' : '');
    favBtn.textContent = '\u2606';
    favBtn.title = item.favorite ? '\u53d6\u6d88\u6536\u85cf' : '\u6536\u85cf';
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await store.toggleFavorite(item.id);
      await renderHistoryList(query || '');
    });
    el.appendChild(favBtn);

    // Click to send command to terminal
    el.addEventListener('click', () => {
      const s = state();
      if (s.launched || Q().Tabs?.activeTabId) {
        const tabId = Q().Tabs?.activeTabId;
        const ws = Q().wsSend;
        if (ws) ws({ type: 'input', data: item.command + '\n', tabId });
        closeHistoryPanel();
        const term = Q().Tabs?.term;
        if (term) term.focus();
      }
    });

    container.appendChild(el);
  }
}

// ============================================================
// Auto-init: wire up DOM events (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._historyPatched) return;
  Q()._historyPatched = true;

  Q().openHistoryPanel = openHistoryPanel;
  Q().closeHistoryPanel = closeHistoryPanel;
  Q().renderHistoryList = renderHistoryList;

  // Search input → live filter
  const searchInput = document.getElementById('history-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderHistoryList(searchInput.value);
    });
  }

  // Close button
  document.getElementById('history-close-btn')?.addEventListener('click', closeHistoryPanel);

  // Clear button
  document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
    const store = await getStore();
    if (store) {
      if (confirm('\u786e\u5b9a\u6e05\u9664\u6240\u6709\u547d\u4ee4\u5386\u53f2\uff1f')) {
        await store.clear();
        await renderHistoryList('');
      }
    }
  });

  // Close on background click
  const panel = document.getElementById('history-panel');
  if (panel) {
    panel.addEventListener('click', (e) => {
      if (e.target === panel || e.target.id === 'history-panel-bg') {
        closeHistoryPanel();
      }
    });
  }
});
