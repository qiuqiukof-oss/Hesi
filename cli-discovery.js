/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// CLI Discovery — registry, PATH scanning, version/type detection
// ============================================================
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { getActivePreset } = require('./preset-loader');

// ============================================================
// Platform helpers
// ============================================================
const isWin = process.platform === 'win32';
const REGISTRY_PATH = path.join(__dirname, 'cli-registry.json');

// ============================================================
// CLI Discovery Cache — 将发现结果缓存到磁盘，避免每次启动都扫描 PATH
// 缓存自动过期（默认 24 小时），也可通过删除 .cli-discovery-cache.json 手动刷新
// ============================================================
const DISCOVERY_CACHE_PATH = path.join(__dirname, '.cli-discovery-cache.json');
const DISCOVERY_CACHE_TTL_MS = parseInt(process.env.CLI_DISCOVERY_CACHE_TTL, 10) || 24 * 60 * 60 * 1000; // 24h

/**
 * 从磁盘加载 CLI 发现缓存。
 * 缓存有效且未过期时返回缓存的 registry，否则返回 null。
 */
function loadDiscoveryCache() {
  try {
    const raw = fs.readFileSync(DISCOVERY_CACHE_PATH, 'utf-8');
    const cache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < DISCOVERY_CACHE_TTL_MS) {
      console.log(`[Discovery] Loaded ${cache.registry?.clis?.length || 0} CLIs from cache (age: ${Math.round((Date.now() - cache.timestamp) / 1000 / 60)}m)`);
      return cache.registry;
    }
    console.log('[Discovery] Cache expired, will re-scan');
  } catch {
    // 文件不存在或格式错误，静默处理
  }
  return null;
}

/**
 * 将 CLI 发现结果保存到磁盘缓存。
 */
function saveDiscoveryCache(registry) {
  try {
    const data = JSON.stringify({ timestamp: Date.now(), registry }, null, 2);
    fs.writeFileSync(DISCOVERY_CACHE_PATH, data, 'utf-8');
    const count = registry?.clis?.length || 0;
    console.log(`[Discovery] Saved ${count} CLIs to cache (${DISCOVERY_CACHE_PATH})`);
  } catch (err) {
    console.warn(`[Discovery] Failed to save cache: ${err.message}`);
  }
}

// ============================================================
// Preset-derived constants
// Load from preset-loader so cli-presets/*.json are the source of truth.
// Falls back to hardcoded defaults if no preset is available (legacy compat).
// ============================================================
function getPresetConstants() {
  const preset = getActivePreset();
  if (preset) {
    return {
      KNOWN_CLI_CATEGORIES: preset.categoriesMap || {},
      KNOWN_CLI_TYPES: preset.types || {},
      KNOWN_CLI_NAMES: preset.names || [],
    };
  }
  // Legacy fallback (should not happen once presets are in place)
  return {
    KNOWN_CLI_CATEGORIES: {},
    KNOWN_CLI_TYPES: {},
    KNOWN_CLI_NAMES: [],
  };
}

// ============================================================
// Version flags to try in order
// ============================================================
const VERSION_FLAGS = [
  ['--version'],
  ['-v'],
  ['-V'],
  ['version'],
];

// ============================================================
// Registry persistence
// ============================================================

/**
 * Load the CLI registry from disk.
 * Returns a default structure if the file is missing or corrupt.
 */
function loadRegistry() {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, clis: [] };
  }
}

/**
 * Save the CLI registry to disk.
 */
function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

// ============================================================
// PATH resolution
// ============================================================

/**
 * Find the full path of a command by scanning PATH directories directly.
 * No subprocess calls — pure fs operations.
 */
function resolveCommand(name) {
  const exts = isWin
    ? (process.env.PATHEXT || '.exe;.cmd;.bat;.com').split(';').map(e => e.toLowerCase())
    : [''];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not found */ }
    }
  }
  return null;
}

// ============================================================
// Version detection
// ============================================================

