/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <dom-diff-panel> — DOM 差异对比面板
//
// 捕获/加载 DOM 快照，对比前后差异，高亮显示变更。
// 通过 UIRegistry 注册。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

function Q() { return window.QCLI || {}; }

let _snapshotA = null;
let _snapshotB = null;
let _snapshotALabel = '快照 A';
let _snapshotBLabel = '快照 B';
let _diffs = [];
let _activeTab = 'diff'; // 'diff' | 'snapshotA' | 'snapshotB'

/** @type {{ panel:HTMLElement, list:HTMLElement|null, statusBar:HTMLElement|null }} */
let dom = null;

async function captureSnapshot() {
  try {
    const resp = await fetch('/api/browser/dom-snapshot', { method: 'POST' });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

async function computeDiff(a, b) {
  try {
    const resp = await fetch('/api/browser/dom-diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotA: a, snapshotB: b }),
    });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

function renderDiff() {
  if (!dom || !dom.list) return;

  if (!_snapshotA || !_snapshotB) {
    dom.list.innerHTML = '<div class="dd-empty"><div class="dd-empty-icon">📋</div><p>捕获两个 DOM 快照后自动对比</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">点击「捕获快照 A」和「捕获快照 B」</p></div>';
    return;
  }

  if (_diffs.length === 0) {
    dom.list.innerHTML = '<div class="dd-empty"><div class="dd-empty-icon">✅</div><p>两快照之间没有差异</p></div>';
    return;
  }

  dom.list.innerHTML = _diffs.map(d => {
    const typeLabel = { added: '新增', removed: '移除', modified: '修改' }[d.type] || d.type;
    const typeClass = d.type;
    return `<div class="dd-item ${typeClass}">
      <div class="dd-item-type ${typeClass}">${typeLabel}</div>
      <div class="dd-item-path">${escapeHtml(d.path)}</div>
      <div class="dd-item-detail">${escapeHtml(d.details)}</div>
    </div>`;
  }).join('');
}

function renderSnapshotView(snapshot, label) {
  if (!dom || !dom.list) return;
  if (!snapshot) {
    dom.list.innerHTML = `<div class="dd-empty"><div class="dd-empty-icon">📋</div><p>尚未捕获 ${label}</p></div>`;
    return;
  }
  dom.list.innerHTML = `<pre class="dd-snapshot-view">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`;
}

function renderActiveView() {
  if (_activeTab === 'snapshotA') renderSnapshotView(_snapshotA, _snapshotALabel);
  else if (_activeTab === 'snapshotB') renderSnapshotView(_snapshotB, _snapshotBLabel);
  else renderDiff();
}

function updateUI() {
  const elA = document.getElementById('dd-status-a');
  const elB = document.getElementById('dd-status-b');
  const diffCount = document.getElementById('dd-diff-count');
  if (elA) elA.textContent = _snapshotA ? `✅ 已捕获 (${_snapshotA.nodeCount || 0} 节点)` : '— 未捕获';
  if (elB) elB.textContent = _snapshotB ? `✅ 已捕获 (${_snapshotB.nodeCount || 0} 节点)` : '— 未捕获';
  if (diffCount) diffCount.textContent = `${_diffs.length} 处差异`;
  renderActiveView();
}

function init(container) {
  container.innerHTML = `
    <div class="dd-panel">
      <div class="dd-toolbar">
        <button class="dd-btn" id="dd-capture-a">📸 快照 A</button>
        <button class="dd-btn" id="dd-capture-b">📸 快照 B</button>
        <button class="dd-btn" id="dd-compare">🔍 对比</button>
        <button class="dd-btn" id="dd-clear">🗑 清除</button>
      </div>
      <div class="dd-status-bar" id="dd-status-bar">
        <span class="dd-stat">快照 A: <span id="dd-status-a">— 未捕获</span></span>
        <span class="dd-stat">快照 B: <span id="dd-status-b">— 未捕获</span></span>
        <span class="dd-stat">差异: <span id="dd-diff-count">0</span></span>
      </div>
      <div class="dd-view-tabs">
        <button class="dd-view-tab active" data-view="diff">差异视图</button>
        <button class="dd-view-tab" data-view="snapshotA">快照 A</button>
        <button class="dd-view-tab" data-view="snapshotB">快照 B</button>
      </div>
      <div class="dd-list" id="dd-list">
        <div class="dd-empty"><div class="dd-empty-icon">📋</div><p>捕获两个 DOM 快照后自动对比</p></div>
      </div>
    </div>
  `;

  dom = { panel: container, list: container.querySelector('#dd-list') };

  container.querySelector('#dd-capture-a').addEventListener('click', async () => {
    const result = await captureSnapshot();
    if (result.success) {
      _snapshotA = result.snapshot;
      _snapshotALabel = `快照 A (${new Date().toLocaleTimeString()})`;
      const toast = Q().showToast;
      if (toast) toast(`DOM 快照 A 已捕获 (${result.nodeCount} 节点)`, 'success');
    }
    if (_snapshotA && _snapshotB) await runDiff();
    updateUI();
  });

  container.querySelector('#dd-capture-b').addEventListener('click', async () => {
    const result = await captureSnapshot();
    if (result.success) {
      _snapshotB = result.snapshot;
      _snapshotBLabel = `快照 B (${new Date().toLocaleTimeString()})`;
      const toast = Q().showToast;
      if (toast) toast(`DOM 快照 B 已捕获 (${result.nodeCount} 节点)`, 'success');
    }
    if (_snapshotA && _snapshotB) await runDiff();
    updateUI();
  });

  async function runDiff() {
    const result = await computeDiff(_snapshotA, _snapshotB);
    if (result.success) {
      _diffs = result.diffs || [];
    }
  }

  container.querySelector('#dd-compare').addEventListener('click', async () => {
    if (!_snapshotA || !_snapshotB) {
      const toast = Q().showToast;
      if (toast) toast('请先捕获快照 A 和快照 B', 'info');
      return;
    }
    await runDiff();
    updateUI();
  });

  container.querySelector('#dd-clear').addEventListener('click', () => {
    _snapshotA = null;
    _snapshotB = null;
    _diffs = [];
    updateUI();
    const toast = Q().showToast;
    if (toast) toast('已清除所有快照', 'info');
  });

  // View tabs
  container.querySelectorAll('.dd-view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.dd-view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _activeTab = tab.dataset.view;
      renderActiveView();
    });
  });

  updateUI();
}

// ── UIRegistry Registration ──
(function register() {
  const Qq = window.QCLI || {};
  const UIR = Qq.UIRegistry;
  if (!UIR) { setTimeout(register, 500); return; }

  UIR.registerTab('dom-diff', {
    icon: '📋',
    label: 'DOM 差异',
    category: 'other',
    order: 22,
    render: (container) => init(container),
  });

  UIR.registerCommand('dom-diff:open', {
    icon: '📋',
    name: '打开 DOM 差异对比',
    desc: '捕获和对比 DOM 快照差异',
    category: 'browser',
    execute: () => {
      const rp = Qq.RightPanel;
      if (rp) { if (rp.collapsed) rp.open(); rp.switchTab('dom-diff'); }
    },
  });

  console.log('[DOMDiff] Panel registered');
})();
