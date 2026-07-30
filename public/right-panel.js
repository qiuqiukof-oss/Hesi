/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Right Panel Controller — Dashboard/Charts/Media Sidebar
// Supports dynamic tabs from UIRegistry (plugin system).
//
// v2.0: Horizontal scrollable tab bar with categories,
// tab search, more dropdown, collapsible sections, tab management.
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage } from './lib/storage.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const RightPanel = {
  collapsed: false,
  activeTab: 'dashboard',
  width: 300,
};

// ── Event system (pub/sub) ──
const _handlers = {};

function on(event, handler) {
  if (!_handlers[event]) _handlers[event] = [];
  _handlers[event].push(handler);
  return function unsubscribe() {
    const idx = _handlers[event].indexOf(handler);
    if (idx !== -1) _handlers[event].splice(idx, 1);
  };
}

function off(event, handler) {
  if (!_handlers[event]) return;
  if (!handler) { delete _handlers[event]; return; }
  const idx = _handlers[event].indexOf(handler);
  if (idx !== -1) _handlers[event].splice(idx, 1);
}

function emit(event) {
  const handlers = _handlers[event];
  if (!handlers) return;
  const args = Array.prototype.slice.call(arguments, 1);
  for (let i = 0; i < handlers.length; i++) {
    try { handlers[i].apply(null, args); }
    catch (e) { console.warn('[RightPanel] Event handler error:', e); }
  }
}

// ── DOM References ──
let el, toggleBtn, tabs, content, resizeHandle;

// ── Resize state ──
let isResizing = false;
let resizeRAF = null;

const MIN_WIDTH = 200;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 300;
const STORAGE_COLLAPSED_KEY = 'qcli-right-panel-collapsed';
const STORAGE_WIDTH_KEY = 'qcli-right-panel-width';
const STORAGE_TAB_KEY = 'qcli-right-panel-tab';

// ── Tab layout version: bump when reordering tabs to force reset to dashboard ──
const TAB_LAYOUT_VERSION = '2';

// ============================================================
// Initialization
// ============================================================