/**
 * Safely get version string — async, non-blocking.
 * Uses execFile (no shell injection), tries multiple flags,
 * captures both stdout/stderr, and cleans null bytes from output.
 * Handles encoding issues (e.g., Chinese characters on Windows).
 */
async function getVersion(fullPath) {
  for (const flags of VERSION_FLAGS) {
    try {
      const { stdout, stderr } = await execFile(fullPath, flags, {
        encoding: 'utf-8',
        timeout: 2000,
        windowsHide: true,
      });
      const cleaned = (stdout || stderr || '')
        .replace(/\0/g, '')          // Remove null bytes
        .replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Remove replacement chars & control chars
        .trim()
        .split(/\r?\n/)[0];
      if (cleaned && cleaned.length > 0) return cleaned;
    } catch {
      // try next flag — timeout, exec error, etc.
    }
  }
  return 'unknown';
}

// ============================================================
// Type classification
// ============================================================

/**
 * Get the category for a CLI name.
 */
function guessCategory(name) {
  const { KNOWN_CLI_CATEGORIES } = getPresetConstants();
  return KNOWN_CLI_CATEGORIES[name] || 'tool';
}

/**
 * Determine if a command is interactive or batch — async, non-blocking.
 * Uses known type map first, then falls back to --help heuristic.
 */
async function guessType(fullPath, name) {
  const { KNOWN_CLI_TYPES } = getPresetConstants();
  // Check known types first — authoritative
  if (KNOWN_CLI_TYPES[name] !== undefined) {
    return KNOWN_CLI_TYPES[name];
  }

  // Fallback: run --help, if it exits quickly it's batch
  try {
    await execFile(fullPath, ['--help'], {
      timeout: 2000,
      windowsHide: true,
    });
    return 'batch';
  } catch {
    return 'interactive';
  }
}

// ============================================================
// Package-manager bin directory sweep — discovers CLIs installed
// by npm/pip/cargo etc. that aren't in the preset's names list.
// Scans known non-system bin directories for executable files
// and returns candidates not yet in the registry.
// ============================================================

/**
 * Well-known package-manager bin directories to sweep for CLI discovery.
 * This ensures globally-installed tools (npm, cargo, pipx, etc.)
 * are auto-discovered even when not listed in any preset.
 *
 * SAFETY: Only scans local, well-known directories. Does NOT scan the
 * entire user PATH, because that can include network drives, system
 * subdirectories (Wbem, OpenSSH), and hundreds of files — causing
 * excessive child-process spawning and system hangs.
 */
function getPackageBinDirs() {
  const dirs = [];

  // npm global prefix (where npm install -g puts .cmd/.ps1 wrappers)
  if (isWin) {
    const appData = process.env.APPDATA;
    if (appData) dirs.push(path.join(appData, 'npm'));
  } else {
    dirs.push('/usr/local/bin');
  }

  // cargo bin
  const home = process.env.USERPROFILE || process.env.HOME;
  const cargoHome = process.env.CARGO_HOME || (home ? path.join(home, '.cargo') : null);
  if (cargoHome) dirs.push(path.join(cargoHome, 'bin'));

  // pipx bin
  const pipxHome = process.env.PIPX_BIN_DIR || (home
    ? path.join(home, '.local', 'bin')
    : null);
  if (pipxHome) dirs.push(pipxHome);

  return dirs;
}

// Maximum number of sweep-discovered candidates to process in one
// discovery run. Prevents resource exhaustion from too many execFile
// calls when the user has hundreds of globally-installed packages.
const MAX_SWEEP_CANDIDATES = 30;

/**
 * Scan package-manager bin directories for executables not yet
 * in the registry. Returns candidate objects compatible with
 * the main discovery pipeline.
 */
