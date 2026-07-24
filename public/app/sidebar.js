// @ts-check
// ============================================================
// CLI Sidebar — CLI 列表渲染、文件夹管理、收藏/隐藏、启动/删除/发现
//
// 原 app.js §2(部分) + §6~17 + §18(部分) + §23
// ============================================================

/** @typedef {import('../types').QCLI} QCLI */

import { state, dom, getCategoryIcon, getCategoryLabel } from '../state.js';
import { __ as _i18n__ } from '../i18n.js';
import { termRef, fitAddonRef, pendingInit } from './shared.js';
import { safeStorage } from '../lib/storage.js';

const __ = _i18n__ || function(k) { return k; };
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});
const wsSend = (...args) => Q.wsSend(...args);

// ──────────────────────────────────────────────
// Favorites & Hidden (localStorage)
// ──────────────────────────────────────────────
const FAV_KEY = 'qcli-favorites';
const HIDE_KEY = 'qcli-hidden';

function getFavorites() {
  return safeStorage.getJSON(FAV_KEY, []);
}
function setFavorites(ids) { safeStorage.setJSON(FAV_KEY, ids); }
function isFavorite(cliId) { return getFavorites().includes(cliId); }
function toggleFavorite(cliId) {
  const favs = getFavorites();
  const idx = favs.indexOf(cliId);
  if (idx === -1) favs.push(cliId); else favs.splice(idx, 1);
  setFavorites(favs);
  renderCLIList();
}

function getHidden() {
  return safeStorage.getJSON(HIDE_KEY, []);
}
function isHidden(cliId) { return getHidden().includes(cliId); }
function toggleHidden(cliId) {
  const hidden = getHidden();
  const idx = hidden.indexOf(cliId);
  if (idx === -1) hidden.push(cliId); else hidden.splice(idx, 1);
  safeStorage.setJSON(HIDE_KEY, hidden);
  renderCLIList();
}

// ──────────────────────────────────────────────
// Load CLIs
// ──────────────────────────────────────────────
async function loadCLIs() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch('/api/clis', { signal: controller.signal });
    if (resp.ok) {
      const data = await resp.json();
      state.clis = data.clis || [];
      state.folders = data.folders || [];
    } else {
      state.clis = []; state.folders = [];
      console.warn('Failed to load CLIs:', resp.status);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('loadCLIs timed out after 10s');
    } else { console.error('Failed to load CLIs:', err); }
    state.clis = []; state.folders = [];
  } finally { clearTimeout(timeoutId); }
  renderCLIList();
  if (Q.hideProgressBar) Q.hideProgressBar();
  if (dom.welcomeOverlay) dom.welcomeOverlay.classList.add('welcome-loaded');
}

// ──────────────────────────────────────────────
// Folder CRUD
// ──────────────────────────────────────────────
async function createFolder(name) {
  try {
    const resp = await fetch('/api/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (resp.ok) {
      const folder = await resp.json();
      state.folders.push(folder);
      renderCLIList();
      Q.showUploadStatus?.(`Created folder "${folder.name}"`);
    }
  } catch (err) { console.error('Failed to create folder:', err); }
}

