/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// snippet-panel — Snippet Manager Panel
//
// Phase 2: Extracts snippet CRUD + rendering from app.js.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{id:string, name:string, command:string, description?:string}} SnippetItem */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

async function getStore() { return Q().SnippetStore || null; }

/** @param {string} msg @param {string} [type] */

// ============================================================
// Open / Close
// ============================================================

export async function openSnippetPanel() {
  const panel = document.getElementById('snippet-overlay');
  if (!panel) return;
  panel.classList.remove('hidden');
  await renderSnippetList();
}

export function closeSnippetPanel() {
  document.getElementById('snippet-overlay')?.classList.add('hidden');
  document.getElementById('add-snippet-modal')?.classList.add('hidden');
}

// ============================================================
// Render
// ============================================================

export async function renderSnippetList() {
  const container = document.getElementById('snippet-list');
  if (!container) return;
  const store = await getStore();
  if (!store) {
    container.innerHTML = '<div class="snippet-empty">Snippet store not available</div>';
    return;
  }

  const snippets = await store.getAll();
  if (snippets.length === 0) {
    container.innerHTML = '<div class="snippet-empty">\u6682\u65e0\u4ee3\u7801\u7247\u6bb5\uff0c\u70b9\u51fb "+ \u65b0\u589e" \u521b\u5efa</div>';
    return;
  }

  container.innerHTML = '';
  for (const s of snippets) {
    const el = document.createElement('div');
    el.className = 'snippet-item';

    const icon = document.createElement('span');
    icon.className = 'snippet-item-icon';
    icon.textContent = '\ud83d\udccb';
    el.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'snippet-item-body';

    const name = document.createElement('div');
    name.className = 'snippet-item-name';
    name.textContent = s.name;
    body.appendChild(name);

    const cmd = document.createElement('div');
    cmd.className = 'snippet-item-cmd';
    cmd.textContent = s.command + (s.description ? `  // ${s.description}` : '');
    body.appendChild(cmd);

    el.appendChild(body);

    const del = document.createElement('button');
    del.className = 'snippet-delete-btn';
    del.textContent = '\u2715';
    del.title = '\u5220\u9664';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await store.remove(s.id);
      await renderSnippetList();
    });
    el.appendChild(del);

    // Click to send command to terminal
    el.addEventListener('click', () => {
      const s2 = Q().state || {};
      if (s2.launched || Q().Tabs?.activeTabId) {
        const tabId = Q().Tabs?.activeTabId;
        let cmdText = s.command;
        const placeholders = cmdText.match(/\{\{\w+\}\}/g);
        if (placeholders) {
          for (const ph of placeholders) {
            const key = ph.replace(/[{}]/g, '');
            const val = prompt(`\u8f93\u5165 ${key}:`) || '';
            cmdText = cmdText.replace(ph, val);
          }
        }
        const ws = Q().wsSend;
        if (ws) ws({ type: 'input', data: cmdText + '\n', tabId });
        closeSnippetPanel();
        const term = Q().Tabs?.term;
        if (term) term.focus();
      } else {
        Q.showToast('\u8bf7\u5148\u542f\u52a8\u4e00\u4e2a CLI', 'info');
      }
    });

    container.appendChild(el);
  }
}

// ============================================================
// Auto-init: wire up DOM events (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._snippetPatched) return;
  Q()._snippetPatched = true;

  Q().openSnippetPanel = openSnippetPanel;
  Q().closeSnippetPanel = closeSnippetPanel;
  Q().renderSnippetList = renderSnippetList;

  // Close button
  document.getElementById('snippet-close-btn')?.addEventListener('click', closeSnippetPanel);

  // Add button → show add modal
  document.getElementById('snippet-add-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('add-snippet-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.getElementById('snippet-name')?.focus();
    }
  });

  // Close on background click
  const overlay = document.getElementById('snippet-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'snippet-overlay-bg') {
        closeSnippetPanel();
      }
    });
  }

  // Add snippet form
  const snippetForm = document.getElementById('add-snippet-form');
  if (snippetForm) {
    snippetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById('snippet-name');
      const commandEl = document.getElementById('snippet-command');
      const descEl = document.getElementById('snippet-desc');
      const errorEl = document.getElementById('add-snippet-error');
      const name = nameEl?.value?.trim();
      const command = commandEl?.value?.trim();
      if (!name || !command) {
        if (errorEl) { errorEl.textContent = '\u540d\u79f0\u548c\u547d\u4ee4\u4e0d\u80fd\u4e3a\u7a7a'; errorEl.classList.remove('hidden'); }
        return;
      }
      const store = await getStore();
      if (store) {
        await store.add(name, command, descEl?.value?.trim());
        document.getElementById('add-snippet-modal')?.classList.add('hidden');
        if (errorEl) errorEl.classList.add('hidden');
        snippetForm.reset();
        Q.showToast(`\ud83d\udccb \u5df2\u6dfb\u52a0\u7247\u6bb5 "${name}"`, 'success');
        await renderSnippetList();
        // Refresh command palette cache
        if (Q().openPalette) {
          // Trigger palette snippet cache refresh if palette module loaded
          const evt = new CustomEvent('snippet-changed');
          document.dispatchEvent(evt);
        }
      }
    });

    document.getElementById('add-snippet-cancel')?.addEventListener('click', () => {
      document.getElementById('add-snippet-modal')?.classList.add('hidden');
      const errorEl = document.getElementById('add-snippet-error');
      if (errorEl) errorEl.classList.add('hidden');
    });
  }

  // Escape key → close add snippet modal
  document.addEventListener('keydown', (e) => {
    const addModal = document.getElementById('add-snippet-modal');
    if (addModal && !addModal.classList.contains('hidden') && e.key === 'Escape') {
      addModal.classList.add('hidden');
      const errorEl = document.getElementById('add-snippet-error');
      if (errorEl) errorEl.classList.add('hidden');
    }
  });
});
