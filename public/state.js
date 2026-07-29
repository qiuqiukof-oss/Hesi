/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi State Module — extracted from app.js
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

import { escapeHtml } from './escape.js';

// ── Reactive store layer (Phase 1: state management decoupling) ──
import { cliStore } from './stores/cliStore.js';
import { uiStore } from './stores/uiStore.js';
import { terminalStore } from './stores/terminalStore.js';
import { chatStore } from './stores/chatStore.js';
import { paletteStore } from './stores/paletteStore.js';

Q.cliStore = cliStore;
Q.uiStore = uiStore;
Q.terminalStore = terminalStore;
Q.chatStore = chatStore;
Q.paletteStore = paletteStore;

/**
 * syncToStores — Push current Q.state into all reactive stores.
 * Called once after CLI data arrives from the backend, and anytime
 * a legacy code path mutates Q.state directly and wants stores to follow.
 *
 * Safe to call repeatedly — only notifies subscribers when values change.
 */
Q.syncToStores = function syncToStores() {
  const s = Q.state;
  if (!s) return;
  cliStore.setState({
    clis: s.clis || [],
    folders: s.folders || [],
    activeCliId: s.activeCliId || null,
    searchQuery: s.searchQuery || '',
    renamingFolderId: s.renamingFolderId || null,
    categoryFilter: s.categoryFilter || 'all',
    launched: !!s.launched,
    launching: !!s.launching,
  });
  terminalStore.setState({
    connected: !!s.connected,
    launched: !!s.launched,
    launching: !!s.launching,
    reconnectAttempts: s.reconnectAttempts || 0,
    maxReconnectAttempts: s.maxReconnectAttempts || 10,
  });
  uiStore.setState({
    theme: s.theme || 'dark',
    sidebarCollapsed: !!(dom?.sidebar?.classList?.contains('collapsed')),
  });
};

// ============================================================
export const state = {
  clis: [],
  folders: [],
  activeCliId: null,
  connected: false,
  launched: false,
  launching: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  searchQuery: '',
  renamingFolderId: null,
  categoryFilter: 'all',
  theme: 'dark',
};

// ============================================================
// Scrollback History Buffer
// ============================================================
export const SCROLLBACK_MAX_LINES = 10000;
export const scrollbackBuffer = [];
export let scrollbackLineCount = 0;

export const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
export const CR_RE = /\r\n|\r(?!\n)/g;

export function stripAnsi(str) {
  return str.replace(ANSI_RE, '').replace(CR_RE, '\n');
}

export function captureToScrollback(rawData) {
  const text = stripAnsi(rawData);
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line && scrollbackBuffer.length === 0) continue;
    scrollbackBuffer.push(line);
    if (scrollbackBuffer.length > SCROLLBACK_MAX_LINES) {
      scrollbackBuffer.shift();
    }
    scrollbackLineCount++;
  }
}

export const historyViewer = { open: false, overlay: null, content: null };

export function initHistoryViewer() {
  const overlay = document.createElement('div');
  overlay.id = 'history-viewer';
  overlay.className = 'history-viewer hidden';
  overlay.innerHTML = '<div class="history-viewer-header"><span class="history-viewer-title">\ud83d\udcdc Scrollback History</span><span class="history-viewer-hint">\u2191\u2193 scroll &middot; Esc close</span></div><div class="history-viewer-content"></div>';
  document.body.appendChild(overlay);
  historyViewer.overlay = overlay;
  historyViewer.content = overlay.querySelector('.history-viewer-content');
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeHistoryViewer(); });
  return overlay;
}

export function openHistoryViewer() {
  if (!historyViewer.overlay) initHistoryViewer();
  if (historyViewer.open) return;
  historyViewer.open = true;
  historyViewer.overlay.classList.remove('hidden');
  const content = historyViewer.content;
  if (scrollbackBuffer.length === 0) {
    content.innerHTML = '<div class="history-viewer-empty">No output captured yet.</div>';
  } else {
    const parts = [];
    for (let i = 0; i < scrollbackBuffer.length; i++) {
      const line = scrollbackBuffer[i] || ' ';
      parts.push('<div class="history-viewer-line">' + escapeHtml(line) + '</div>');
    }
    content.innerHTML = parts.join('');
  }
  requestAnimationFrame(function () { content.scrollTop = content.scrollHeight; });
  historyViewer.overlay.tabIndex = -1;
  historyViewer.overlay.focus();
}