async function updateFolderOnServer(folderId, changes) {
  try {
    await fetch(`/api/folders/${folderId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
  } catch (err) { console.error('Failed to update folder:', err); }
}

async function deleteFolderOnServer(folderId) {
  try {
    const resp = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
    if (resp.ok) {
      state.folders = state.folders.filter(f => f.id !== folderId);
      renderCLIList();
      Q.showUploadStatus?.('Folder deleted');
    }
  } catch (err) { console.error('Failed to delete folder:', err); }
}

// ──────────────────────────────────────────────
// Search + Category Filter
// ──────────────────────────────────────────────
function filterCLIs(clis) {
  let result = clis;
  if (!state.searchQuery) { result = result.filter(cli => !isHidden(cli.id)); }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    result = result.filter(cli =>
      cli.name.toLowerCase().includes(q) ||
      (cli.version && cli.version.toLowerCase().includes(q))
    );
  }
  if (state.categoryFilter !== 'all') {
    if (state.categoryFilter === 'favorites') {
      const favs = getFavorites();
      result = result.filter(cli => favs.includes(cli.id));
    } else {
      result = result.filter(cli => (cli.category || 'tool') === state.categoryFilter);
    }
  }
  return result;
}

// ──────────────────────────────────────────────
// Category Statistics
// ──────────────────────────────────────────────
function updateCategoryCounts() {
  if (!dom.categoryFilters) return;
  const total = state.clis.length;
  const counts = { agent: 0, directory: 0, tool: 0, favorites: 0 };
  const favs = getFavorites();
  for (const cli of state.clis) {
    const cat = cli.category || 'tool';
    if (counts[cat] !== undefined) counts[cat]++;
    if (favs.includes(cli.id)) counts.favorites++;
  }
  const chips = dom.categoryFilters.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    const cat = chip.dataset.category;
    if (cat === 'all') { chip.textContent = `All (${total})`; }
    else if (cat === 'favorites') { chip.textContent = `\u2605 Favorites (${counts.favorites})`; }
    else if (counts[cat] !== undefined) { chip.textContent = `${getCategoryIcon(cat)} ${getCategoryLabel(cat)} (${counts[cat]})`; }
  });
}

// ──────────────────────────────────────────────
// Render CLI List
// ──────────────────────────────────────────────
function sortCLIs(clis) {
  const favs = getFavorites();
  return [...clis].sort((a, b) => {
    const aFav = favs.includes(a.id) ? 0 : 1;
    const bFav = favs.includes(b.id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

function renderCLIList() {
  if (!dom.cliList) return;
  dom.cliList.innerHTML = '';
  updateCategoryCounts();
  const isFirstRender = !dom.cliList._hasRendered;
  dom.cliList._hasRendered = true;

  const filteredCLIs = filterCLIs(state.clis);
  const cliMap = {};
  for (const cli of filteredCLIs) { cliMap[cli.id] = cli; }

  if (filteredCLIs.length === 0) {
    const msg = state.searchQuery ? `No CLIs match "${state.searchQuery}"` : 'No CLIs found. Click + to add.';
    const empty = document.createElement('div');
    empty.className = 'cli-item';
    empty.style.cursor = 'default';
    empty.style.color = 'var(--text-tertiary)';
    empty.textContent = msg;
    dom.cliList.appendChild(empty);
    return;
  }

  const assignedIds = new Set();

  for (const folder of state.folders) {
    const folderCLIs = sortCLIs(folder.cliIds.filter(id => cliMap[id]).map(id => cliMap[id]));
    if (folderCLIs.length === 0 && state.searchQuery) continue;
    const folderEl = renderFolder(folder, folderCLIs, isFirstRender);
    dom.cliList.appendChild(folderEl);
    for (const cli of folderCLIs) { assignedIds.add(cli.id); }
  }

  const uncategorizedCLIs = sortCLIs(filteredCLIs.filter(cli => !assignedIds.has(cli.id)));
  if (uncategorizedCLIs.length > 0) {
    const section = document.createElement('div');
    section.className = 'folder-item';

    const header = document.createElement('div');
    header.className = 'folder-header';
    header.style.cursor = 'default';
    header.style.textTransform = 'none';
    header.style.fontWeight = '500';
    header.style.letterSpacing = '0';
    header.style.fontSize = '11px';
    header.style.color = 'var(--text-tertiary)';
    header.style.padding = '4px 8px';
    header.textContent = `Others  (${uncategorizedCLIs.length})`;

    header.addEventListener('dragover', (e) => { e.preventDefault(); header.style.background = 'rgba(99, 102, 241, 0.15)'; header.style.borderRadius = '6px'; });
    header.addEventListener('dragleave', () => { header.style.background = ''; });
    header.addEventListener('drop', async (e) => {
      e.preventDefault(); header.style.background = '';
      const cliId = e.dataTransfer.getData('text/cli-id');
      if (cliId) await removeCLIFromAllFolders(cliId);
    });

    section.appendChild(header);
    const clisWrap = document.createElement('div');
    clisWrap.className = 'folder-clis';
    for (const cli of uncategorizedCLIs) {
      const el = createCLIElement(cli);
      if (isFirstRender) el.classList.add('entering');
      clisWrap.appendChild(el);
    }
    section.appendChild(clisWrap);
    dom.cliList.appendChild(section);
  }
}

// ──────────────────────────────────────────────
// Render a single folder
// ──────────────────────────────────────────────
function renderFolder(folder, folderCLIs, isFirstRender) {
  const folderEl = document.createElement('div');
  folderEl.className = 'folder-item';
  folderEl.dataset.folderId = folder.id;

  const header = document.createElement('div');
  header.className = 'folder-header';
  header.draggable = false;

  const toggle = document.createElement('span');
  toggle.className = 'folder-toggle' + (folder.collapsed ? ' collapsed' : '');
  toggle.textContent = '\u25bc';
  header.appendChild(toggle);

  if (state.renamingFolderId === folder.id) {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'folder-name-input';
    input.value = folder.name; input.autofocus = true;
    input.addEventListener('blur', () => finishRename(folder.id, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishRename(folder.id, input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); state.renamingFolderId = null; renderCLIList(); }
      e.stopPropagation();
    });
    setTimeout(() => input.focus(), 0);
    header.appendChild(input);
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name-text';
    nameSpan.textContent = folder.name;
    header.appendChild(nameSpan);
  }

  const actions = document.createElement('span');
  actions.className = 'folder-actions';

  const renameBtn = document.createElement('button');
  renameBtn.className = 'folder-action-btn';
  renameBtn.textContent = '\u270f';
  renameBtn.title = 'Rename folder';
  renameBtn.addEventListener('click', (e) => { e.stopPropagation(); state.renamingFolderId = folder.id; renderCLIList(); });
  actions.appendChild(renameBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'folder-action-btn danger';
  delBtn.textContent = '\u00d7';
  delBtn.title = 'Delete folder (CLIs will be uncategorized)';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(__('cli.deleteConfirm', folder.name))) deleteFolderOnServer(folder.id);
  });
  actions.appendChild(delBtn);
  header.appendChild(actions);

  header.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.closest('.folder-actions')) return;
    folder.collapsed = !folder.collapsed;
    updateFolderOnServer(folder.id, { collapsed: folder.collapsed });
    renderCLIList();
  });

  header.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); header.classList.add('drag-over'); });
  header.addEventListener('dragleave', () => { header.classList.remove('drag-over'); });
  header.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); header.classList.remove('drag-over');
    const cliId = e.dataTransfer.getData('text/cli-id');
    if (cliId) moveCLIToFolder(cliId, folder.id);
  });

  folderEl.appendChild(header);

  const clisWrap = document.createElement('div');
  clisWrap.className = 'folder-clis' + (folder.collapsed ? ' collapsed' : '');

  const showCLIs = !folder.collapsed || state.searchQuery;
  if (showCLIs) {
    for (const cli of folderCLIs) {
      const el = createCLIElement(cli);
      if (isFirstRender) el.classList.add('entering');
      clisWrap.appendChild(el);
    }
  }

  clisWrap.addEventListener('dragover', (e) => { e.preventDefault(); clisWrap.classList.add('drag-over'); });
  clisWrap.addEventListener('dragleave', () => { clisWrap.classList.remove('drag-over'); });
  clisWrap.addEventListener('drop', (e) => {
    e.preventDefault(); clisWrap.classList.remove('drag-over');
    const cliId = e.dataTransfer.getData('text/cli-id');
    if (cliId) moveCLIToFolder(cliId, folder.id);
  });

  folderEl.appendChild(clisWrap);
  return folderEl;
}

// ──────────────────────────────────────────────
// Create a single CLI element
// ──────────────────────────────────────────────
function createCLIElement(cli) {
  const item = document.createElement('div');
  item.className = 'cli-item';
  item.dataset.cliId = cli.id;
  item.draggable = true;
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', 'false');

  if (cli.id === state.activeCliId) {
    item.classList.add('active');
    item.setAttribute('aria-selected', 'true');
  }
  if (isFavorite(cli.id)) {
    item.classList.add('favorited');
  }

  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/cli-id', cli.id);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  item.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/cli-id');
    if (draggedId && draggedId !== cli.id) item.classList.add('drag-over');
  });
  item.addEventListener('dragleave', () => { item.classList.remove('drag-over'); });
  item.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); item.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/cli-id');
    if (draggedId && draggedId !== cli.id) {
      const targetFolder = findFolderForCLI(cli.id);
      if (targetFolder) moveCLIToFolder(draggedId, targetFolder.id);
      else removeCLIFromAllFolders(draggedId);
    }
  });

  const icon = document.createElement('span');
  icon.className = 'cli-icon';
  icon.textContent = getCLIIcon(cli.name);
  item.appendChild(icon);

  const info = document.createElement('div');
  info.className = 'cli-info';
  const name = document.createElement('div');
  name.className = 'cli-name';
  name.textContent = cli.name;
  info.appendChild(name);
  if (cli.version && cli.version !== 'unknown') {
    const ver = document.createElement('div');
    ver.className = 'cli-version';
    // Truncate long version strings for display
    const verText = cli.version.length > 25 ? cli.version.slice(0, 22) + '...' : cli.version;
    ver.textContent = verText;
    ver.title = cli.version; // Full version on hover
    info.appendChild(ver);
  } else if (cli.path) {
    // Show quick path hint if no version available
    const pathHint = document.createElement('div');
    pathHint.className = 'cli-version';
    pathHint.style.color = 'var(--text-tertiary)';
    pathHint.style.fontSize = '8px';
    pathHint.textContent = cli.path.split(/[\\\/]/).pop() || cli.name;
    pathHint.title = cli.path;
    info.appendChild(pathHint);
  }
  item.appendChild(info);

  const cat = cli.category || 'tool';
  const catBadge = document.createElement('span');
  catBadge.className = `cli-category-badge ${cat}`;
  catBadge.textContent = getCategoryIcon(cat) + ' ' + getCategoryLabel(cat);
  item.appendChild(catBadge);

  const badge = document.createElement('span');
  badge.className = 'cli-type-badge';
  badge.textContent = cli.type || 'batch';
  item.appendChild(badge);

  const fav = document.createElement('button');
  const isFav = isFavorite(cli.id);
  fav.className = 'cli-fav-btn' + (isFav ? ' favorited' : '');
  fav.textContent = isFav ? '\u2605' : '\u2606';
  fav.title = isFav ? 'Remove from favorites' : 'Add to favorites';
  fav.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(cli.id); });
  item.appendChild(fav);

  const del = document.createElement('button');
  del.className = 'delete-cli-btn';
  del.textContent = '\u00d7';
  del.title = 'Remove CLI';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteCLI(cli.id); });
  item.appendChild(del);

  item.addEventListener('click', () => { launchCLI(cli.id); });
  return item;
}

// ──────────────────────────────────────────────
// Folder helpers
// ──────────────────────────────────────────────
function findFolderForCLI(cliId) {
  return state.folders.find(f => f.cliIds.includes(cliId)) || null;
}

async function moveCLIToFolder(cliId, targetFolderId) {
  for (const folder of state.folders) {
    const idx = folder.cliIds.indexOf(cliId);
    if (idx !== -1) { folder.cliIds.splice(idx, 1); await updateFolderOnServer(folder.id, { cliIds: folder.cliIds }); }
  }
  const target = state.folders.find(f => f.id === targetFolderId);
  if (target) {
    if (!target.cliIds.includes(cliId)) { target.cliIds.push(cliId); await updateFolderOnServer(target.id, { cliIds: target.cliIds }); }
  }
  renderCLIList();
  Q.showUploadStatus?.('CLI moved');
}

async function removeCLIFromAllFolders(cliId) {
  for (const folder of state.folders) {
    const idx = folder.cliIds.indexOf(cliId);
    if (idx !== -1) { folder.cliIds.splice(idx, 1); await updateFolderOnServer(folder.id, { cliIds: folder.cliIds }); }
  }
  renderCLIList();
}

async function finishRename(folderId, newName) {
  state.renamingFolderId = null;
  const name = newName.trim();
  if (name) {
    const folder = state.folders.find(f => f.id === folderId);
    if (folder) { folder.name = name; await updateFolderOnServer(folderId, { name }); }
  }
  renderCLIList();
}

// ──────────────────────────────────────────────
// CLI State & Icons
// ──────────────────────────────────────────────
function updateCLIState(cliId, activeState) {
  if (!dom.cliList) return;
  const items = dom.cliList.querySelectorAll('.cli-item');
  for (const item of items) {
    item.classList.remove('active', 'running');
    item.setAttribute('aria-selected', 'false');
    if (item.dataset.cliId === cliId && activeState === 'running') {
      item.classList.add('active', 'running');
      item.setAttribute('aria-selected', 'true');
    }
  }
}

function getCLIIcon(name) {
  const icons = {
    opencode: '\u26a1', node: '\ud83d\udfe2', python: '\ud83d\udc0d', python3: '\ud83d\udc0d',
    git: '\u2387', docker: '\ud83d\udc33', kubectl: '\u2638',
    npm: '\ud83d\udce6', npx: '\ud83d\udce6', pnpm: '\ud83d\udce6', yarn: '\ud83d\udce6', bun: '\ud83e\udd5f',
    bash: '>_', zsh: '%', powershell: '\ud83e\ude9f', pwsh: '\ud83e\ude9f', cmd: '>',
    ssh: '\ud83d\udd10', mysql: '\ud83d\udc2c', redis: '\ud83d\udd34', mongosh: '\ud83c\udf43',
    cargo: '\ud83e\udd80', go: '\ud83d\udd37', deno: '\ud83e\udd95',
    vim: '\u270f\ufe0f', nvim: '\u270f\ufe0f', nano: '\u270f\ufe0f', tmux: '\u229e',
    lazygit: '\u2387', gh: '\ud83d\udc19', code: '\ud83d\udcbb',
    curl: '\ud83c\udf10', wget: '\u2b07', htop: '\ud83d\udcca', btop: '\ud83d\udcca',
    neofetch: '\ud83d\udda5', fastfetch: '\ud83d\udda5',
  };
  return icons[name] || '\u25b8';
}

// ──────────────────────────────────────────────
// Launch CLI
// ──────────────────────────────────────────────
function launchCLI(cliId) {
  if (!Q.ws || Q.ws.readyState !== WebSocket.OPEN) {
    console.warn('Not connected');
    if (Q.showToast) Q.showToast(Q.__?.('cli.notConnected') || '⚠️ WebSocket not connected, please wait and retry', 'info');
    return;
  }

  const existingTab = Q.Tabs?.tabs?.find(t => t.cliId === cliId);
  if (existingTab && Q.Tabs?.switch) {
    Q.Tabs.switch(existingTab.tabId);
    state.activeCliId = cliId;
    dom.activeLabel.textContent = existingTab.name || cliId;
    dom.welcomeOverlay.classList.add('hidden');
    updateCLIState(cliId, null);
    return;
  }

  const dims = fitAddonRef.current ? fitAddonRef.current.proposeDimensions() : null;
  const cols = dims ? dims.cols : 80;
  const rows = dims ? dims.rows : 24;
  const cli = state.clis.find(c => c.id === cliId);

  state.launching = true;
  dom.activeLabel.className = 'starting';
  dom.activeLabel.textContent = `Starting ${cli ? cli.name : cliId}...`;
  dom.activeVersion.textContent = '';
  state.activeCliId = cliId;

  const tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);

  if (!Q.Tabs && termRef.current) termRef.current.reset();
  wsSend({ type: 'launch', cliId, cols, rows, tabId });
}

// ──────────────────────────────────────────────
// Delete CLI
// ──────────────────────────────────────────────
async function deleteCLI(cliId) {
  if (state.activeCliId === cliId) {
    if (state.launched) wsSend({ type: 'kill' });
    state.activeCliId = null;
  }
  try {
    const resp = await fetch(`/api/clis/${cliId}`, { method: 'DELETE' });
    if (resp.ok) {
      for (const folder of state.folders) {
        const idx = folder.cliIds.indexOf(cliId);
        if (idx !== -1) { folder.cliIds.splice(idx, 1); await updateFolderOnServer(folder.id, { cliIds: folder.cliIds }); }
      }
      state.clis = state.clis.filter(c => c.id !== cliId);
      renderCLIList();
      Q.showUploadStatus?.(`Removed ${cliId}`);
    } else { Q.showUploadStatus?.(`Failed to remove ${cliId}`); }
  } catch (err) {
    console.error('Failed to delete CLI:', err);
    Q.showUploadStatus?.('Network error - could not remove CLI');
  }
}

// ──────────────────────────────────────────────
// Discover CLIs
// ──────────────────────────────────────────────
async function discoverCLIs() {
  if (Q.showProgressBar) Q.showProgressBar();
  dom.discoverBtn.textContent = '\u27f3';
  dom.discoverBtn.style.animation = 'spin 1s linear infinite';
  try {
    const resp = await fetch('/api/discover', { method: 'POST' });
    if (!resp.ok) {
      Q.showUploadStatus?.(`Discovery failed (${resp.status})`);
      state.clis = []; state.folders = []; renderCLIList();
      if (Q.hideProgressBar) Q.hideProgressBar();
      return;
    }
    const data = await resp.json();
    state.clis = data.registry.clis || [];
    renderCLIList();
    if (data.discovered && data.discovered.length > 0) {
      Q.showUploadStatus?.(`Found ${data.discovered.length} new CLI${data.discovered.length > 1 ? 's' : ''}`);
    }
  } catch (err) {
    console.error('Discovery failed:', err);
    Q.showUploadStatus?.('Discovery failed - network error');
  }
  if (Q.hideProgressBar) Q.hideProgressBar();
  dom.discoverBtn.style.animation = '';
  dom.discoverBtn.textContent = '\u27f3';
}

// ──────────────────────────────────────────────
// Sidebar Tools — wire up feature buttons
// ──────────────────────────────────────────────
function initToolsSection() {
  const grid = document.getElementById('sidebar-tools-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.sidebar-tool-btn');
    if (!btn) return;
    const tool = btn.dataset.tool;
    if (!tool) return;

    switch (tool) {
      case 'browser-scripts':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('browser-scripts');
        break;
      case 'network-monitor':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('network-monitor');
        break;
      case 'browser-farm':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('browser-farm');
        break;
      case 'dom-diff':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('dom-diff');
        break;
      case 'form-autofill':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('form-autofill');
        break;
      case 'accessibility':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('accessibility');
        break;
      case 'cli-health':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('cli-health');
        break;
      case 'cli-importer':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('cli-importer');
        break;
      case 'cli-preset-install':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('cli-preset-install');
        break;
      case 'plugin-manager':
        if (!Q.RightPanel) {
          Q.showToast?.('面板系统加载中，请稍候...', 'info');
          return;
        }
        if (Q.RightPanel.collapsed) Q.RightPanel.open();
        Q.RightPanel.switchTab('plugin-manager');
        break;
      case 'plugin-market':
      case 'plugin-plaza':
        window.open('/plugin-plaza.html', '_blank');
        break;
      case 'workbuddy-hub':
        window.open('/workbuddy-hub.html', '_blank');
        break;
      case 'tools-page':
        window.open('/tools.html', '_blank');
        break;
    }
  });
}

// ──────────────────────────────────────────────
// Init sidebar — wire up DOM events
// ──────────────────────────────────────────────
function initSidebar() {
  // Init tools section
  initToolsSection();

  // Search input
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', () => {
      state.searchQuery = dom.searchInput.value.trim();
      renderCLIList();
    });
  }

  // Ctrl+F focus search
  if (dom.searchInput) {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !dom.searchInput.matches(':focus')) {
        e.preventDefault();
        dom.searchInput.focus();
      }
    });
  }

  // Add folder button
  if (dom.addFolderBtn) {
    dom.addFolderBtn.addEventListener('click', async () => {
      const name = prompt('Folder name:');
      if (name && name.trim()) await createFolder(name.trim());
    });
  }

  // Discover button
  if (dom.discoverBtn) {
    dom.discoverBtn.addEventListener('click', discoverCLIs);
  }
}

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────
Q.loadCLIs = loadCLIs;
Q.renderCLIList = renderCLIList;
Q.renderFolder = renderFolder;
Q.createCLIElement = createCLIElement;
Q.filterCLIs = filterCLIs;
Q.updateCategoryCounts = updateCategoryCounts;
Q.launchCLI = launchCLI;
Q.deleteCLI = deleteCLI;
Q.updateCLIState = updateCLIState;
Q.getCLIIcon = getCLIIcon;
Q.discoverCLIs = discoverCLIs;
Q.getFavorites = getFavorites;
Q.isFavorite = isFavorite;
Q.toggleFavorite = toggleFavorite;
Q.isHidden = isHidden;
Q.toggleHidden = toggleHidden;

Q.Sidebar = Q.Sidebar || {};
Q.Sidebar.discoverCLIs = discoverCLIs;
Q.Sidebar.renderCLIList = renderCLIList;
Q.Sidebar.renderFolder = renderFolder;
Q.Sidebar.createCLIElement = createCLIElement;
Q.Sidebar.filterCLIs = filterCLIs;
Q.Sidebar.updateCategoryCounts = updateCategoryCounts;
Q.Sidebar.launchCLI = launchCLI;
Q.Sidebar.deleteCLI = deleteCLI;

export {
  initSidebar, loadCLIs, renderCLIList, renderFolder, createCLIElement,
  launchCLI, deleteCLI, discoverCLIs,
  createFolder, deleteFolderOnServer, updateFolderOnServer,
  filterCLIs, updateCategoryCounts, updateCLIState, finishRename,
  findFolderForCLI, moveCLIToFolder, removeCLIFromAllFolders,
  getCLIIcon,
  getFavorites, isFavorite, isHidden, toggleFavorite, toggleHidden,
};
