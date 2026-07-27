// ============================================================
// UIRegistry — Frontend component registry for plugins
//
// Allows plugins to dynamically register UI elements:
//   - Right panel tabs (with custom render functions)
//   - Context menu items
//   - Command palette commands
//
// All registered items are stored in memory and queried by
// the existing UI components (right-panel.js, context-menu.js,
// command-palette.js) when rendering.
//
// Usage:
//   const UIR = window.QCLI?.UIRegistry;
//   UIR.registerTab('my-plugin', { icon: '🔌', label: 'My Tab', render: (container) => { ... } });
//   UIR.getTabs()  → [{ id, icon, label, render }, ...]
// ============================================================
// @ts-check

/** @typedef {import('../types').QCLI} QCLI */

class UIRegistry {
  constructor() {
    /** @type {Map<string, TabDef>} */
    this._tabs = new Map();

    /** @type {Map<string, MenuDef>} */
    this._menuItems = new Map();

    /** @type {Map<string, CommandDef>} */
    this._commands = new Map();
  }

  // ──────────────────────────────────────────────
  // Right Panel Tabs
  // ──────────────────────────────────────────────

  /** @type {Function|null} Called when a new tab is registered (for late-binding by right-panel.js) */
  set onTabRegistered(callback) {
    this._onTabRegistered = callback;
  }
  get onTabRegistered() {
    return this._onTabRegistered || null;
  }

  /**
   * 预定义分类显示名及排序。
   */
  static CATEGORIES = {
    monitor: { label: '监控', icon: '📊', order: 10 },
    digital: { label: '数字员工', icon: '👥', order: 20 },
    tools:   { label: '工具',   icon: '🔧', order: 30 },
    finance: { label: '金融',   icon: '💰', order: 40 },
    media:   { label: '媒体',   icon: '🎬', order: 50 },
    plugin:  { label: '插件',   icon: '🔌', order: 60 },
    other:   { label: '其他',   icon: '📦', order: 999 },
  };

  /**
   * Register a right panel tab.
   *
   * @param {string} id       — unique tab ID (e.g. 'my-plugin')
   * @param {object}   def
   * @param {string}   def.icon    — emoji icon (shown in the tab button)
   * @param {string}   def.label   — display label
   * @param {Function} def.render  — (container: HTMLElement) => void, called when tab is first activated
   * @param {number}   [def.order] — insertion order within category (defaults to 100, lower = earlier)
   * @param {string}   [def.category] — category key from CATEGORIES (default 'other')
   * @returns {boolean} true if registered, false if id already exists
   */
  registerTab(id, def) {
    if (this._tabs.has(id)) {
      console.warn(`[UIRegistry] Tab "${id}" already registered`);
      return false;
    }
    const cat = def.category || 'other';
    const tabDef = {
      id,
      icon: def.icon || '🔌',
      label: def.label || id,
      render: def.render,
      order: def.order !== undefined ? def.order : 100,
      category: cat,
      hidden: false,
      _rendered: false,
    };
    this._tabs.set(id, tabDef);
    // Notify late-binding listener (so right-panel.js can create the button + panel dynamically)
    if (this._onTabRegistered) {
      this._onTabRegistered(tabDef);
    }
    return true;
  }

  /**
   * Get all registered tabs, sorted by (category order, tab order).
   * @returns {TabDef[]}
   */
  getTabs() {
    return [...this._tabs.values()]
      .filter(t => !t.hidden)
      .sort((a, b) => {
        const catA = UIRegistry.CATEGORIES[a.category]?.order || 999;
        const catB = UIRegistry.CATEGORIES[b.category]?.order || 999;
        if (catA !== catB) return catA - catB;
        return a.order - b.order;
      });
  }