function sweepPackageDirs(existingIds) {
  const candidates = [];
  const dirs = getPackageBinDirs();
  const seen = new Set();

  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (!stat.isFile() || stat.size === 0) continue;

      // Extract the command name (strip extension)
      const ext = path.extname(entry).toLowerCase();
      const base = path.basename(entry, ext); // naked name without extension
      const isExecutable = isWin
        ? ['.exe', '.cmd', '.bat', '.com', '.ps1'].includes(ext)
        : stat.mode & 0o111;
      if (!isExecutable) continue;

      // Skip files with dots in the basename (e.g. "some.tool.exe")
      if (base.includes('.')) continue;

      // Skip versioned files (node.exe, python3.14.exe, etc.)
      if (/\d/.test(base[base.length - 1]) && /\d/.test(base)) continue;

      // Deduplicate across dirs and against existing registry
      if (seen.has(base) || existingIds.has(base)) continue;
      seen.add(base);
      candidates.push({ name: base, fullPath });
    }
  }
  return candidates;
}

// ============================================================
// Discovery orchestrator
// ============================================================

/**
 * Discover CLIs from PATH — async, non-blocking.
 * Runs all version/type checks in parallel using Promise.allSettled.
 *
 * Two-phase discovery:
 *   1. Preset names — exactly the CLIs listed in the active preset
 *   2. Package sweep — globally installed tools (npm/cargo/pipx)
 *      not listed in any preset
 */
async function discoverCLIs() {
  const registry = loadRegistry();
  // Preserve only manually-added CLIs; remove auto-discovered ones
  // so switching presets actually switches the tool set
  const manualCLIs = registry.clis.filter(c => c.discovered === 'manual');
  registry.clis = manualCLIs;
  const existingIds = new Set(manualCLIs.map(c => c.id));
  const { KNOWN_CLI_NAMES } = getPresetConstants();

  // Phase 1 — Preset-named candidates (fast, no subprocess)
  const candidates = [];
  for (const name of KNOWN_CLI_NAMES) {
    if (existingIds.has(name)) continue;
    const fullPath = resolveCommand(name);
    if (!fullPath) continue;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.size === 0) continue;
    candidates.push({ name, fullPath });
  }

  // Phase 2 — Sweep package-manager bin dirs for executables
  // that aren't already known. This catches globally-installed
  // CLI tools not listed in any preset.
  const swept = sweepPackageDirs(existingIds);
  let sweepAdded = 0;
  for (const c of swept) {
    // Avoid duplicating a preset-named candidate
    if (!candidates.some(x => x.name === c.name)) {
      candidates.push(c);
      sweepAdded++;
      if (sweepAdded >= MAX_SWEEP_CANDIDATES) break; // safety cap
    }
  }

  if (candidates.length === 0) {
    return { registry, discovered: [] };
  }

  // Phase 3 — run all version/type checks in BATCHES to avoid spawning
  // hundreds of concurrent child processes (which causes system hangs
  // and crashes on Windows).
  const BATCH_SIZE = 8;
  const discovered = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async ({ name, fullPath }) => {
        const [version, type] = await Promise.all([
          getVersion(fullPath),
          guessType(fullPath, name),
        ]);
        return {
          id: name,
          name,
          // Store the portable command name (not a machine-specific absolute
          // path). The executable is resolved to an absolute path at runtime
          // via resolveCliExecutable(), which keeps the registry shareable
          // across machines and self-healing against stale cached paths.
          path: name,
          type,
          category: guessCategory(name),
          discovered: 'path',
          args: [],
          version,
          addedAt: new Date().toISOString(),
        };
      })
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        discovered.push(result.value);
        existingIds.add(result.value.id);
      }
    }
  }

  if (discovered.length > 0) {
    registry.clis.push(...discovered);
    saveRegistry(registry);
  }

  return { registry, discovered };
}

/**
 * Discover CLIs asynchronously — safe wrapper.
 * 优先从磁盘缓存加载，缓存不存在或过期时执行全量扫描。
 */
async function discoverCLIsAsync() {
  // 尝试从缓存加载
  const cached = loadDiscoveryCache();
  if (cached) {
    return { registry: cached, discovered: [], fromCache: true };
  }

  // 缓存不可用，执行全量发现
  try {
    const result = await discoverCLIs();
    // 保存缓存供下次使用
    saveDiscoveryCache(result.registry);
    return result;
  } catch (e) {
    console.warn(`[Discovery] Full scan failed: ${e.message}`);
    return { registry: loadRegistry(), discovered: [] };
  }
}

