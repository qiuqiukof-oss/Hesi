// @ts-check
// ============================================================
// PluginLoader — 插件加载器
//
// 扫描 plugins/ 目录，加载每个插件的 plugin.json 清单，
// 验证后将插件的功能注册到 Hesi 的各个子系统中。
//
// 支持的注册目标：
//   - CLIs      → cli-registry.json
//   - Workflows → 内存工作流列表（通过路由暴露）
//   - AI Tools  → routes/ai-tools/registry.js 的 ToolRegistry
//   - Routes    → Express 应用
//   - Presets   → cli-presets/ 目录
//   - MCP       → 外部 MCP Server 进程管理
//
// 清单校验见 ./plugin-loader/validation.js，各能力注册逻辑见
// ./plugin-loader/registrars.js；本文件只负责状态、生命周期与查询。
// ============================================================
const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

const { validateManifest, resolveHandler } = require('./plugin-loader/validation');
const Registrars = require('./plugin-loader/registrars');

// ──────────────────────────────────────────────
// PluginLoader 类
// ──────────────────────────────────────────────

class PluginLoader {
  /**
   * @param {object} [opts]
   * @param {object} [opts.cliRegistry]        - 用于注入 CLI entry 的回调: { addCLI(entry) }
   * @param {Array}  [opts.workflowList]        - 外部工作流列表引用（push 新 workflow）
   * @param {object} [opts.toolRegistry]        - routes/ai-tools/registry.js 的 ToolRegistry 实例
   * @param {object} [opts.expressApp]          - Express 应用实例（用于挂载路由）
   * @param {object} [opts.presetLoader]        - preset-loader 模块引用
   * @param {Function} [opts.onPluginEvent]     - (eventName: string, data: object) => void
   */
  constructor(opts = {}) {
    this._pluginsDir = PLUGINS_DIR;
    /** @type {Map<string, LoadedPlugin>} */
    this._plugins = new Map();
    /** @type {Map<string, {enabled: boolean}>} — 持久化的插件启用/禁用状态 */
    this._pluginStates = new Map();
    this._opts = opts;

    // 加载持久化的插件状态
    this._loadPluginStates();

    // 验证必需依赖
    if (!opts.workflowList) {
      this._workflowList = []; // 备用列表
    } else {
      this._workflowList = opts.workflowList;
    }
  }

  /**
   * 加载持久化的插件启用/禁用状态。
   * 状态存储在 plugins/.plugin-states.json 中。
   */
  _loadPluginStates() {
    try {
      const statePath = path.join(this._pluginsDir, '.plugin-states.json');
      if (fs.existsSync(statePath)) {
        const raw = fs.readFileSync(statePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          for (const [name, state] of Object.entries(data)) {
            this._pluginStates.set(name, { enabled: state.enabled !== false });
          }
        }
      }
    } catch (e) {
      // 状态文件损坏时忽略，使用默认（全部启用）
    }
  }

  /**
   * 持久化插件启用/禁用状态。
   */
  _savePluginStates() {
    try {
      const statePath = path.join(this._pluginsDir, '.plugin-states.json');
      const data = {};
      for (const [name, state] of this._pluginStates) {
        data[name] = { enabled: state.enabled };
      }
      if (!fs.existsSync(this._pluginsDir)) {
        fs.mkdirSync(this._pluginsDir, { recursive: true });
      }
      fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[PluginLoader] Failed to save plugin states:', e.message);
    }
  }

  /**
   * 检查插件是否启用（未设置状态时默认启用）。
   * @param {string} name
   * @returns {boolean}
   */
  isPluginEnabled(name) {
    const state = this._pluginStates.get(name);
    return state ? state.enabled : true;
  }

  /**
   * 启用或禁用插件。
   * 禁用会卸载插件及其注册的所有资源。
   * @param {string} name
   * @param {boolean} enabled
   * @returns {{ success: boolean, error?: string }}
   */
  setPluginEnabled(name, enabled) {
    const state = this._pluginStates.get(name) || { enabled: true };
    state.enabled = enabled;
    this._pluginStates.set(name, state);
    this._savePluginStates();

    if (!enabled) {
      // 禁用：卸载插件
      this.unloadPlugin(name);
    } else {
      // 启用：加载插件
      const pluginDir = path.join(this._pluginsDir, name);
      const manifestPath = path.join(pluginDir, 'plugin.json');
      if (fs.existsSync(manifestPath)) {
        this._clearRequireCache(pluginDir);
        const result = this._loadSingle(pluginDir, manifestPath, name);
        if (!result.success) {
          return { success: false, error: result.error };
        }
      }
    }
    return { success: true };
  }