// Deep-link: if the URL hash names a registered tab (e.g. /#browser-scripts),
// activate it instead of the saved/default tab. Used by the toolbox page so a
// card can jump straight into a specific right-panel tab.
function activateFromHash() {
  const hash = (location.hash || '').replace(/^#/, '').trim();
  if (!hash) return;
  const UIR = Q.UIRegistry;
  if (!UIR || !UIR.getTabs) return;
  const matched = UIR.getTabs().find(function(t) { return t.id === hash; });
  if (!matched) return;
  RightPanel.activeTab = hash;
  if (RightPanel.collapsed) RightPanel.open();
}

function init() {
  el = document.getElementById('right-panel');
  if (!el) return;

  toggleBtn = document.getElementById('right-panel-toggle');
  tabs = document.getElementById('right-panel-tabs');
  content = document.getElementById('right-panel-content');
  resizeHandle = document.getElementById('right-panel-resize-handle');

  // Restore saved state
  restoreState();

  // Deep-link: a hash in the URL (e.g. /#browser-scripts) overrides the saved tab
  activateFromHash();

  // Wire up toggle button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggle);
  }

  // Wire up resize handle
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', startResize);
  }

  // ── Build new horizontal tab bar with search + more dropdown ──
  buildTabBar();

  // Subscribe to late-arriving tab registrations. Re-render ALL tabs in fully
  // sorted order so asynchronously-registered tabs (e.g. the agnes-ai plugin
  // loaded via a dynamic <script>) land in their correct sorted slot instead of
  // being blindly appended to the end of the bar (which froze the wrong order).
  if (Q.UIRegistry) {
    Q.UIRegistry.onTabRegistered = function(tabDef) {
      scheduleRerenderAll();
      // A late-registered tab may be the one requested via URL hash deep-link
      const hash = (location.hash || '').replace(/^#/, '').trim();
      if (tabDef && tabDef.id === hash) {
        if (RightPanel.collapsed) RightPanel.open();
        switchTab(hash, true);
      }
      console.log('[RightPanel] Late-registered plugin tab:', tabDef.id);
    };
  }

  // React to hash changes so deep-links keep working after the app has loaded
  // (e.g. navigating from the toolbox page to /#browser-scripts).
  window.addEventListener('hashchange', function() {
    const hash = (location.hash || '').replace(/^#/, '').trim();
    if (!hash) return;
    const UIR = Q.UIRegistry;
    if (!UIR || !UIR.getTabs) return;
    const matched = UIR.getTabs().find(function(t) { return t.id === hash; });
    if (!matched) return;
    if (RightPanel.collapsed) RightPanel.open();
    if (RightPanel.activeTab !== hash) switchTab(hash, true);
  });

  // ── Populate tab bar with all currently registered tabs ──
  // This must come AFTER onTabRegistered is set so that already-registered
  // tabs (e.g., plugin-manager from main.js) are rendered, while future
  // registrations will still trigger onTabRegistered.
  renderAllTabs();

  // ── Expose API ──
  Q.RightPanel = RightPanel;
  RightPanel.init = init;
  RightPanel.toggle = toggle;
  RightPanel.switchTab = switchTab;
  RightPanel.open = open;
  RightPanel.close = close;
  RightPanel.on = on;
  RightPanel.off = off;
  RightPanel.showTabSearch = showTabSearch;
  RightPanel.toggleMoreDropdown = toggleMoreDropdown;
  RightPanel.createCollapsibleSection = createCollapsibleSection;
  RightPanel.renderAllTabs = renderAllTabs;

  console.log('[RightPanel] Initialized v2 — horizontal tab bar');
}

// ============================================================
// State Persistence
// ============================================================
function restoreState() {
  const savedCollapsed = safeStorage.get(STORAGE_COLLAPSED_KEY);
  if (savedCollapsed === '1') {
    RightPanel.collapsed = true;
    el.classList.add('collapsed');
    if (toggleBtn) toggleBtn.title = '展开右侧栏';
  }

  const savedWidth = safeStorage.get(STORAGE_WIDTH_KEY);
  if (savedWidth) {
    const w = parseInt(savedWidth, 10);
    if (w >= MIN_WIDTH && w <= MAX_WIDTH) {
      RightPanel.width = w;
      applyWidth(w);
    }
  }

  const savedTab = safeStorage.get(STORAGE_TAB_KEY);
  const savedVersion = safeStorage.get('qcli-tab-layout-version');
  // When tab layout version changes (reorder), reset to dashboard default
  if (savedTab && savedVersion === TAB_LAYOUT_VERSION) {
    RightPanel.activeTab = savedTab;
  }
  // Save current version so future restores work
  safeStorage.set('qcli-tab-layout-version', TAB_LAYOUT_VERSION);
}

function saveCollapsed() {
  safeStorage.set(STORAGE_COLLAPSED_KEY, RightPanel.collapsed ? '1' : '0');
}
function saveWidth(width) {
  safeStorage.set(STORAGE_WIDTH_KEY, String(width));
}
function saveTab(tabId) {
  safeStorage.set(STORAGE_TAB_KEY, tabId);
}

// ============================================================
// Toggle (Collapse / Expand)
// ============================================================
function toggle() {
  if (!el) return;
  RightPanel.collapsed = !RightPanel.collapsed;
  el.classList.toggle('collapsed', RightPanel.collapsed);
  if (toggleBtn) toggleBtn.title = RightPanel.collapsed ? '展开右侧栏' : '收起右侧栏';
  saveCollapsed();
  setTimeout(triggerTerminalFit, 280);
}

function open() {
  if (!el) return;
  el.classList.remove('hidden', 'collapsed');
  RightPanel.collapsed = false;
  if (toggleBtn) toggleBtn.title = '收起右侧栏';
  saveCollapsed();
  setTimeout(triggerTerminalFit, 280);
}

function close() {
  if (!el) return;
  el.classList.add('collapsed');
  RightPanel.collapsed = true;
  if (toggleBtn) toggleBtn.title = '展开右侧栏';
  saveCollapsed();
  setTimeout(triggerTerminalFit, 280);
}

// ============================================================
// Tab Switching
// ============================================================
function switchTab(tabId, force) {
  if (!content || (!force && RightPanel.activeTab === tabId)) return;

  const prevTab = RightPanel.activeTab;
  RightPanel.activeTab = tabId;
  saveTab(tabId);

  updateActiveTab(tabId);

  // Show/hide panels
  const panels = content.querySelectorAll('.rp-panel');
  panels.forEach(function(p) { p.classList.remove('active'); });

  const target = document.getElementById('rp-' + tabId);
  if (target) {
    target.classList.add('active');

    // Lazy-render
    if (!Q.UIRegistry?.isTabRendered?.(tabId)) {
      const tabDef = Q.UIRegistry?.getTabs().find(function(t) { return t.id === tabId; });
      if (tabDef && tabDef.render) {
        try {
          tabDef.render(target);
          Q.UIRegistry?.markTabRendered?.(tabId);
        } catch (e) {
          console.error('[RightPanel] Plugin tab render error:', tabId, e);
        }
      }
    }
  }

  // Entrance animation
  if (target) {
    target.style.animation = 'none';
    void target.offsetWidth;
    target.style.animation = '';
  }

  // Update header
  const headerIcon = el.querySelector('.right-panel-header-icon');
  if (headerIcon) {
    const UIR = Q.UIRegistry;
    const pluginTab = UIR?.getTabs().find(function(t) { return t.id === tabId; });
    headerIcon.textContent = pluginTab ? pluginTab.icon : '📊';
  }
  const titleEl = el.querySelector('.right-panel-title');
  if (titleEl) {
    const UIR2 = Q.UIRegistry;
    const pluginTab2 = UIR2?.getTabs().find(function(t) { return t.id === tabId; });
    titleEl.textContent = pluginTab2 ? pluginTab2.label : '工作台';
  }

  // Re-trigger scroll indicators
  requestAnimationFrame(updateScrollIndicators);

  emit('tab:switch', tabId, prevTab);
}

function updateActiveTab(tabId) {
  if (!tabs) return;
  const tabBtns = tabs.querySelectorAll('.right-tab');
  tabBtns.forEach(function(t) {
    t.classList.toggle('active', t.dataset.panel === tabId);
  });
  // Also update more dropdown items
  const dropdown = document.getElementById('rp-tab-more-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.rp-tab-more-item').forEach(function(item) {
      item.classList.toggle('active', item.dataset.tabId === tabId);
    });
  }
}

