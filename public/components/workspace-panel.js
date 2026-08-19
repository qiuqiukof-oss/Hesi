/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// workspace-panel — Workspace Profiles Panel
//
// Phase 2: Extracts workspace CRUD + rendering from app.js.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }


// ============================================================
// Open / Close
// ============================================================

export async function openWorkspacePanel() {
  const panel = document.getElementById('workspace-overlay');
  if (!panel) return;
  panel.classList.remove('hidden');
  await renderWorkspaceList();
}

export function closeWorkspacePanel() {
  document.getElementById('workspace-overlay')?.classList.add('hidden');
}

// ============================================================
// Render
// ============================================================

export async function renderWorkspaceList() {
  const container = document.getElementById('workspace-list');
  if (!container) return;
  const store = Q().WorkspaceStore;
  if (!store) {
    container.innerHTML = '<div class="workspace-empty">Workspace store not available</div>';
    return;
  }

  const workspaces = store.getAll();
  if (workspaces.length === 0) {
    container.innerHTML = '<div class="workspace-empty">\u6682\u65e0\u4fdd\u5b58\u7684\u5de5\u4f5c\u533a\uff0c\u70b9\u51fb "\ud83d\udcbe \u4fdd\u5b58\u5f53\u524d" \u521b\u5efa</div>';
    return;
  }

  container.innerHTML = '';
  for (const ws of workspaces) {
    const el = document.createElement('div');
    el.className = 'workspace-item';

    const icon = document.createElement('span');
    icon.className = 'workspace-item-icon';
    icon.textContent = '\ud83d\udcc2';
    el.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'workspace-item-body';

    const name = document.createElement('div');
    name.className = 'workspace-item-name';
    name.textContent = ws.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'workspace-item-meta';
    const d = new Date(ws.createdAt || Date.now());
    meta.textContent = `${ws.tabCount || 0} \u4e2a tab \u00b7 \u521b\u5efa\u4e8e ${d.toLocaleDateString('zh-CN')}`;
    body.appendChild(meta);

    el.appendChild(body);

    const del = document.createElement('button');
    del.className = 'workspace-delete-btn';
    del.textContent = '\u2715';
    del.title = '\u5220\u9664';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      store.remove(ws.id);
      await renderWorkspaceList();
    });
    el.appendChild(del);

    // Click to restore workspace
    el.addEventListener('click', async () => {
      const tabs = Q().Tabs;
      if (!tabs || !ws.tabs || ws.tabs.length === 0) {
        Q.showToast('\u5de5\u4f5c\u533a\u6ca1\u6709\u53ef\u6062\u590d\u7684 tab', 'info');
        return;
      }
      for (const tab of ws.tabs) {
        if (tab.cliId) {
          if (tab.init) {
            const map = Q()._pendingInit || new Map();
            map.set(tab.cliId, tab.init);
          }
          await new Promise(r => setTimeout(r, 300));
          const launch = Q().launchCLI;
          if (launch) launch(tab.cliId);
        }
      }
      closeWorkspacePanel();
      Q.showToast(`\u2705 \u5df2\u6062\u590d\u5de5\u4f5c\u533a "${ws.name}"\uff08${ws.tabs.length} \u4e2a tab\uff09`, 'success');
    });

    container.appendChild(el);
  }
}

// ============================================================
// Auto-init: wire up DOM events (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._workspacePatched) return;
  Q()._workspacePatched = true;

  Q().openWorkspacePanel = openWorkspacePanel;
  Q().closeWorkspacePanel = closeWorkspacePanel;
  Q().renderWorkspaceList = renderWorkspaceList;

  // Close button
  document.getElementById('workspace-close-btn')?.addEventListener('click', closeWorkspacePanel);

  // Save button
  document.getElementById('workspace-save-btn')?.addEventListener('click', async () => {
    const tabs = Q().Tabs;
    if (!tabs || tabs.tabs.length === 0) {
      Q.showToast('\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684 tab\u3002\u8bf7\u5148\u542f\u52a8\u4e00\u4e9b CLI\u3002', 'info');
      return;
    }
    const name = prompt('\u5de5\u4f5c\u533a\u540d\u79f0:');
    if (!name || !name.trim()) return;
    const store = Q().WorkspaceStore;
    if (store) {
      await store.save(name.trim(), tabs.tabs);
      Q.showToast(`\ud83d\udcbe \u5df2\u4fdd\u5b58\u5de5\u4f5c\u533a "${name.trim()}"`, 'success');
      await renderWorkspaceList();
    }
  });

  // Close on background click
  const overlay = document.getElementById('workspace-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'workspace-overlay-bg') {
        closeWorkspacePanel();
      }
    });
  }
});
