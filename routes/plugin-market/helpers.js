/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plugin Market — shared helpers & constants
//
// Extracted from routes/plugin-market.js so the route module stays small.
// Everything here is pure logic (discovery, caching, git clone) with no
// Express coupling. The route submodules (discovery.js / install.js) consume
// these via require('../plugin-market/helpers').
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');
const MARKET_CACHE_FILE = path.join(PLUGINS_DIR, '.market-cache.json');
const MARKET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ──────────────────────────────────────────────
// 定制源配置文件路径
// ──────────────────────────────────────────────
const CUSTOM_SOURCES_FILE = path.join(PLUGINS_DIR, '.custom-sources.json');

/**
 * 读取自定义源列表。
 * 每个源包含: { name, type: 'github'|'npm'|'url', value: string, label?: string }
 */
function loadCustomSources() {
  try {
    if (!fs.existsSync(CUSTOM_SOURCES_FILE)) return [];
    const raw = fs.readFileSync(CUSTOM_SOURCES_FILE, 'utf-8');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function saveCustomSources(sources) {
  try {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    fs.writeFileSync(CUSTOM_SOURCES_FILE, JSON.stringify(sources, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[PluginPlaza] Failed to save custom sources:', e.message);
  }
}

// ──────────────────────────────────────────────
// 内置精选插件列表（Hesi 官方认证）
// ──────────────────────────────────────────────
const FEATURED_PLUGINS = [
  {
    repo: 'codebuff/cli-q-plugins',
    name: 'example',
    description: 'Hesi 示例插件合集 — 展示所有插件能力的参考实现',
    author: 'Hesi Team',
    tags: ['example', 'tutorial'],
    stars: 5,
    source: 'featured',
  },
];

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

/**
 * 检查 git 是否可用。
 * 使用 execSync 但仅为单次快速检测（git --version 通常在 10ms 内返回）。
 */
function checkGit() {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 从 GitHub 仓库 URL 中提取 owner/name。
 */
function parseRepoUrl(url) {
  // 支持格式: https://github.com/owner/repo, git@github.com:owner/repo.git, owner/repo
  // 注意: 必须要求 github.com 前为 "//" 或 "@"，避免把 "not-github.com" 误判为 GitHub 仓库。
  let match = url.match(/(\/\/|@)github\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) return { owner: match[2], name: match[3], full: `${match[2]}/${match[3]}` };
  match = url.match(/^([^/]+)\/([^/]+)$/);
  if (match) return { owner: match[1], name: match[2], full: `${match[1]}/${match[2]}` };
  return null;
}

/**
 * 从 GitHub API 获取仓库的 plugin.json（不需要 token 的公开仓库读取）。
 * 使用 raw.githubusercontent.com 直接获取文件内容。
 */
async function fetchPluginJson(repo, branch = 'main') {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/plugin.json`;
  const res = await fetch(url);
  if (!res.ok) {
    // 尝试 master 分支
    const urlMaster = `https://raw.githubusercontent.com/${repo}/master/plugin.json`;
    const resMaster = await fetch(urlMaster);
    if (!resMaster.ok) {
      throw new Error(`plugin.json not found in ${repo} (tried main/master)`);
    }
    return { json: await resMaster.json(), branch: 'master' };
  }
  return { json: await res.json(), branch };
}

/**
 * 从 GitHub Search API 搜索带有 cli-q-plugin topic 的仓库。
 * 不需要认证，但未认证时限制 10 次/分钟。
 */
async function searchGitHubPlugins(query, page = 1) {
  const q = query
    ? `topic:cli-q-plugin ${query}`
    : 'topic:cli-q-plugin';

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20&page=${page}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Hesi-PluginPlaza/1.0',
    },
  });

  if (!res.ok) {
    // Rate limit 或网络错误时不阻塞，返回空结果
    const errText = await res.text().catch(() => '');
    console.warn(`[PluginPlaza] GitHub search failed (${res.status}): ${errText.substring(0, 200)}`);
    return { items: [], total: 0, hasMore: false };
  }

  const data = await res.json();
  return {
    items: (data.items || []).map(repo => ({
      repo: repo.full_name,
      name: repo.name,
      description: repo.description || '',
      author: repo.owner?.login || '',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      topics: repo.topics || [],
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch || 'main',
      updatedAt: repo.updated_at,
      source: 'github',
    })),
    total: data.total_count || 0,
    hasMore: (data.items || []).length === 20,
  };
}

/**
 * 从 npm registry 搜索包。
 * 搜索关键词 "cli-q-plugin" 或用户指定的查询。
 */
async function searchNpmPlugins(query) {
  const q = query
    ? `keywords:cli-q-plugin ${query}`
    : 'keywords:cli-q-plugin';

  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=20`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/vnd.npm.install-v1+json' },
    });

    if (!res.ok) {
      return { items: [], total: 0 };
    }

    const data = await res.json();
    return {
      items: (data.objects || []).map(pkg => ({
        repo: pkg.package.name,
        name: pkg.package.name,
        description: pkg.package.description || '',
        author: (pkg.package.author && pkg.package.author.name) || (pkg.package.publisher && pkg.package.publisher.username) || '',
        stars: pkg.package.score ? Math.round(pkg.package.score.detail.popularity * 100) : 0,
        version: pkg.package.version || '',
        htmlUrl: pkg.package.links ? (pkg.package.links.npm || pkg.package.links.repository || '') : '',
        updatedAt: pkg.package.date,
        source: 'npm',
      })),
      total: data.total || 0,
    };
  } catch (err) {
    console.warn(`[PluginPlaza] npm search failed: ${err.message}`);
    return { items: [], total: 0 };
  }
}

/**
 * 从自定义 URL 获取插件列表（URL 应为 JSON 格式，返回插件数组）。
 */
async function fetchCustomSourcePlugins(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000), // 10s timeout
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    // 支持数组或 { plugins: [...] } 格式
    const items = Array.isArray(data) ? data : (data.plugins || []);
    return items.map(p => ({
      ...p,
      repo: p.repo || p.name,
      source: 'custom',
      _sourceUrl: url,
    }));
  } catch (err) {
    console.warn(`[PluginPlaza] Custom source fetch failed (${url}): ${err.message}`);
    return [];
  }
}

/**
 * 读取市场缓存（如果未过期）。
 */
function readMarketCache() {
  try {
    if (!fs.existsSync(MARKET_CACHE_FILE)) return null;
    const raw = fs.readFileSync(MARKET_CACHE_FILE, 'utf-8');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < MARKET_CACHE_TTL) {
      return cache.data;
    }
  } catch (e) {
    // 缓存损坏时忽略
  }
  return null;
}

/**
 * 读取市场缓存（忽略 TTL — 用于强制刷新失败时的回退）。
 */
function readStaleMarketCache() {
  try {
    if (!fs.existsSync(MARKET_CACHE_FILE)) return null;
    const raw = fs.readFileSync(MARKET_CACHE_FILE, 'utf-8');
    const cache = JSON.parse(raw);
    return cache.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * 写入市场缓存。
 */
function writeMarketCache(data) {
  try {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }
    fs.writeFileSync(MARKET_CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      data,
    }, null, 2), 'utf-8');
  } catch (e) {
    // 缓存写入失败不影响主流程
    console.warn('[PluginMarket] Failed to write market cache:', e.message);
  }
}

/**
 * 列出 plugins/ 目录下所有目录（已安装的插件）。
 */
function listInstalledPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  try {
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    return dirs.map(d => {
      const manifestPath = path.join(PLUGINS_DIR, d.name, 'plugin.json');
      let manifest = null;
      let valid = false;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          valid = true;
        } catch (e) {
          // 清单解析失败
        }
      }
      return {
        name: d.name,
        valid,
        manifest,
        path: d.name,
        installedAt: fs.statSync(path.join(PLUGINS_DIR, d.name)).birthtime,
      };
    });
  } catch (e) {
    console.error('[PluginMarket] Failed to list installed plugins:', e.message);
    return [];
  }
}

/**
 * 在一个插件目录中执行 git clone，通过 broadcastFn 推送实时进度。
 * 返回目标目录名（取自仓库名或 plugin.json 中的 name）。
 *
 * @param {string} repo — 仓库标识 (owner/repo)
 * @param {string} targetDir — 目标目录名
 * @param {string} [branch='main'] — 分支
 * @param {Function} [broadcastFn] — 可选，WS 广播函数，推送 { type: 'plugin_install_progress', ... }
 * @returns {Promise<string>} — 目标路径
 */
async function gitClonePlugin(repo, targetDir, branch = 'main', broadcastFn) {
  const url = repo.includes('://') || repo.includes('@')
    ? repo
    : `https://github.com/${repo}.git`;

  const pluginsDir = PLUGINS_DIR;

  // 确保 plugins 目录存在
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
  }

  // 目标路径
  const destPath = path.join(pluginsDir, targetDir);

  // 检查是否已存在
  if (fs.existsSync(destPath)) {
    const errMsg = `Plugin directory "${targetDir}" already exists.`;
    if (broadcastFn) {
      broadcastFn({
        type: 'plugin_install_progress',
        repo,
        phase: 'error',
        message: errMsg,
        progress: 0,
      });
    }
    throw new Error(errMsg);
  }

  // 发送开始事件
  if (broadcastFn) {
    broadcastFn({
      type: 'plugin_install_progress',
      repo,
      phase: 'start',
      message: `开始克隆 ${repo} (${branch})...`,
      progress: 0,
      targetDir,
    });
  }

  // 执行 git clone
  return new Promise((resolve, reject) => {
    const args = ['clone', '--depth=1', '--progress'];
    if (branch) {
      args.push('--branch', branch);
    }
    args.push(url, destPath);

    const proc = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: __dirname,
    });

    let stderr = '';
    let lastProgress = 0;

    // ── 解析 git clone 进度行 ──
    // 格式: "Receiving objects:  75% (1500/2000), 4.50 MiB | 1.20 MiB/s"
    const PROGRESS_RE = /(?:Receiving|Resolving|Checking).*?\s+(\d+)%\s+\((\d+)\/(\d+)\)/;

    function parseProgress(line) {
      const m = line.match(PROGRESS_RE);
      if (m) {
        const pct = parseInt(m[1], 10);
        const done = parseInt(m[2], 10);
        const total = parseInt(m[3], 10);
        const progress = Math.min(95, pct); // 保留 5% 给验证步骤
        if (progress > lastProgress) {
          lastProgress = progress;
          if (broadcastFn) {
            broadcastFn({
              type: 'plugin_install_progress',
              repo,
              phase: 'cloning',
              message: `克隆中 ${done}/${total} (${pct}%)`,
              progress,
              done,
              total,
              targetDir,
            });
          }
        }
        return true;
      }
      return false;
    }

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      // git progress 有时会出现在 stdout
      const lines = text.split('\r');
      for (const line of lines) {
        if (parseProgress(line)) continue;
      }
    });

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;

      // 解析进度行（git 通常将进度输出到 stderr）
      const lines = text.split('\r');
      for (const line of lines) {
        if (parseProgress(line)) continue;

        // 也报告非进度的关键 stderr 行
        const trimmed = line.trim();
        if (trimmed && broadcastFn) {
          // 只发送有意义的状态行，跳过 ANSI 转义
          const clean = trimmed.replace(/\x1B(?:[@-Z\\^_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
          if (clean && clean.length > 5 && !clean.startsWith('remote:')) {
            broadcastFn({
              type: 'plugin_install_progress',
              repo,
              phase: 'cloning',
              message: clean.slice(0, 120),
              progress: lastProgress || 5,
              targetDir,
            });
          }
        }
      }
    });

    proc.on('close', code => {
      if (code !== 0) {
        // 清理残留目录
        try {
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true });
          }
        } catch (e) { console.warn('[PluginMarket] cleanup on clone failure:', e?.message); }

        if (broadcastFn) {
          broadcastFn({
            type: 'plugin_install_progress',
            repo,
            phase: 'error',
            message: `git clone 失败: ${stderr.substring(0, 200)}`,
            progress: 0,
            targetDir,
          });
        }
        reject(new Error(`git clone failed (exit ${code}): ${stderr.substring(0, 500)}`));
      } else {
        // 克隆完成
        if (broadcastFn) {
          broadcastFn({
            type: 'plugin_install_progress',
            repo,
            phase: 'cloned',
            message: '克隆完成，验证插件清单...',
            progress: 95,
            targetDir,
          });
        }
        resolve(destPath);
      }
    });

    proc.on('error', err => {
      try {
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
      } catch (e) { console.warn('[PluginMarket] cleanup on git spawn error:', e?.message); }

      if (broadcastFn) {
        broadcastFn({
          type: 'plugin_install_progress',
          repo,
          phase: 'error',
          message: `Git 进程错误: ${err.message}`,
          progress: 0,
          targetDir,
        });
      }
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });

    // 60 秒超时
    setTimeout(() => {
      proc.kill();
      const errMsg = 'git clone timed out after 60s';
      if (broadcastFn) {
        broadcastFn({
          type: 'plugin_install_progress',
          repo,
          phase: 'error',
          message: errMsg,
          progress: 0,
          targetDir,
        });
      }
      reject(new Error(errMsg));
    }, 60000);
  });
}

module.exports = {
  PLUGINS_DIR,
  MARKET_CACHE_FILE,
  MARKET_CACHE_TTL,
  CUSTOM_SOURCES_FILE,
  FEATURED_PLUGINS,
  loadCustomSources,
  saveCustomSources,
  checkGit,
  parseRepoUrl,
  fetchPluginJson,
  searchGitHubPlugins,
  searchNpmPlugins,
  fetchCustomSourcePlugins,
  readMarketCache,
  readStaleMarketCache,
  writeMarketCache,
  listInstalledPlugins,
  gitClonePlugin,
  // ── 测试用导出 ──
  _test: { FEATURED_PLUGINS, parseRepoUrl, checkGit },
};