  // ────────────────────────────────────────────
  // 扫描与加载
  // ────────────────────────────────────────────

  /**
   * 扫描 plugins/ 目录并加载所有插件。
   * @param {object} [scanOpts]
   * @param {boolean} [scanOpts.reload=false]  — 是否重载已加载的插件
   * @returns {{ loaded: string[], errors: Array<{plugin: string, error: string}> }}
   */
  scanAndLoad(scanOpts = {}) {
    const loaded = [];
    const errors = [];

    // 确保 plugins 目录存在
    if (!fs.existsSync(this._pluginsDir)) {
      console.log('[PluginLoader] No plugins directory found, skipping');
      return { loaded, errors };
    }

    let entries;
    try {
      entries = fs.readdirSync(this._pluginsDir, { withFileTypes: true });
    } catch (err) {
      console.error('[PluginLoader] Failed to read plugins directory:', err.message);
      return { loaded, errors };
    }

    const dirs = entries.filter(e => e.isDirectory());

    for (const dir of dirs) {
      const pluginDir = path.join(this._pluginsDir, dir.name);
      const manifestPath = path.join(pluginDir, 'plugin.json');

      if (!fs.existsSync(manifestPath)) {
        console.warn(`[PluginLoader] Skipping "${dir.name}": no plugin.json found`);
        continue;
      }

      // 检查插件是否被禁用
      if (!this.isPluginEnabled(dir.name)) {
        console.log(`[PluginLoader] Skipping "${dir.name}": disabled by user`);
        continue;
      }

      // Check if already loaded and not reloading
      if (this._plugins.has(dir.name) && !scanOpts.reload) {
        continue;
      }

      try {
        const result = this._loadSingle(pluginDir, manifestPath, dir.name);
        if (result.success) {
          loaded.push(dir.name);
        } else {
          errors.push({ plugin: dir.name, error: result.error });
        }
      } catch (err) {
        errors.push({ plugin: dir.name, error: err.message });
      }
    }

    if (loaded.length > 0) {
      console.log(`[PluginLoader] Loaded ${loaded.length} plugin(s): ${loaded.join(', ')}`);
    }
    if (errors.length > 0) {
      console.error(`[PluginLoader] ${errors.length} plugin(s) failed to load`);
    }

    return { loaded, errors };
  }

  /**
   * 加载单个插件。
   */
  _loadSingle(pluginDir, manifestPath, pluginName) {
    // 1. 读取清单
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    // 2. 验证
    const validation = validateManifest(manifest, pluginDir);
    if (!validation.valid) {
      return { success: false, error: `Validation failed: ${validation.errors.join('; ')}` };
    }

    // 如果已加载，先卸载
    if (this._plugins.has(pluginName)) {
      this._unloadSingle(pluginName);
    }

    // 3. 构建插件对象
    /** @type {LoadedPlugin} */
    const plugin = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || '',
      author: manifest.author || '',
      manifest,
      dir: pluginDir,
      loadedAt: Date.now(),
      resources: {
        cliIds: [],
        workflowIds: [],
        aiToolNames: [],
        routePaths: [],
        mcpServerNames: [],
        cleanupFns: [],
      },
    };

    // 4. 注册各个功能
    Registrars.registerCLIs(this, plugin, manifest.clis);
    Registrars.registerWorkflows(this, plugin, manifest.workflows);
    Registrars.registerAITools(this, plugin, manifest.aiTools, pluginDir);
    Registrars.registerRoutes(this, plugin, manifest.routes, pluginDir);
    Registrars.registerPresets(this, plugin, manifest.presets);
    Registrars.registerMCPServers(this, plugin, manifest.mcpServers);

    // 5. 执行 onLoad 生命周期钩子
    if (manifest.lifecycle && manifest.lifecycle.onLoad) {
      this._runLifecycleHook(pluginDir, manifest.lifecycle.onLoad, plugin, 'onLoad');
    }

