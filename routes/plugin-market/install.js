/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plugin Market — install / uninstall routes
//
// POST   /api/plugins/market/install
// GET    /api/plugins/market/installed
// DELETE /api/plugins/market/installed/:name
// ============================================================
const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const {
  PLUGINS_DIR,
  checkGit,
  parseRepoUrl,
  fetchPluginJson,
  gitClonePlugin,
  listInstalledPlugins,
} = require('./helpers');

/**
 * Create the install sub-router for the plugin market.
 * @param {object} opts
 * @param {object} [opts.pluginLoader] — PluginLoader 实例（安装后自动加载）
 * @param {Function} [opts.broadcastFn] — WebSocket 广播函数，用于推送安装进度
 * @returns {import('express').Router}
 */
function createInstallRouter(opts = {}) {
  const router = Router();
  const { pluginLoader, broadcastFn } = opts;

  // ── POST /api/plugins/market/install ──
  // 一键安装：git clone + 加载
  router.post('/plugins/market/install', async (req, res) => {
    const { repo, url, branch } = req.body;

    if (!repo && !url) {
      return res.status(400).json({ error: 'Either "repo" (owner/repo) or "url" is required' });
    }

    if (!checkGit()) {
      return res.status(500).json({ error: 'Git is not available on this system' });
    }

    let repoStr = repo;
    let targetDir;

    // 如果是 URL 格式，提取 repo
    if (url) {
      const parsed = parseRepoUrl(url);
      if (!parsed) {
        return res.status(400).json({ error: `Could not parse GitHub URL: ${url}` });
      }
      repoStr = parsed.full;
    }

    // 验证 repo 格式
    if (!repoStr || !repoStr.includes('/')) {
      return res.status(400).json({ error: 'Invalid repo format. Use "owner/repo" or provide a full GitHub URL' });
    }

    // Step 1: 先尝试获取 plugin.json 以确定目标目录名
    let manifest;
    let effectiveBranch = branch || 'main';
    try {
      const fetched = await fetchPluginJson(repoStr, effectiveBranch);
      manifest = fetched.json;
      effectiveBranch = fetched.branch;
      targetDir = manifest.name || repoStr.split('/')[1];
    } catch (err) {
      // 获取 plugin.json 失败，用仓库名作为目录名
      targetDir = repoStr.split('/')[1];
      manifest = null;
    }

    // Step 2: git clone（带实时进度推送）
    let destPath;
    try {
      const cloneUrl = url || repoStr;
      destPath = await gitClonePlugin(cloneUrl, targetDir, effectiveBranch, broadcastFn);
    } catch (err) {
      return res.status(500).json({ error: `Installation failed: ${err.message}` });
    }

    // Step 3: 验证 clone 后的 plugin.json
    if (broadcastFn) {
      broadcastFn({
        type: 'plugin_install_progress',
        repo: repoStr,
        phase: 'validating',
        message: '验证插件清单...',
        progress: 96,
        targetDir,
      });
    }

    const manifestPath = path.join(destPath, 'plugin.json');
    let clonedManifest = null;
    if (fs.existsSync(manifestPath)) {
      try {
        clonedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (e) {
        // 解析失败
      }
    }

    if (!clonedManifest) {
      // plugin.json 不存在或无效，回滚删除
      try {
        fs.rmSync(destPath, { recursive: true, force: true });
      } catch (e) { console.warn('[PluginMarket] rollback on invalid manifest:', e?.message); }
      if (broadcastFn) {
        broadcastFn({
          type: 'plugin_install_progress',
          repo: repoStr,
          phase: 'error',
          message: `插件 "${targetDir}" 不包含有效的 plugin.json，已回滚删除`,
          progress: 0,
          targetDir,
        });
      }
      return res.status(400).json({
        error: `Plugin "${targetDir}" does not contain a valid plugin.json. Directory has been removed.`,
      });
    }

    // Step 4: 尝试加载插件
    if (broadcastFn) {
      broadcastFn({
        type: 'plugin_install_progress',
        repo: repoStr,
        phase: 'loading',
        message: '正在加载插件...',
        progress: 98,
        targetDir,
      });
    }

    let loadResult = null;
    if (pluginLoader) {
      try {
        const result = pluginLoader.scanAndLoad({ reload: false });
        const loaded = result.loaded.includes(targetDir) || result.loaded.includes(clonedManifest.name);
        const errEntry = result.errors.find(e => e.plugin === targetDir || e.plugin === clonedManifest.name);
        loadResult = {
          success: loaded,
          error: errEntry ? errEntry.error : null,
        };
      } catch (err) {
        loadResult = { success: false, error: err.message };
      }
    }

    const success = loadResult?.success !== false;

    // 发送完成事件
    if (broadcastFn) {
      broadcastFn({
        type: 'plugin_install_progress',
        repo: repoStr,
        phase: success ? 'complete' : 'load_error',
        message: success
          ? `插件 "${clonedManifest.name}" 安装成功`
          : `插件已克隆但加载失败: ${loadResult?.error || '未知错误'}`,
        progress: 100,
        targetDir,
        pluginName: clonedManifest.name,
        success,
      });

      // ── 广播 plugin_installed 事件，通知所有客户端自动刷新 ──
      if (success) {
        broadcastFn({
          type: 'plugin_installed',
          plugin: {
            name: clonedManifest.name,
            version: clonedManifest.version || '0.0.0',
            description: clonedManifest.description || '',
          },
          repo: repoStr,
          targetDir,
          success: true,
        });
      }
    }

    res.json({
      success: true,
      plugin: {
        name: clonedManifest.name,
        version: clonedManifest.version,
        description: clonedManifest.description || '',
        author: clonedManifest.author || '',
        repo: repoStr,
        branch: effectiveBranch,
        path: targetDir,
        manifest: clonedManifest,
      },
      loadResult,
      message: loadResult?.success
        ? `Plugin "${clonedManifest.name}" installed and loaded successfully`
        : `Plugin cloned to plugins/${targetDir}/ but could not be loaded: ${loadResult?.error || 'unknown error'}`,
    });
  });

  // ── GET /api/plugins/market/installed ──
  // 列出所有已安装的插件（含未加载的）
  router.get('/plugins/market/installed', (req, res) => {
    const installed = listInstalledPlugins();

    // 标记加载状态
    const loadedNames = pluginLoader
      ? new Set(pluginLoader.listPlugins().map(p => p.name))
      : new Set();

    const items = installed.map(p => ({
      ...p,
      loaded: loadedNames.has(p.name) || loadedNames.has(p.manifest?.name),
    }));

    res.json({ plugins: items, total: items.length });
  });

  // ── DELETE /api/plugins/market/installed/:name ──
  // 卸载并删除插件目录
  router.delete('/plugins/market/installed/:name', (req, res) => {
    const name = req.params.name;
    const pluginDir = path.join(PLUGINS_DIR, name);

    if (!fs.existsSync(pluginDir)) {
      return res.status(404).json({ error: `Plugin "${name}" not found in plugins/` });
    }

    // 先卸载（如果已加载）
    let resolvedName = name;
    if (pluginLoader) {
      try {
        // 尝试用 manifest name 解析
        const manifestPathLocal = path.join(pluginDir, 'plugin.json');
        if (fs.existsSync(manifestPathLocal)) {
          try {
            const manifestLocal = JSON.parse(fs.readFileSync(manifestPathLocal, 'utf-8'));
            if (manifestLocal.name && manifestLocal.name !== name) {
              resolvedName = manifestLocal.name;
              pluginLoader.unloadPlugin(manifestLocal.name);
            }
          } catch (e) { console.warn('[PluginMarket] parse manifest for delete:', e?.message); }
        }
        // 用目录名卸载
        pluginLoader.unloadPlugin(name);

        // 清理持久化的插件状态（避免残留）
        if (pluginLoader.removePluginState && typeof pluginLoader.removePluginState === 'function') {
          pluginLoader.removePluginState(resolvedName);
        }
      } catch (err) {
        console.warn(`[PluginMarket] Unload warning for "${name}":`, err.message);
      }
    }

    // 也清理目录名对应的状态
    if (pluginLoader && pluginLoader.removePluginState && resolvedName !== name) {
      try { pluginLoader.removePluginState(name); } catch (e) { console.warn('[PluginMarket] cleanup state:', e?.message); }
    }

    // 检查是否是 git 仓库 — git 仓库有 .git 目录
    const isGitRepo = fs.existsSync(path.join(pluginDir, '.git'));

    // 删除目录
    try {
      // 在 Windows 上 git 仓库可能有只读文件，需要先 chmod
      if (isGitRepo) {
        // 移除 .git 的只读属性（Windows 兼容）
        try {
          const gitDir = path.join(pluginDir, '.git');
          if (fs.existsSync(gitDir)) {
            fs.rmSync(gitDir, { recursive: true, force: true });
          }
        } catch (e) { console.warn('[PluginMarket] cleanup .git dir:', e?.message); }
      }

      fs.rmSync(pluginDir, { recursive: true, force: true });
      res.json({
        success: true,
        message: `Plugin "${name}" uninstalled and directory removed`,
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to remove plugin directory: ${err.message}` });
    }
  });

  return router;
}

module.exports = { createInstallRouter };
