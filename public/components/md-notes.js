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
    '<div class="md-notes-body">' +
    '<div class="md-notes-tree">' +
    '<div class="mdn-crumbs" id="mdn-crumbs"></div>' +
    '<div class="mdn-list" id="mdn-list"><div class="mdn-hint">点面包屑右侧「📍 前往」输入路径，或选择下方任一已加载目录</div></div>' +
    '</div>' +
    '<div class="md-notes-reader" id="mdn-reader"><div class="mdn-hint">点击 .md 文件查看内容</div></div>' +
    '</div>' +
    '</div>';

  // Default to the first whitelisted root so the user lands somewhere useful.
  ensureRoots()
    .then((roots) => {
      if (roots && roots[0] && !state.dir) openDir(roots[0].path);
    })
    .catch(() => {
      // roots not available — show hint in the list area
      const list = el('mdn-list');
      if (list) list.innerHTML = '<div class="mdn-error">无法加载白名单根目录</div>';
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

function splitSegments(absPath) {
  // Split an absolute path into display segments + their accumulated prefix.
  //   "H:\Hesi\.workbuddy" -> [{name:"H:\\", full:"H:\\"}, {name:"Hesi", full:"H:\\Hesi"}, {name:".workbuddy", full:"H:\\Hesi\\.workbuddy"}]
  //   "H:\Hesi"           -> [{name:"H:\\", full:"H:\\"}, {name:"Hesi", full:"H:\\Hesi"}]
  //   "C:/a/b"            -> POSIX-style fallback
  if (!absPath) return [];
  const isWin = /^[A-Za-z]:[\\/]/.test(absPath);
  if (isWin) {
    const m = absPath.match(/^([A-Za-z]:)([\\\/].*)$/);
    if (!m) return [{ name: absPath, full: absPath, isLeaf: true }];
    const drive = m[1] + (m[2].startsWith('\\') ? '\\' : '/');
    const rest = m[2].replace(/^[\\\/]+/, '');
    const parts = rest.split(/[\\\/]/).filter(Boolean);
    const segs = [{ name: drive, full: drive, isLeaf: parts.length === 0 }];
    let acc = drive;
    for (let i = 0; i < parts.length; i++) {
      acc = acc.replace(/[\\\/]+$/, '') + (drive.endsWith('\\') ? '\\' : '/') + parts[i];
      segs.push({ name: parts[i], full: acc, isLeaf: i === parts.length - 1 });
    }
    return segs;
  }
  // POSIX
  const parts = absPath.split('/').filter(Boolean);
  const segs = [];
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    acc += '/' + parts[i];
    segs.push({ name: parts[i], full: acc, isLeaf: i === parts.length - 1 });
  }
  return segs;
}

function renderTree(data) {
  const crumbs = el('mdn-crumbs');
  const list = el('mdn-list');
  if (!list || !crumbs) return;

  // breadcrumb — segments (each clickable, except leaf) + "📍 前往" toggle
  crumbs.innerHTML = '';
  const nav = document.createElement('div');
  nav.className = 'mdn-crumb-nav';
  const segs = splitSegments(data.dir);
  segs.forEach((s, idx) => {
    if (idx > 0) {
      const sep = document.createElement('span');
      sep.className = 'mdn-sep';
      sep.textContent = '›';
      nav.appendChild(sep);
    }
    const seg = document.createElement('span');
    seg.className = 'mdn-seg' + (s.isLeaf ? ' mdn-seg-leaf' : '');
    seg.textContent = s.name;
    seg.title = s.full;
    if (!s.isLeaf) seg.onclick = () => openDir(s.full);
    nav.appendChild(seg);
  });
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'mdn-edit-btn';
  edit.textContent = '📍';
  edit.title = '手动输入路径（Enter 跳转，Esc 取消）';
  edit.setAttribute('aria-label', '手动输入路径');
  edit.onclick = () => enterEditMode(data.dir);
  nav.appendChild(edit);
  if (data.parent) {
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'mdn-up-btn';
    up.textContent = '⬆ 上级';
    up.title = data.parent;
    up.onclick = () => openDir(data.parent);
    nav.appendChild(up);
  }
  crumbs.appendChild(nav);

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

/** Swap the nav row into a text input for manual path entry. */
function enterEditMode(curDir) {
  const crumbs = el('mdn-crumbs');
  if (!crumbs) return;
  const nav = crumbs.querySelector('.mdn-crumb-nav');
  if (!nav) return;

  // Avoid double entry
  if (crumbs.querySelector('.mdn-edit-row')) return;

  const row = document.createElement('div');
  row.className = 'mdn-edit-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mdn-edit-input';
  input.value = curDir;
  input.placeholder = '输入绝对路径… 例如  H:\\Hesi\\.workbuddy\\memory';
  input.spellcheck = false;
  input.autocomplete = 'off';
  // Bind whitelisted roots as datalist suggestions (replaces the old root chip row).
  const dlId = 'mdn-roots-datalist';
  input.setAttribute('list', dlId);
  const datalist = document.createElement('datalist');
  datalist.id = dlId;
  const roots = state.roots || [];
  roots.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.path;
    opt.label = r.name;
    datalist.appendChild(opt);
  });

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'mdn-edit-go';
  go.textContent = '前往';
  go.title = '跳转（Enter）';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mdn-edit-cancel';
  cancel.textContent = '取消';
  cancel.title = '取消（Esc）';

  row.appendChild(input);
  row.appendChild(go);
  row.appendChild(cancel);
  row.appendChild(datalist);

  nav.style.display = 'none';
  crumbs.appendChild(row);
  // Select the path stem (drop trailing slash for easy overtype)
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);

  let busy = false;
  const submit = () => {
    if (busy) return;
    const v = (input.value || '').trim();
    if (!v) {
      Q().showToast?.('路径不能为空', 'error');
      return;
    }
    busy = true;
    openDir(v).finally(() => {
      busy = false;
    });
  };
  const close = () => {
    if (nav.parentNode) nav.style.display = '';
    row.remove();
  };

  go.onclick = submit;
  cancel.onclick = close;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  // Click outside the row → cancel (UX nicety, mirrors pin-quick behaviour)
  const onDocClick = (e) => {
    if (!row.contains(e.target) && e.target !== nav && !nav.contains(e.target)) {
      document.removeEventListener('mousedown', onDocClick, true);
      close();
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onDocClick, true), 0);
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
    // 落点：系统资源 (order 1) 之后、编排 (digital 下一组) 之前
    category: 'monitor',
    order: 2,
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
