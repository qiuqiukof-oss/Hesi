/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plugin Market — discovery routes
//
// GET  /api/plugins/market
// GET  /api/plugins/sources
// POST /api/plugins/sources
// POST /api/plugins/sources/test
// GET  /api/plugins/plaza/search   (multi-source search)
// GET  /api/plugins/market/search   (GitHub topic search, legacy)
// ============================================================
const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const {
  PLUGINS_DIR,
  MARKET_CACHE_FILE,
  MARKET_CACHE_TTL,
  FEATURED_PLUGINS,
  loadCustomSources,
  saveCustomSources,
  checkGit,
  searchGitHubPlugins,
  searchNpmPlugins,
  fetchCustomSourcePlugins,
  readMarketCache,
  readStaleMarketCache,
  writeMarketCache,
  listInstalledPlugins,
} = require('./helpers');

// Mark whether a plugin directory is present on disk.
function isInstalled(name) {
  return fs.existsSync(path.join(PLUGINS_DIR, name));
}

/**
 * Create the discovery sub-router for the plugin market.
 * @param {object} opts
 * @param {object} [opts.pluginLoader]
 * @param {Function} [opts.broadcastFn]
 * @returns {import('express').Router}
 */
function createDiscoveryRouter(opts = {}) {
  const router = Router();

  // ── GET /api/plugins/market ──
  // 返回精选 + GitHub 发现结果（缓存 5 分钟）
  // 支持 ?force=1 跳过缓存强制刷新
  router.get('/plugins/market', async (req, res) => {
    const gitAvailable = checkGit();
    const forceRefresh = req.query.force === '1' || req.query.force === 'true';

    let githubResults;

    if (forceRefresh) {
      // 强制刷新：同步拉取 GitHub，失败时回退到过期缓存
      try {
        const result = await searchGitHubPlugins();
        githubResults = result.items || [];
        if (githubResults.length > 0) {
          writeMarketCache(githubResults);
        }
      } catch (err) {
        console.warn('[PluginMarket] Force refresh failed:', err.message);
        githubResults = readStaleMarketCache() || [];
      }
    } else {
      // 正常路径：先读缓存
      githubResults = readMarketCache();

      if (!githubResults) {
        // 缓存过期：返回空结果，后台异步刷新（保持原有快速响应行为）
        searchGitHubPlugins().then(result => {
          if (result.items.length > 0) {
            writeMarketCache(result.items);
          }
        }).catch(() => { console.debug('[PluginMarket] background cache refresh'); });
        githubResults = [];
      }
    }

    const featured = FEATURED_PLUGINS.map(p => ({
      ...p,
      installed: isInstalled(p.name),
    }));

    const discovered = githubResults.map(p => ({
      ...p,
      installed: isInstalled(p.name),
    }));

    res.json({
      featured,
      discovered,
      stats: {
        gitAvailable,
        featuredCount: featured.length,
        discoveredCount: discovered.length,
        installedCount: listInstalledPlugins().length,
        cacheExpiresAt: readMarketCache() ? Date.now() + MARKET_CACHE_TTL : null,
        lastUpdated: fs.existsSync(MARKET_CACHE_FILE)
          ? fs.statSync(MARKET_CACHE_FILE).mtime
          : null,
      },
    });
  });

  // ── GET /api/plugins/sources ──
  // 获取当前自定义源列表
  router.get('/plugins/sources', (req, res) => {
    const sources = loadCustomSources();
    res.json({ sources });
  });

  // ── POST /api/plugins/sources ──
  // 保存自定义源列表
  router.post('/plugins/sources', (req, res) => {
    const { sources } = req.body;
    if (!Array.isArray(sources)) {
      return res.status(400).json({ error: '"sources" must be an array' });
    }
    saveCustomSources(sources);
    res.json({ success: true, count: sources.length });
  });

  // ── POST /api/plugins/sources/test ──
  // 测试一个自定义源是否可达
  router.post('/plugins/sources/test', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
      const plugins = await fetchCustomSourcePlugins(url);
      res.json({ reachable: plugins.length > 0, pluginCount: plugins.length, plugins });
    } catch (err) {
      res.json({ reachable: false, error: err.message });
    }
  });

  // ── GET /api/plugins/plaza/search ──
  // 多源搜索：GitHub + npm + 自定义源
  router.get('/plugins/plaza/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    const sources = (req.query.sources || 'github,npm').split(',');

    const results = {};
    const errors = [];

    // 并行搜索多个源
    const searches = [];

    if (sources.includes('github')) {
      searches.push(
        searchGitHubPlugins(query).then(r => {
          results.github = r.items.map(p => ({
            ...p,
            installed: isInstalled(p.name),
          }));
        }).catch(err => {
          errors.push({ source: 'github', error: err.message });
          results.github = [];
        })
      );
    }

    if (sources.includes('npm')) {
      searches.push(
        searchNpmPlugins(query).then(r => {
          results.npm = r.items.map(p => ({
            ...p,
            installed: isInstalled(p.name),
          }));
        }).catch(err => {
          errors.push({ source: 'npm', error: err.message });
          results.npm = [];
        })
      );
    }

    if (sources.includes('custom')) {
      const customSources = loadCustomSources();
      for (const cs of customSources) {
        searches.push(
          fetchCustomSourcePlugins(cs.value).then(items => {
            results[`custom:${cs.name}`] = items.map(p => ({
              ...p,
              installed: isInstalled(p.name),
              _sourceLabel: cs.label || cs.name,
            }));
          }).catch(err => {
            errors.push({ source: cs.name, error: err.message });
          })
        );
      }
    }

    await Promise.all(searches);

    res.json({ query, results, errors });
  });

  // ── GET /api/plugins/market/search ──
  // 向后兼容：搜索 GitHub 上的 cli-q-plugin 主题仓库
  router.get('/plugins/market/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    const page = parseInt(req.query.page, 10) || 1;

    if (!query) {
      return res.status(400).json({ error: 'Search query required (e.g. ?q=database)' });
    }

    try {
      const result = await searchGitHubPlugins(query, page);

      // 标记哪些已安装
      const items = result.items.map(p => ({
        ...p,
        installed: isInstalled(p.name),
      }));

      res.json({
        query,
        page,
        total: result.total,
        hasMore: result.hasMore,
        items,
      });
    } catch (err) {
      res.status(502).json({ error: `GitHub search failed: ${err.message}` });
    }
  });

  return router;
}

module.exports = { createDiscoveryRouter };