// ============================================================
// New Horizontal Tab Bar
// ============================================================
function buildTabBar() {
  // Remove old tabs element to avoid duplicate IDs
  const oldTabs = document.getElementById('right-panel-tabs');
  if (oldTabs && oldTabs.parentNode) {
    oldTabs.parentNode.removeChild(oldTabs);
  }

  const bar = document.createElement('div');
  bar.className = 'right-panel-tab-bar';
  bar.id = 'right-panel-tab-bar';

  const tabsContainer = document.createElement('nav');
  tabsContainer.className = 'right-panel-tabs';
  tabsContainer.id = 'right-panel-tabs';
  bar.appendChild(tabsContainer);

  const actions = document.createElement('div');
  actions.className = 'right-panel-tab-actions';
  actions.innerHTML = [
    '<button class="rp-tab-action-btn" id="rp-tab-search-btn" title="搜索Tab (Ctrl+Shift+T)">🔍</button>',
    '<button class="rp-tab-action-btn" id="rp-tab-more-btn" title="更多Tab">☰</button>',
  ].join('');
  bar.appendChild(actions);

  // Insert before content area
  const contentArea = document.getElementById('right-panel-content');
  if (contentArea && contentArea.parentNode) {
    contentArea.parentNode.insertBefore(bar, contentArea);
  }

  tabs = tabsContainer;

  // ── Tab switching ──
  tabsContainer.addEventListener('click', function(e) {
    const tab = e.target.closest('.right-tab');
    if (tab && tab.dataset.panel) {
      switchTab(tab.dataset.panel);
      if (RightPanel.collapsed) toggle();
    }
  });

  // ── Scroll detection ──
  tabsContainer.addEventListener('scroll', updateScrollIndicators);

  // ── Search button ──
  document.getElementById('rp-tab-search-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    closeMoreDropdown();
    showTabSearch();
  });

  // ── More button ──
  document.getElementById('rp-tab-more-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    closeTabSearch();
    toggleMoreDropdown();
  });

  // ── Close dropdowns on outside click ──
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.rp-tab-more-dropdown') && !e.target.closest('#rp-tab-more-btn')) {
      closeMoreDropdown();
    }
    if (!e.target.closest('.rp-tab-search-overlay') && !e.target.closest('#rp-tab-search-btn') && !e.target.closest('#rp-tab-search-input')) {
      closeTabSearch();
    }
  });

  // Keyboard shortcut: Ctrl+Shift+T to open tab search
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      closeMoreDropdown();
      showTabSearch();
    }
  });
}