// ============================================================
// Registry migration — resolve non-absolute paths on startup
// ============================================================

/**
 * Ensure every registry entry has a resolvable identifier.
 *
 * We intentionally do NOT rewrite `path` to a machine-specific absolute path.
 * Discovered CLIs store the portable command name (see discoverCLIs), and the
 * absolute executable is resolved at runtime via resolveCliExecutable(). This
 * keeps cli-registry.json shareable across machines and free of hardcoded
 * local paths (e.g. C:\Users\Administrator\...).
 */
function resolveRegistryPaths() {
  const registry = loadRegistry();
  let changed = false;

  for (const cli of registry.clis) {
    if (!cli.path) {
      cli.path = cli.name;
      changed = true;
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
  return registry;
}

/**
 * Resolve the absolute executable path for a CLI entry.
 *
 * Self-healing: if the cached `path` is missing or stale (e.g. the registry
 * was copied from another machine with different absolute paths), fall back to
 * resolving the command name via PATH. Always returns an existing, runnable
 * absolute path when possible, WITHOUT mutating the persisted registry.
 *
 * @param {{ name: string, path?: string }} cliEntry
 * @returns {string|null} absolute executable path, or null if unresolvable
 */
function resolveCliExecutable(cliEntry) {
  if (!cliEntry || !cliEntry.name) return null;
  const stored = cliEntry.path;

  // 1. Cached path is valid and exists -> use it directly
  if (stored) {
    try {
      if (fs.existsSync(stored) && fs.statSync(stored).isFile()) {
        return stored;
      }
    } catch {
      // fall through to PATH resolution
    }
  }

  // 2. Fall back to resolving the command name via PATH (cross-machine safe)
  const byName = resolveCommand(cliEntry.name);
  if (byName) return byName;

  // 3. Genuinely unresolvable
  return null;
}

/**
 * Migrate registry entries that are missing a category field.
 * Assigns categories based on KNOWN_CLI_CATEGORIES or defaults to 'tool'.
 */
function migrateRegistryCategories() {
  const registry = loadRegistry();
  let changed = false;

  for (const cli of registry.clis) {
    if (!cli.category) {
      cli.category = guessCategory(cli.name);
      changed = true;
      console.log(`[Registry] Assigned category "${cli.category}" to "${cli.name}"`);
    }
  }

  if (changed) {
    saveRegistry(registry);
  }
  return registry;
}

// ============================================================
// Registry write serialization (prevents async interleaving)
// ============================================================

let registryWriteQueue = Promise.resolve();
const MAX_QUEUE_LENGTH = 50;
let queueLength = 0;

/**
 * Execute a function that reads and writes the registry.
 * Operations are queued to prevent interleaved async writes.
 * If the queue exceeds MAX_QUEUE_LENGTH, the operation is rejected
 * to prevent unbounded memory growth.
 */
async function withRegistry(fn) {
  if (queueLength >= MAX_QUEUE_LENGTH) {
    console.warn('[Registry] Write queue full, rejecting operation');
    const err = new Error('Registry write queue full, try again');
    err.status = 503;
    throw err;
  }
  queueLength++;
  const prev = registryWriteQueue;
  const next = prev.then(fn, fn); // run even if previous failed
  registryWriteQueue = next.then(
    () => { queueLength--; },
    () => { queueLength--; }
  );
  return next;
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  // Expose preset getter for other modules
  getPresetConstants,
  // Constants
  VERSION_FLAGS,
  REGISTRY_PATH,
  isWin,
  // Registry
  loadRegistry,
  saveRegistry,
  withRegistry,
  resolveRegistryPaths,
  migrateRegistryCategories,
  // Resolution
  resolveCommand,
  resolveCliExecutable,
  // Detection
  getVersion,
  guessType,
  guessCategory,
  // Discovery
  discoverCLIsAsync,
  // Cache
  loadDiscoveryCache,
  saveDiscoveryCache,
  DISCOVERY_CACHE_PATH,
};
