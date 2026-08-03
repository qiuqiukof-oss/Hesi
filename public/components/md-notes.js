/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// md-notes — Obsidian-style Markdown note drawer (P0a of 可视化方案)
//   Registered as a RIGHT-PANEL TAB (reuses existing visible infrastructure,
//   no new black box). Browses whitelisted .md roots, renders with the
//   zero-dependency MdRender. Shortcut: Ctrl/Cmd+Shift+N opens the tab.
// ============================================================
'use strict';

import { renderMarkdown, escapeHtml } from '../lib/md-render.js';

/** @typedef {import('../types').QCLI} QCLI */
function Q() {
  return /** @type {QCLI} */ (window.QCLI || {});
}

const state = { roots: [], dir: '' };

async function apiGet(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = '请求失败 (' + r.status + ')';
    try {
      const d = await r.json();
      if (d && d.error) msg = d.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return r.json();
}

async function ensureRoots() {
  if (state.roots.length) return state.roots;
  const data = await apiGet('/api/fs/md-roots');
  state.roots = data.roots || [];
  return state.roots;
}

function el(id) {
  return document.getElementById(id);
}

function renderRoot(container) {
  container.innerHTML =
    '<div class="md-notes">' +
    '<div class="md-notes-roots" id="mdn-roots"></div>' +
    '<div class="md-notes-body">' +
    '<div class="md-notes-tree">' +
    '<div class="mdn-crumbs" id="mdn-crumbs"></div>' +
    '<div class="mdn-list" id="mdn-list"><div class="mdn-hint">选择上方根目录开始浏览</div></div>' +
    '</div>' +
    '<div class="md-notes-reader" id="mdn-reader"><div class="mdn-hint">点击 .md 文件查看内容</div></div>' +
    '</div>' +
    '</div>';

  const rootsEl = el('mdn-roots');
  ensureRoots()
    .then((roots) => {
      rootsEl.innerHTML = '';
      if (!roots.length) {
        rootsEl.innerHTML = '<div class="mdn-hint">无可用根目录</div>';
        return;
      }
      roots.forEach((r) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'mdn-root-chip';
        chip.textContent = r.name;
        chip.title = r.path;
        chip.onclick = () => openDir(r.path);
        rootsEl.appendChild(chip);
      });
    })
    .catch((e) => {
      rootsEl.innerHTML = '<div class="mdn-error">' + escapeHtml(e.message) + '</div>';
    });
}

async function openDir(dir) {
  const list = el('mdn-list');
  const crumbs = el('mdn-crumbs');
  if (list) list.innerHTML = '<div class="mdn-loading">加载中…</div>';
  try {
    const data = await apiGet('/api/fs/md-list?dir=' + encodeURIComponent(dir));
    state.dir = data.dir;
    renderTree(data);
  } catch (e) {
    if (crumbs) crumbs.innerHTML = '';
    if (list) list.innerHTML = '<div class="mdn-error">' + escapeHtml(e.message) + '</div>';
  }
}

function renderTree(data) {
  const crumbs = el('mdn-crumbs');
  const list = el('mdn-list');
  if (!list || !crumbs) return;

  // breadcrumb
  crumbs.innerHTML = '';
  if (data.parent) {
    const up = document.createElement('span');
    up.className = 'mdn-crumb mdn-up';
    up.textContent = '.. 上级';
    up.title = data.parent;
    up.onclick = () => openDir(data.parent);
    crumbs.appendChild(up);
  }
  const cur = document.createElement('span');
  cur.className = 'mdn-crumb mdn-cur';
  cur.textContent = data.dir;
  cur.title = data.dir;
  crumbs.appendChild(cur);

  list.innerHTML = '';
  (data.dirs || []).forEach((d) => {
    const item = document.createElement('div');
    item.className = 'mdn-item mdn-dir';
    item.innerHTML = '<span class="mdn-ico">📁</span><span>' + escapeHtml(d.name) + '</span>';
    item.onclick = () => openDir(d.path);
    list.appendChild(item);
  });
  (data.files || []).forEach((f) => {
    const item = document.createElement('div');
    item.className = 'mdn-item mdn-file';
    item.innerHTML = '<span class="mdn-ico">📄</span><span>' + escapeHtml(f.name) + '</span>';
    item.onclick = () => openFile(f.path);
    list.appendChild(item);
  });
  if (!(data.dirs || []).length && !(data.files || []).length) {
    list.innerHTML = '<div class="mdn-hint">（空目录）</div>';
  }
}

async function openFile(p) {
  const reader = el('mdn-reader');
  if (!reader) return;
  reader.innerHTML = '<div class="mdn-loading">加载中…</div>';
  try {
    const data = await apiGet('/api/fs/md-read?path=' + encodeURIComponent(p));
    reader.innerHTML =
      '<div class="mdn-reader-head">' +
      escapeHtml(data.name) +
      '</div><div class="mdn-md">' +
      renderMarkdown(data.content) +
      '</div>';
  } catch (e) {
    reader.innerHTML = '<div class="mdn-error">' + escapeHtml(e.message) + '</div>';
  }
}

function registerTab() {
  const UIR = Q().UIRegistry;
  if (!UIR) {
    setTimeout(registerTab, 200);
    return;
  }
  UIR.registerTab('md-notes', {
    icon: '📝',
    label: '笔记',
    category: 'tool',
    render: (container) => {
      try {
        renderRoot(container);
      } catch (e) {
        container.innerHTML = '<div class="mdn-error">' + escapeHtml(e.message || String(e)) + '</div>';
      }
    },
  });

  // Shortcut: Ctrl/Cmd+Shift+N → open this tab in the right panel
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      const rp = Q().RightPanel;
      if (rp && typeof rp.switchTab === 'function') rp.switchTab('md-notes');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerTab);
} else {
  registerTab();
}