// Coalesce multiple late tab registrations (same tick) into a single re-render
// so the bar always reflects the fully sorted tab list (by category then order).
let _rerenderScheduled = false;
function scheduleRerenderAll() {
  if (_rerenderScheduled) return;
  _rerenderScheduled = true;
  Promise.resolve().then(function() {
    _rerenderScheduled = false;
    renderAllTabs();
  });
}

function renderAllTabs() {
  if (!tabs) return;
  tabs.innerHTML = '';

  const UIR = Q.UIRegistry;
  if (!UIR) return;

  // Restore hidden prefs from localStorage
  UIR.restoreHiddenPrefs();

  const groups = UIR.getTabsByCategory();
  let isFirst = true;

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.tabs.length === 0) continue;

    // Category gap
    if (!isFirst) {
      const gap = document.createElement('div');
      gap.className = 'right-tab-category-gap';
      tabs.appendChild(gap);
    }
    isFirst = false;

    for (let t = 0; t < group.tabs.length; t++) {
      const tabDef = group.tabs[t];
      const btn = createPluginTabButton(tabDef);
      tabs.appendChild(btn);

      // Ensure panel container exists
      const panelId = 'rp-' + tabDef.id;
      if (!document.getElementById(panelId) && content) {
        content.appendChild(createPluginTabPanel(tabDef));
      }
    }
  }

  requestAnimationFrame(function() {
    // Use switchTab instead of updateActiveTab to sync header icon/title
    let targetTab = RightPanel.activeTab;
    const UIR2 = Q.UIRegistry;
    if (UIR2 && UIR2.isTabHidden(targetTab)) {
      const firstTab = (UIR2.getTabs() || [])[0];
      if (firstTab) targetTab = firstTab.id;
    }
    switchTab(targetTab, true);
    updateScrollIndicators();
  });
}

function addTabToBar(tabDef) {
  if (!tabs) return;
  const btn = createPluginTabButton(tabDef);
  tabs.appendChild(btn);

  const panelId = 'rp-' + tabDef.id;
  if (!document.getElementById(panelId) && content) {
    content.appendChild(createPluginTabPanel(tabDef));
  }

  updateScrollIndicators();
}

function updateScrollIndicators() {
  if (!tabs) return;
  const bar = document.getElementById('right-panel-tab-bar');
  if (!bar) return;
  bar.classList.toggle('can-scroll-left', tabs.scrollLeft > 2);
  bar.classList.toggle('can-scroll-right', tabs.scrollLeft < tabs.scrollWidth - tabs.clientWidth - 2);
}