export function closeHistoryViewer() {
  if (!historyViewer.open) return;
  historyViewer.open = false;
  historyViewer.overlay.classList.add('hidden');
  if (Q?.Tabs?.term) {
    try { Q.Tabs.term.focus(); } catch (e) {
      console.debug('[State] Term focus error (non-critical):', e?.message);
    }
  }
}

export function toggleHistoryViewer() {
  if (historyViewer.open) closeHistoryViewer();
  else openHistoryViewer();
}

// ── DOM References ──
export const $ = (sel) => document.querySelector(sel);
export const dom = {
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  cliList: $('#cli-list'),
  searchInput: $('#search-input'),
  addFolderBtn: $('#add-folder-btn'),
  statusDot: $('#connection-status .status-dot'),
  statusText: $('#connection-status .status-text'),
  statusIndicator: $('#connection-status'),
  activeLabel: $('#active-cli-label'),
  activeVersion: $('#active-cli-version'),
  terminalDims: $('#terminal-dims'),
  terminalFontSize: $('#terminal-font-size'),
  terminal: $('#terminal'),
  welcomeOverlay: $('#welcome-overlay'),
  addOverlay: $('#add-cli-overlay'),
  addForm: $('#add-cli-form'),
  addName: $('#add-cli-name'),
  addPath: $('#add-cli-path'),
  addArgs: $('#add-cli-args'),
  addInit: $('#add-cli-init'),
  addError: $('#add-cli-error'),
  addCancel: $('#add-cli-cancel'),
  addSubmit: $('#add-cli-submit'),
  browseBtn: $('#browse-cli-btn'),
  fileInput: $('#file-input'),
  selectedFile: $('#selected-file'),
  manualPathGroup: $('#manual-path-group'),
  addBtn: $('#add-cli-btn'),
  discoverBtn: $('#discover-btn'),
  dropOverlay: $('#drop-overlay'),
  connectionLost: $('#connection-lost'),
  categoryFilters: $('#category-filters'),
  themeToggle: $('#theme-toggle-btn'),
};
Q.dom = dom;
Q.$ = $;

// ── Category Filter ──
export function getCategoryIcon(category) {
  const icons = { agent: '🤖', directory: '📂', tool: '🔧' };
  return icons[category] || '📦';
}

export function getCategoryLabel(category) {
  const labels = { agent: 'Agent', directory: 'Env', tool: 'Tool' };
  return labels[category] || category;
}

export function setupCategoryFilters() {
  if (!dom.categoryFilters) return;
  const chips = dom.categoryFilters.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const category = chip.dataset.category;
      if (category === cliStore.getState().categoryFilter) return;
      cliStore.setState({ categoryFilter: category });
      state.categoryFilter = category;  // 同步本地 state（filterCLIs 读此值）
      chips.forEach(c => c.classList.toggle('active', c.dataset.category === category));
      if (typeof Q.renderCLIList === 'function') {
        Q.renderCLIList();
      }
    });
  });
  // 初始化：按已恢复/默认的 categoryFilter 同步高亮 chip，避免记忆恢复非 'all' 分类后三者不一致
  chips.forEach(c => c.classList.toggle('active', c.dataset.category === (state.categoryFilter || 'all')));
}

// ── QCLI namespace bindings ──
Q.getCategoryIcon = getCategoryIcon;
Q.getCategoryLabel = getCategoryLabel;
Q.setupCategoryFilters = setupCategoryFilters;
Q.state = state;
Q.dom = dom;
Q.scrollbackBuffer = scrollbackBuffer;
Q.scrollbackLineCount = scrollbackLineCount;
Q.historyViewer = historyViewer;
Q.initHistoryViewer = initHistoryViewer;
Q.openHistoryViewer = openHistoryViewer;
Q.closeHistoryViewer = closeHistoryViewer;
Q.toggleHistoryViewer = toggleHistoryViewer;
Q.stripAnsi = stripAnsi;
Q.captureToScrollback = captureToScrollback;
Q.$ = $;