  /**
   * Get all tabs grouped by category.
   * @returns {Array<{category: string, label: string, icon: string, tabs: TabDef[]}>}
   */
  getTabsByCategory() {
    const all = [...this._tabs.values()].filter(t => !t.hidden);
    const groups = {};
    for (const tab of all) {
      const cat = tab.category || 'other';
      if (!groups[cat]) {
        const catDef = UIRegistry.CATEGORIES[cat] || UIRegistry.CATEGORIES.other;
        groups[cat] = { category: cat, label: catDef.label, icon: catDef.icon, tabs: [] };
      }
      groups[cat].tabs.push(tab);
    }
    // Sort groups by category order, then tabs by order
    return Object.values(groups)
      .sort((a, b) => {
        const oA = UIRegistry.CATEGORIES[a.category]?.order || 999;
        const oB = UIRegistry.CATEGORIES[b.category]?.order || 999;
        return oA - oB;
      })
      .map(g => {
        g.tabs.sort((a, b) => a.order - b.order);
        return g;
      });
  }

  /**
   * Get all registered tabs (including hidden ones).
   * @returns {TabDef[]}
   */
  getAllTabs() {
    return [...this._tabs.values()]
      .sort((a, b) => {
        const catA = UIRegistry.CATEGORIES[a.category]?.order || 999;
        const catB = UIRegistry.CATEGORIES[b.category]?.order || 999;
        if (catA !== catB) return catA - catB;
        return a.order - b.order;
      });
  }

  /**
   * Remove a registered tab.
   * @param {string} id
   */
  unregisterTab(id) {
    this._tabs.delete(id);
  }

  /**
   * Mark a tab as rendered (called by right-panel.js after calling render).
   * @param {string} id
   */
  markTabRendered(id) {
    const tab = this._tabs.get(id);
    if (tab) tab._rendered = true;
  }

  /**
   * Check if a tab has been rendered.
   * @param {string} id
   * @returns {boolean}
   */
  isTabRendered(id) {
    return this._tabs.get(id)?._rendered === true;
  }

  /**
   * 隐藏/显示一个 Tab。
   * @param {string} id
   * @param {boolean} hidden
   */
  setTabHidden(id, hidden) {
    const tab = this._tabs.get(id);
    if (tab) {
      tab.hidden = hidden;
      this._saveHiddenPrefs();
    }
  }

  /**
   * 检查 Tab 是否隐藏。
   * @param {string} id
   * @returns {boolean}
   */
  isTabHidden(id) {
    return this._tabs.get(id)?.hidden === true;
  }

  /**
   * 获取分类信息。
   * @param {string} category
   * @returns {{ label: string, icon: string, order: number }}
   */
  getCategoryInfo(category) {
    return UIRegistry.CATEGORIES[category] || UIRegistry.CATEGORIES.other;
  }

  /**
   * 保存当前注册的Tab为localStorage（供外部引用CATEGORIES）。
   */
  static get CATEGORIES_MAP() { return UIRegistry.CATEGORIES; }

  /**
   * 将隐藏偏好保存到 localStorage。
   */
  _saveHiddenPrefs() {
    try {
      const hidden = [...this._tabs.values()]
        .filter(t => t.hidden)
        .map(t => t.id);
      localStorage.setItem('qcli-hidden-tabs', JSON.stringify(hidden));
    } catch (e) { /* ignore storage errors */ }
  }