// ============================================================
// Tab Search
// ============================================================
function showTabSearch() {
  closeMoreDropdown();
  const existing = document.getElementById('rp-tab-search-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.className = 'rp-tab-search-overlay';
  overlay.id = 'rp-tab-search-overlay';
  overlay.innerHTML = [
    '<input type="text" class="rp-tab-search-input" id="rp-tab-search-input" placeholder="🔍 搜索Tab名称..." autofocus />',
    '<div class="rp-tab-search-results" id="rp-tab-search-results"></div>',
  ].join('');

  const bar = document.getElementById('right-panel-tab-bar');
  if (bar) bar.appendChild(overlay);

  const input = document.getElementById('rp-tab-search-input');
  if (input) {
    setTimeout(function() { input.focus(); }, 50);
    input.addEventListener('input', function() { filterTabSearch(this.value); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { closeTabSearch(); return; }
      if (e.key === 'Enter') {
        const hl = overlay.querySelector('.rp-tab-search-item.highlighted');
        if (hl && hl.dataset.tabId) { switchTab(hl.dataset.tabId); closeTabSearch(); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = overlay.querySelectorAll('.rp-tab-search-item');
        let idx = -1;
        items.forEach(function(item, i) { if (item.classList.contains('highlighted')) idx = i; });
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items.forEach(function(item) { item.classList.remove('highlighted'); });
        if (items[idx]) { items[idx].classList.add('highlighted'); items[idx].scrollIntoView({ block: 'nearest' }); }
      }
    });
  }

  filterTabSearch('');
}

function closeTabSearch() {
  const overlay = document.getElementById('rp-tab-search-overlay');
  if (overlay) overlay.remove();
}

function filterTabSearch(query) {
  const results = document.getElementById('rp-tab-search-results');
  if (!results) return;
  const q = (query || '').toLowerCase().trim();

  const UIR = Q.UIRegistry;
  if (!UIR) { results.innerHTML = '<div class="rp-tab-search-empty">UIRegistry 未就绪</div>'; return; }

  const allTabs = UIR.getTabs();
  const filtered = q ? allTabs.filter(function(t) {
    return t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
  }) : allTabs.slice(0, 20);

  if (filtered.length === 0) {
    results.innerHTML = '<div class="rp-tab-search-empty">未找到匹配的Tab</div>';
    return;
  }

  results.innerHTML = filtered.map(function(tab, i) {
    const catDef = Q.UIRegistry && Q.UIRegistry.getCategoryInfo ? Q.UIRegistry.getCategoryInfo(tab.category) : { label: '其他' };
    return '<div class="rp-tab-search-item' + (i === 0 ? ' highlighted' : '') + '" data-tab-id="' + tab.id + '">'
      + '<span class="rtsi-icon">' + tab.icon + '</span>'
      + '<span>' + tab.label + '</span>'
      + '<span class="rtsi-category">' + catDef.label + '</span>'
      + '</div>';
  }).join('');

  results.querySelectorAll('.rp-tab-search-item').forEach(function(item) {
    item.addEventListener('click', function() { switchTab(this.dataset.tabId); closeTabSearch(); });
  });
}

// ============================================================
// Tab More Dropdown
// ============================================================
function toggleMoreDropdown() {
  const existing = document.getElementById('rp-tab-more-dropdown');
  if (existing) { existing.remove(); return; }

  const dropdown = document.createElement('div');
  dropdown.className = 'rp-tab-more-dropdown';
  dropdown.id = 'rp-tab-more-dropdown';

  const UIR = Q.UIRegistry;
  if (!UIR) return;

  const groups = UIR.getTabsByCategory();
  let html = '';
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.tabs.length === 0) continue;
    html += '<div class="rp-tab-more-category">' + group.icon + ' ' + group.label + '</div>';
    for (let t = 0; t < group.tabs.length; t++) {
      const tab = group.tabs[t];
      const isActive = tab.id === RightPanel.activeTab;
      html += '<div class="rp-tab-more-item' + (isActive ? ' active' : '') + '" data-tab-id="' + tab.id + '">'
        + '<span class="rtmi-icon">' + tab.icon + '</span>'
        + '<span>' + tab.label + '</span>'
        + '<button class="rtmi-hide" title="隐藏此Tab">✕</button>'
        + '</div>';
    }
  }

  // Tab manager entry
  html += '<div style="border-top:1px solid var(--border-subtle);margin-top:4px;padding-top:4px;">'
    + '<div class="rp-tab-more-item" data-action="tab-manager">'
    + '<span class="rtmi-icon">⚙️</span><span>管理Tab...</span>'
    + '</div></div>';

  dropdown.innerHTML = html;

  const moreBtn = document.getElementById('rp-tab-more-btn');
  if (moreBtn) {
    moreBtn.parentElement.style.position = 'relative';
    moreBtn.parentElement.appendChild(dropdown);
  }

  // Wire up items
  dropdown.querySelectorAll('.rp-tab-more-item[data-tab-id]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('.rtmi-hide')) {
        const tabId = this.dataset.tabId;
        if (UIR) UIR.setTabHidden(tabId, true);
        if (RightPanel.activeTab === tabId) {
          const firstTab = (UIR.getTabs() || [])[0];
          if (firstTab) switchTab(firstTab.id);
        }
        renderAllTabs();
        dropdown.remove();
        return;
      }
      switchTab(this.dataset.tabId);
      dropdown.remove();
    });
  });

  const mgrItem = dropdown.querySelector('[data-action="tab-manager"]');
  if (mgrItem) {
    mgrItem.addEventListener('click', function() { dropdown.remove(); showTabManager(); });
  }
}