    // 6. 存储
    this._plugins.set(pluginName, plugin);

    // 7. 通知事件
    this._emitEvent('plugin:loaded', {
      name: plugin.name,
      version: plugin.version,
      capabilities: Object.keys(manifest).filter(k => Array.isArray(manifest[k]) && manifest[k].length > 0),
    });

    return { success: true };
  }

  /**
   * 卸载单个插件。
   */
  _unloadSingle(pluginName) {
    const plugin = this._plugins.get(pluginName);
    if (!plugin) return;

    // 执行 onUnload 生命周期钩子
    if (plugin.manifest.lifecycle && plugin.manifest.lifecycle.onUnload) {
      this._runLifecycleHook(plugin.dir, plugin.manifest.lifecycle.onUnload, plugin, 'onUnload');
    }

    // 执行所有清理函数
    for (const fn of plugin.resources.cleanupFns) {
      try { fn(); } catch (e) { console.error('[PluginLoader] Cleanup error:', e); }
    }

    this._plugins.delete(pluginName);
    console.log(`[PluginLoader] Unloaded plugin: ${pluginName}`);
  }

  // ────────────────────────────────────────────
  // 生命周期钩子
  // ────────────────────────────────────────────

  /**
   * 执行生命周期钩子。
   */
  _runLifecycleHook(pluginDir, hookPath, plugin, hookName) {
    try {
      const fullPath = resolveHandler(pluginDir, hookPath);
      const hookMod = require(fullPath);
      if (typeof hookMod === 'function') {
        const result = hookMod({
          plugin,
          manifest: plugin.manifest,
          pluginLoader: this,
        });
        if (result && typeof result.then === 'function') {
          result.catch(err => {
            console.error(`[PluginLoader] ${hookName} hook error in "${plugin.name}":`, err);
          });
        }
      }
    } catch (err) {
      console.error(`[PluginLoader] ${hookName} hook failed for "${plugin.name}":`, err.message);
    }
  }

  // ────────────────────────────────────────────
  // 事件通知
  // ────────────────────────────────────────────

  _emitEvent(name, data) {
    if (this._opts.onPluginEvent) {
      try { this._opts.onPluginEvent(name, data); } catch (e) { console.warn('[PluginLoader] event handler error:', e?.message); }
    }
  }

  // ────────────────────────────────────────────
  // 查询 API
  // ────────────────────────────────────────────

  /**
   * 获取所有已加载的插件列表。
   * @returns {Array<{name: string, version: string, description: string, author: string, capabilities: string[], loadedAt: number, enabled: boolean}>}
   */
  listPlugins() {
    const list = [];
    for (const [, plugin] of this._plugins) {
      const capabilities = [];
      if (plugin.resources.cliIds.length > 0) capabilities.push('clis');
      if (plugin.resources.workflowIds.length > 0) capabilities.push('workflows');
      if (plugin.resources.aiToolNames.length > 0) capabilities.push('aiTools');
      if (plugin.resources.routePaths.length > 0) capabilities.push('routes');
      if (plugin.resources.mcpServerNames.length > 0) capabilities.push('mcpServers');
      if (plugin.manifest.presets && plugin.manifest.presets.length > 0) capabilities.push('presets');

      list.push({
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        capabilities,
        loadedAt: plugin.loadedAt,
        enabled: this.isPluginEnabled(plugin.name),
      });
    }
    return list;
  }

  /**
   * 获取 plugins/ 目录下所有插件的完整列表（包含已禁用/未加载的）。
   * @returns {Array<{name: string, dirName: string, version: string|null, description: string|null, enabled: boolean, loaded: boolean, hasManifest: boolean, error?: string}>}
   */
  listAllPlugins() {
    const result = [];
    if (!fs.existsSync(this._pluginsDir)) return result;

    try {
      const entries = fs.readdirSync(this._pluginsDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

      for (const dir of dirs) {
        const manifestPath = path.join(this._pluginsDir, dir.name, 'plugin.json');
        const hasManifest = fs.existsSync(manifestPath);
        let version = null;
        let description = null;
        let pluginName = null;
        const capabilities = [];

        if (hasManifest) {
          try {
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(raw);
            pluginName = manifest.name;
            version = manifest.version;
            description = manifest.description;
            for (const key of ['clis', 'workflows', 'aiTools', 'routes', 'presets', 'mcpServers']) {
              if (Array.isArray(manifest[key]) && manifest[key].length > 0) {
                capabilities.push(key);
              }
            }
          } catch (e) {
            // manifest parse error
          }
        }

        const loaded = this._plugins.has(dir.name);
        const enabled = this.isPluginEnabled(dir.name);

        result.push({
          name: pluginName || dir.name,
          dirName: dir.name,
          version,
          description,
          enabled,
          loaded,
          hasManifest,
          capabilities,
        });
      }
    } catch (e) {
      console.error('[PluginLoader] Failed to list all plugins:', e.message);
    }

    return result;
  }

  /**
   * 获取单个插件详情。
   * @param {string} name
   * @returns {object|null}
   */
  getPlugin(name) {
    // Try direct lookup first (by directory name / internal key)
    const plugin = this._plugins.get(name);
    if (plugin) {
      return this._formatPluginDetail(plugin);
    }
    // Fallback: try by manifest name (e.g. dir "netforge-plugin" → manifest name "netforge")
    for (const [, p] of this._plugins) {
      if (p.name === name) {
        return this._formatPluginDetail(p);
      }
    }
    return null;
  }

  /**
   * Format a loaded plugin into a detail object (shared by getPlugin and other queries).
   */
  _formatPluginDetail(plugin) {
    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      manifest: plugin.manifest,
      loadedAt: plugin.loadedAt,
      resources: plugin.resources,
    };
  }

  /**
   * 重载单个插件。
   * @param {string} name
   * @returns {{ success: boolean, error?: string }}
   */
  reloadPlugin(name) {
    const pluginDir = path.join(this._pluginsDir, name);
    const manifestPath = path.join(pluginDir, 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: `Plugin "${name}" not found` };
    }

    // 清除 require 缓存（模块热替换）
    this._clearRequireCache(pluginDir);

    try {
      const result = this._loadSingle(pluginDir, manifestPath, name);
      if (result.success) {
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 卸载插件。
   * @param {string} name
   * @returns {{ success: boolean, error?: string }}
   */
  unloadPlugin(name) {
    if (!this._plugins.has(name)) {
      return { success: false, error: `Plugin "${name}" not loaded` };
    }
    this._unloadSingle(name);
    return { success: true };
  }

  /**
   * 删除插件并清理状态。
   * @param {string} name
   */
  removePluginState(name) {
    const statePath = path.join(this._pluginsDir, '.plugin-states.json');
    // 从内存中移除
    this._pluginStates.delete(name);
    // 从磁盘中移除
    try {
      if (fs.existsSync(statePath)) {
        const raw = fs.readFileSync(statePath, 'utf-8');
        const data = JSON.parse(raw);
        delete data[name];
        fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
      }
    } catch (e) {
      console.warn('[PluginLoader] Failed to remove plugin state:', e.message);
    }
  }

  /**
   * 从脚手架创建并加载一个插件。
   * @param {string} dirName — 插件目录名
   * @returns {{ success: boolean, error?: string }}
   */
  createPluginFromScaffold(dirName) {
    const pluginDir = path.join(this._pluginsDir, dirName);
    const manifestPath = path.join(pluginDir, 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      return { success: false, error: `Plugin directory not found: ${  dirName}` };
    }

    this._clearRequireCache(pluginDir);

    try {
      const result = this._loadSingle(pluginDir, manifestPath, dirName);
      if (result.success) {
        this._pluginStates.set(dirName, { enabled: true });
        this._savePluginStates();
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 清除插件目录下的所有 require 缓存。
   */
  _clearRequireCache(pluginDir) {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(pluginDir)) {
        delete require.cache[key];
      }
    }
  }

  /**
   * 获取插件工作流列表（合并内置 + 插件）。
   */
  getWorkflows() {
    return this._workflowList;
  }

  /**
   * 已加载插件数量。
   */
  get size() {
    return this._plugins.size;
  }
}

module.exports = { PluginLoader };

/**
 * @typedef {object} LoadedPlugin
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {string} author
 * @property {object} manifest
 * @property {string} dir
 * @property {number} loadedAt
 * @property {{ cliIds: string[], workflowIds: string[], aiToolNames: string[], routePaths: string[], mcpServerNames: string[], cleanupFns: Function[] }} resources
 */
