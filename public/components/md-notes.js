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

const state = { roots: [], dir: '', _history: [] };

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
    '<div class="md-notes-body" id="mdn-body">' +
    '<div class="md-notes-tree" id="mdn-tree">' +
    '<div class="mdn-crumbs" id="mdn-crumbs"></div>' +
    '<div class="mdn-list" id="mdn-list"><div class="mdn-hint">点面包屑右侧「📍 前往」输入路径，或选择下方任一已加载目录</div></div>' +
    '</div>' +
    '<div class="mdn-splitter" id="mdn-splitter" role="separator" aria-orientation="vertical" title="拖动调整左右宽度"></div>' +
    '<div class="md-notes-reader" id="mdn-reader"><div class="mdn-hint">点击 .md 文件查看内容</div></div>' +
    '</div>' +
    '</div>';

  // Restore persisted tree width (set by user dragging the splitter)
  applyTreeWidth(getStoredTreeWidth());

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

  // Wire up the splitter (idempotent — one listener per render)
  setupSplitter();
}

async function openDir(dir) {
  const list = el('mdn-list');
  const crumbs = el('mdn-crumbs');
  if (list) list.innerHTML = '<div class="mdn-loading">加载中…</div>';
  try {
    const data = await apiGet('/api/fs/md-list?dir=' + encodeURIComponent(dir));
    // Push onto history only when we actually navigated to a *new* dir.
    // Skip the initial auto-open (empty history) and consecutive identical dirs.
    if (state._history.length === 0) {
      state._history = [data.dir];
    } else if (state._history[state._history.length - 1] !== data.dir) {
      state._history.push(data.dir);
    }
    state.dir = data.dir;
    renderTree(data);
  } catch (e) {
    if (crumbs) crumbs.innerHTML = '';
    if (list) list.innerHTML = '<div class="mdn-error">' + escapeHtml(e.message) + '</div>';
  }
}

/** Pop the history stack and navigate back. Falls back to the first root. */
function goBack() {
  if (state._history.length > 1) {
    state._history.pop();
    const target = state._history[state._history.length - 1];
    openDir(target);
  } else if (state.roots && state.roots[0]) {
    // Already at the entry root (or history is empty) — still go to the first root.
    openDir(state.roots[0].path);
  } else {
    Q().showToast?.('没有可返回的目录', 'info');
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

// ──────────────────────────────────────────────────────────────────────
// Whitelist check (mirrors backend isWithinRoots).
//   A path is "inside" a root when it equals the root path, OR when it is
//   a strict descendant (proper prefix, followed by a separator) — this
//   avoids the C:\foo being mistakenly treated as "inside" C:\foob.
// ──────────────────────────────────────────────────────────────────────
function normalizeForCompare(p) {
  if (!p) return '';
  return p.replace(/[\\/]+$/, '');
}
function isUnderSomeRoot(fullPath, roots) {
  if (!fullPath) return false;
  const fp = normalizeForCompare(fullPath);
  for (const r of roots || []) {
    const rp = normalizeForCompare(r && r.path);
    if (!rp) continue;
    if (fp === rp) return true;
    if (fp.length > rp.length && fp.startsWith(rp)) {
      const tail = fp[rp.length];
      if (tail === '\\' || tail === '/') return true;
    }
  }
  return false;
}

function renderTree(data) {
  const crumbs = el('mdn-crumbs');
  const list = el('mdn-list');
  if (!list || !crumbs) return;

  // breadcrumb — ⬅ back + clickable segments + "📍 前往" toggle + ⬆ up
  crumbs.innerHTML = '';
  const nav = document.createElement('div');
  nav.className = 'mdn-crumb-nav';

  // 1) Back button — always visible, history-aware tooltip, falls back to first root.
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'mdn-back-btn';
  back.textContent = '⬅';
  back.setAttribute('aria-label', '返回上一目录');
  const hasPrev = state._history.length > 1;
  back.title = hasPrev
    ? '返回 ' + state._history[state._history.length - 2]
    : (state.roots && state.roots[0]
        ? '回到根目录 ' + state.roots[0].path
        : '返回上一目录');
  back.onclick = goBack;
  nav.appendChild(back);

  // 2) Path segments — filter out anything outside the whitelist (e.g. the
  //    drive root H:\ above H:\Hesi would 403 if clicked) and mark whitelist
  //    roots themselves as non-clickable leaves so we never render dead links.
  const rawSegs = splitSegments(data.dir);
  const segs = rawSegs
    .filter((s) => isUnderSomeRoot(s.full, state.roots))
    .map((s, _idx, arr) => {
      // Whitelist roots are *inside* the whitelist but clicking them is
      // meaningless (you'd just refresh the same view), so force leaf style.
      const isRoot = (state.roots || []).some((r) => normalizeForCompare(r.path) === normalizeForCompare(s.full));
      return Object.assign({}, s, {
        isLeaf: s.isLeaf || isRoot,
        clickable: !s.isLeaf && !isRoot,
      });
    });

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
    if (s.clickable) seg.onclick = () => openDir(s.full);
    nav.appendChild(seg);
  });

  // 3) Manual path entry toggle
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'mdn-edit-btn';
  edit.textContent = '📍';
  edit.title = '手动输入路径（Enter 跳转，Esc 取消）';
  edit.setAttribute('aria-label', '手动输入路径');
  edit.onclick = () => enterEditMode(data.dir);
  nav.appendChild(edit);

  // 4) Up one level — only render when the parent is inside the whitelist
  //    (otherwise clicking it would 403 against the backend fail-closed).
  if (data.parent && isUnderSomeRoot(data.parent, state.roots)) {
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

// ──────────────────────────────────────────────────────────────────────
// Splitter: drag the vertical handle between tree and reader to resize.
// Width is persisted to localStorage so it survives reloads.
// ──────────────────────────────────────────────────────────────────────

const SPLITTER_KEY = 'hesi-md-tree-w';
const SPLITTER_MIN = 120;
const SPLITTER_MAX = 800;

function getStoredTreeWidth() {
  try {
    const v = parseInt(localStorage.getItem(SPLITTER_KEY) || '280', 10);
    if (!Number.isFinite(v)) return 280;
    return Math.max(SPLITTER_MIN, Math.min(SPLITTER_MAX, v));
  } catch {
    return 280;
  }
}

function applyTreeWidth(w) {
  const tree = el('mdn-tree');
  const body = el('mdn-body');
  if (!tree || !body) return;
  body.style.setProperty('--tree-w', w + 'px');
}

function setupSplitter() {
  const handle = el('mdn-splitter');
  const tree = el('mdn-tree');
  const body = el('mdn-body');
  if (!handle || !tree || !body) return;
  if (handle._wired) return; // idempotent: re-entry on re-render is a no-op
  handle._wired = true;

  let dragging = false;
  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    let next = startW + dx;
    if (next < SPLITTER_MIN) next = SPLITTER_MIN;
    if (next > SPLITTER_MAX) next = SPLITTER_MAX;
    applyTreeWidth(next);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    // Persist on release (one write, not 60/sec while dragging)
    const tree = el('mdn-tree');
    if (tree) {
      const w = Math.round(tree.getBoundingClientRect().width);
      try { localStorage.setItem(SPLITTER_KEY, String(w)); } catch { /* noop */ }
    }
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = Math.round(tree.getBoundingClientRect().width);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
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