function closeMoreDropdown() {
  const dropdown = document.getElementById('rp-tab-more-dropdown');
  if (dropdown) dropdown.remove();
}

// ============================================================
// Tab Management Panel
// ============================================================
function showTabManager() {
  const existing = document.getElementById('rp-tab-manager');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'rp-tab-manager';
  panel.className = 'rp-tab-manager';
  panel.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:30;background:var(--bg-elevated);overflow-y:auto;';

  const UIR = Q.UIRegistry;
  const allTabs = UIR ? UIR.getAllTabs() : [];

  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:12px 14px 0;">'
    + '<h3 style="flex:1;margin:0;font-size:14px;">⚙️ Tab 管理</h3>'
    + '<button id="rp-tm-close" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:16px;padding:4px;">✕</button>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px;padding:0 14px;">显示/隐藏右侧栏中的Tab（隐藏的Tab仍可通过搜索访问）</div>';

  const groups = {};
  for (let i = 0; i < allTabs.length; i++) {
    const tab = allTabs[i];
    const cat = tab.category || 'other';
    if (!groups[cat]) {
      const catDef = Q.UIRegistry && Q.UIRegistry.getCategoryInfo ? Q.UIRegistry.getCategoryInfo(cat) : { label: '其他', icon: '📦' };
      groups[cat] = { label: catDef.label, icon: catDef.icon, tabs: [] };
    }
    groups[cat].tabs.push(tab);
  }

  const catKeys = Object.keys(groups);
  for (let ci = 0; ci < catKeys.length; ci++) {
    const g = groups[catKeys[ci]];
    html += '<div style="font-size:11px;font-weight:600;color:var(--text-tertiary);padding:6px 14px 2px;">' + g.icon + ' ' + g.label + '</div>';
    for (let j = 0; j < g.tabs.length; j++) {
      const t2 = g.tabs[j];
      const hidden = t2.hidden;
      html += '<div class="rp-tm-item" style="padding:4px 14px;">'
        + '<button class="rp-tm-toggle ' + (hidden ? 'off' : 'on') + '" data-tab-id="' + t2.id + '"></button>'
        + '<span>' + t2.icon + ' ' + t2.label + '</span>'
        + '</div>';
    }
  }

  panel.innerHTML = html;
  if (content) {
    content.style.position = 'relative';
    content.appendChild(panel);
  }

  document.getElementById('rp-tm-close').addEventListener('click', function() { panel.remove(); });

  panel.querySelectorAll('.rp-tm-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const tabId = this.dataset.tabId;
      const isHidden = this.classList.contains('off');
      if (UIR) {
        UIR.setTabHidden(tabId, !isHidden);
        this.className = 'rp-tm-toggle ' + (isHidden ? 'on' : 'off');
      }
      renderAllTabs();
      if (!isHidden && RightPanel.activeTab === tabId) {
        const firstTab = UIR ? UIR.getTabs()[0] : null;
        if (firstTab) switchTab(firstTab.id);
      }
    });
  });
}