  /**
   * 从 localStorage 恢复隐藏偏好。
   */
  restoreHiddenPrefs() {
    try {
      const raw = localStorage.getItem('qcli-hidden-tabs');
      if (!raw) return;
      const hidden = JSON.parse(raw);
      if (Array.isArray(hidden)) {
        for (const id of hidden) {
          const tab = this._tabs.get(id);
          if (tab) tab.hidden = true;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ──────────────────────────────────────────────
  // Context Menu Items
  // ──────────────────────────────────────────────

  /**
   * Register a context menu item.
   *
   * @param {string}   id           — unique item ID
   * @param {object}   def
   * @param {string}   def.label     — display text (e.g. '🔌 Plugin Action')
   * @param {Function} def.action    — (selection: string, terminal: Term) => void
   * @param {boolean}  [def.requiresSelection=false] — if true, item only shows when text is selected
   * @param {number}   [def.order]   — insertion order (default 100)
   * @returns {boolean}
   */
  registerMenuItem(id, def) {
    if (this._menuItems.has(id)) {
      console.warn(`[UIRegistry] Menu item "${id}" already registered`);
      return false;
    }
    this._menuItems.set(id, {
      id,
      label: def.label || id,
      action: def.action,
      requiresSelection: def.requiresSelection === true,
      order: def.order !== undefined ? def.order : 100,
    });
    return true;
  }

  /**
   * Get all registered menu items, sorted by order.
   * @returns {MenuDef[]}
   */
  getMenuItems() {
    return [...this._menuItems.values()].sort((a, b) => a.order - b.order);
  }

  /**
   * Get menu items filtered by whether text is selected.
   * @param {boolean} hasSelection
   * @returns {MenuDef[]}
   */
  getMenuItemsForContext(hasSelection) {
    return this.getMenuItems().filter(
      item => item.requiresSelection === hasSelection || !item.requiresSelection
    );
  }

  /**
   * Remove a registered menu item.
   * @param {string} id
   */
  unregisterMenuItem(id) {
    this._menuItems.delete(id);
  }

  // ──────────────────────────────────────────────
  // Command Palette Commands
  // ──────────────────────────────────────────────

  /**
   * Register a command palette command.
   *
   * @param {string}   id        — unique command ID
   * @param {object}   def
   * @param {string}   def.icon    — emoji icon
   * @param {string}   def.name    — display name (searchable)
   * @param {string}   def.desc    — description
   * @param {Function} def.execute — () => void, called when command is selected
   * @param {number}   [def.order] — insertion order (default 100)
   * @returns {boolean}
   */
  registerCommand(id, def) {
    if (this._commands.has(id)) {
      console.warn(`[UIRegistry] Command "${id}" already registered`);
      return false;
    }
    this._commands.set(id, {
      id,
      icon: def.icon || '🔌',
      name: def.name || id,
      desc: def.desc || '',
      execute: def.execute,
      order: def.order !== undefined ? def.order : 100,
      category: def.category || 'plugin',
    });
    return true;
  }

  /**
   * Get all registered commands, sorted by order.
   * @returns {CommandDef[]}
   */
  getCommands() {
    return [...this._commands.values()].sort((a, b) => a.order - b.order);
  }

  /**
   * Search registered commands by query string.
   * @param {string} query
   * @returns {CommandDef[]}
   */
  searchCommands(query) {
    if (!query) return this.getCommands();
    const q = query.toLowerCase();
    return this.getCommands().filter(cmd =>
      cmd.name.toLowerCase().includes(q) || cmd.desc.toLowerCase().includes(q)
    );
  }

  /**
   * Remove a registered command.
   * @param {string} id
   */
  unregisterCommand(id) {
    this._commands.delete(id);
  }

  // ──────────────────────────────────────────────
  // Bulk operations
  // ──────────────────────────────────────────────

  /**
   * Unregister all items for a given plugin.
   * @param {string} pluginName — the plugin name prefix
   */
  unregisterAll(pluginName) {
    const prefix = pluginName + ':';
    for (const id of this._tabs.keys()) {
      if (id.startsWith(prefix)) this._tabs.delete(id);
    }
    for (const id of this._menuItems.keys()) {
      if (id.startsWith(prefix)) this._menuItems.delete(id);
    }
    for (const id of this._commands.keys()) {
      if (id.startsWith(prefix)) this._commands.delete(id);
    }
  }

  /**
   * Clear all registrations.
   */
  clear() {
    this._tabs.clear();
    this._menuItems.clear();
    this._commands.clear();
  }

  /**
   * Get summary statistics.
   * @returns {{ tabs: number, menuItems: number, commands: number }}
   */
  get stats() {
    return {
      tabs: this._tabs.size,
      menuItems: this._menuItems.size,
      commands: this._commands.size,
    };
  }
}

// ── Singleton on QCLI namespace ──
const Q = /** @type {QCLI} */ (window.QCLI || {});
const instance = new UIRegistry();
Q.UIRegistry = instance;

/**
 * Shared CSS injection utility — used by optional plugin modules to load their
 * own stylesheet dynamically. Deduplicates by href so the same CSS is never
 * injected twice.
 *
 * Usage: Q.injectCSS('/css/stocks.css')
 * @param {string} href
 */
Q.injectCSS = function injectCSS(href) {
  if (!document.querySelector('link[href="' + href + '"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
};

export default UIRegistry;
export { instance as uiRegistry };