// ============================================================
// Collapsible Section Helper
// ============================================================
/**
 * Create HTML for a collapsible section.
 * @param {object} opts
 * @param {string} opts.icon — section icon
 * @param {string} opts.title — section title
 * @param {string} opts.content — HTML content
 * @param {boolean} [opts.defaultOpen] — default expanded state
 * @returns {string} HTML
 */
function createCollapsibleSection(opts) {
  const isOpen = opts.defaultOpen !== false;
  return [
    '<div class="rp-collapsible' + (isOpen ? ' open' : '') + '">',
    '<div class="rp-collapsible-header">',
    '<span class="rpc-icon">' + (opts.icon || '📋') + '</span>',
    '<span>' + (opts.title || '') + '</span>',
    '<span class="rpc-arrow">▸</span>',
    '</div>',
    '<div class="rp-collapsible-body">',
    '<div class="rp-collapsible-body-inner">',
    opts.content || '',
    '</div></div></div>',
  ].join('');
}

// ============================================================
// Resize Handle
// ============================================================
function startResize(e) {
  e.preventDefault();
  isResizing = true;
  el.classList.add('dragging');
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
}

function onResize(e) {
  if (!isResizing) return;
  if (resizeRAF) return;
  resizeRAF = requestAnimationFrame(function() {
    resizeRAF = null;
    const vw = window.innerWidth;
    let w = vw - e.clientX;
    if (w < MIN_WIDTH) w = MIN_WIDTH;
    if (w > MAX_WIDTH) w = MAX_WIDTH;
    RightPanel.width = w;
    applyWidth(w);
  });
}

function stopResize() {
  if (!isResizing) return;
  isResizing = false;
  if (resizeRAF) { cancelAnimationFrame(resizeRAF); resizeRAF = null; }
  el.classList.remove('dragging');
  resizeHandle.classList.remove('active');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  saveWidth(RightPanel.width);
  requestAnimationFrame(triggerTerminalFit);
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
}

function applyWidth(width) {
  document.documentElement.style.setProperty('--right-panel-width', width + 'px');
  el.style.width = '';
  el.style.minWidth = '';
}

// ============================================================
// Plugin Tab Button/Panel 工厂
// ============================================================
/**
 * Create horizontal tab button.
 * @param {object} tabDef
 * @returns {HTMLButtonElement}
 */
function createPluginTabButton(tabDef) {
  const btn = document.createElement('button');
  btn.className = 'right-tab' + (tabDef.id === RightPanel.activeTab ? ' active' : '');
  btn.dataset.panel = tabDef.id;
  btn.title = tabDef.label;
  btn.innerHTML = '<span class="right-tab-icon">' + tabDef.icon + '</span><span class="right-tab-label">' + tabDef.label + '</span>';
  return btn;
}

/**
 * Create a panel container for a tab.
 * @param {object} tabDef
 * @returns {HTMLDivElement}
 */
function createPluginTabPanel(tabDef) {
  const panel = document.createElement('div');
  panel.className = 'rp-panel';
  panel.id = 'rp-' + tabDef.id;
  return panel;
}

// ============================================================
// Terminal Re-fit Helper
// ============================================================
function triggerTerminalFit() {
  try {
    const fitAddon = window.QCLI?.Tabs?.fitAddon;
    const st = window.QCLI?.state;
    if (fitAddon) {
      fitAddon.fit();
      if (st && st.launched) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          const wsSend = window.QCLI?.wsSend;
          if (wsSend) {
            wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: window.QCLI?.Tabs?.activeTabId });
          }
        }
      }
    }
  } catch (e) { console.debug('[RightPanel] terminal fit error:', e?.message); }
}

// ============================================================
// Exports
// ============================================================
export { RightPanel };
Q.RightPanel = RightPanel;

// ============================================================
// Auto-init on DOM ready
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
