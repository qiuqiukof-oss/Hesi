/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// DSH（DeepSeek Harness）引擎运行时管理
//
// Hesi 将最新版 DSH（@deepseek-ai/dsh，npm 0.1.0-rc.x）作为子进程托管：
//   - `dsh web` 提供官方 Web UI（端口默认 3080，HESI_DSH_PORT 可改）
//   - 注入 Hesi 的 DeepSeek 凭据（DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL）
//   - 崩溃自动重启（限次、退避），Hesi 退出时随进程回收
//
// 状态机：stopped → starting → running → stopping → stopped
//                       └────────→ error（不可恢复）
// ============================================================

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const os = require('os');

const { getConfig, getDefaultProvider } = require('../llm-provider/provider-config');
const { getWorkspace } = require('../workspace');

const DEFAULT_PORT = Number(process.env.HESI_DSH_PORT) || 3080;
const MAX_RESTART_ATTEMPTS = 3;
const READY_TIMEOUT_MS = 40_000;
const RESTART_BACKOFF_MS = 2_000;

/** @type {import('child_process').ChildProcess|null} */
let proc = null;
let actualPort = 0;
let state = 'stopped'; // stopped | starting | running | stopping | error
let lastError = null;
let restartCount = 0;
let readyTimer = null;
let versionCache = null;
let stableSince = 0;

/** 平台 shim：Windows 下 npm 的 .bin 里可执行的是 dsh.cmd（裸 dsh 是 sh 脚本，Node 无法直接 spawn）。 */
const IS_WIN = process.platform === 'win32';

/** 定位 dsh 可执行文件：Hesi 自带依赖 → 系统全局 → null。 */
function findDshBin() {
  const binName = IS_WIN ? 'dsh.cmd' : 'dsh';
  const own = path.join(__dirname, '..', '..', 'node_modules', '.bin', binName);
  try {
    if (fs.existsSync(own)) return own;
  } catch { /* ignore */ }
  // 全局 PATH 查找：Windows 用 where，POSIX 用 command -v
  const lookup = IS_WIN ? 'where dsh' : 'command -v dsh';
  try {
    const found = execFileSync(lookup, { shell: true, encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (found) return found;
  } catch { /* not found */ }
  return null;
}

/** 取 DSH 版本（带缓存）。@returns {Promise<string>} */
async function getVersion(bin) {
  if (versionCache) return versionCache;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `dsh --version exit ${code}`))));
    });
    versionCache = out;
    return out;
  } catch (e) {
    return 'unknown';
  }
}

/** 探测空闲端口：优先 preferred，被占用则让 OS 分配。@returns {Promise<number>} */
function findFreePort(preferred) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once('error', (err) => {
        if (p !== 0) tryPort(0);
        else reject(err);
      });
      srv.listen(p, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    };
    tryPort(preferred);
  });
}

/** 查询监听指定端口的进程 PID（Linux ss / Windows netstat）。@param {number} port @returns {number|null} */
function pidListeningOn(port) {
  try {
    if (IS_WIN) {
      // netstat -ano 末列即 PID
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) return Number(pid);
      }
      return null;
    }
    const out = execFileSync('ss', ['-tlnp'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const m = line.match(/pid=(\d+)/);
      if (m) return Number(m[1]);
    }
  } catch { /* ss/netstat 不可用则跳过 */ }
  return null;
}

/** 同步睡眠（等待端口释放）。@param {number} ms */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

/**
 * Windows：取某 PID 进程的命令行。
 * 优先 wmic；Win11 24H2+ 已移除 wmic（实测 ENOENT），回退 PowerShell
 * Get-CimInstance（所有 Windows 均有）。
 * @returns {string}
 */
function processCmdlineWin(pid) {
  try {
    const out = execFileSync('wmic', ['process', 'where', `processid=${pid}`, 'get', 'commandline', '/value'], { encoding: 'utf8' });
    const m = out.match(/CommandLine=([^\r\n]*)/);
    if (m) return m[1];
  } catch { /* wmic 不存在（Win11 24H2+）→ 走 PowerShell */ }
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
    );
    return (out || '').trim();
  } catch { /* PowerShell 也不可用 */ }
  return '';
}

/**
 * 回收孤儿 dsh web 进程：Hesi 异常退出/被强杀时其 dsh 子进程可能残留并占用
 * DEFAULT_PORT（且带着旧配置——这就是「DSH 不跟随 .env.local」的常见根因：
 * 新配置的 `dsh web` 起不来，页面连到的还是旧配置残留）。启动前若发现该端口
 * 被 dsh 占用则先回收，保证端口稳定、配置最新。Linux 查 /proc，Windows 用 wmic。
 */
function reclaimOrphanDsh() {
  const pid = pidListeningOn(DEFAULT_PORT);
  if (!pid) return;
  try {
    let cmd = '';
    if (IS_WIN) {
      cmd = processCmdlineWin(pid);
    } else {
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    }
    if (!cmd.includes('dsh') || !cmd.includes('web')) return; // 被其它程序占用，不碰
    console.warn(`[dsh] 回收孤儿 dsh 进程 (pid=${pid})，释放端口 ${DEFAULT_PORT}`);
    if (IS_WIN) {
      try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' }); } catch { /* 已退出则忽略 */ }
    } else {
      process.kill(pid, 'SIGTERM');
    }
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (pidListeningOn(DEFAULT_PORT) === null) return;
      sleepSync(200);
    }
  } catch { /* 无权限或已退出，忽略 */ }
}

/** DSH 用户主目录（默认 ~/.dsh；DSH_HOME 可覆盖，与官方一致）。 */
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** web profile 目录：官方 web profile 的本地实例（可被 `dsh plugin --profile web` 定制）。 */
function webProfileDir() {
  return path.join(dshHome(), 'profiles', 'web');
}

/**
 * web profile 自愈：`dsh plugin --profile web install` 可能把自定义 bundle 写进
 * ~/.dsh/profiles/web/package.json（常见为 `link:` 指向本地目录，如换机/换盘符后
 * 从别的机器拷来的 dsh-routing-suite）。link 目标不存在时 `dsh web` 直接启动失败：
 *   cannot resolve profile bundle "@dsh-external/xxx" from the dsh installation or <profileDir>
 * DSH 自带的 3 次自动重启也会全部白费（同一份坏配置），表现就是「DSH 页面打不开」。
 * 这里在 spawn 前体检：发现失效 link → 整目录备份后移除，dsh 首次启动会按基线
 * bundle（dsh-base + dsh-web-app）自动重建干净 profile（实测自动重建，无需手动 install）。
 * @returns {{backup?: string, removed?: Array<{name: string, target: string}>}|null}
 */
function repairWebProfile() {
  const dir = webProfileDir();
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch { /* profile 不存在或不可读 → dsh 会自行创建，无需修复 */ return null; }
  const deps = (pkg && pkg.dependencies) || {};
  const broken = [];
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.startsWith('link:')) {
      const target = path.resolve(spec.slice('link:'.length));
      if (!fs.existsSync(target)) broken.push({ name, target });
    }
  }
  if (broken.length === 0) return null;
  const backup = `${dir}.broken-${Date.now().toString(36)}`;
  try {
    fs.renameSync(dir, backup);
  } catch (e) {
    console.warn('[dsh] web profile 自愈失败（无法备份），按原配置启动:', e && e.message);
    return null;
  }
  console.warn(`[dsh] web profile 含失效 link bundle（${broken.map((b) => b.name).join(', ')} → ${broken[0].target}），已备份至 ${backup}，dsh 将重建基线 profile`);
  return { backup, removed: broken };
}

/** 轮询等待 DSH Web UI 就绪。@returns {Promise<boolean>} */
function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve(true);
        else schedule();
      });
      req.on('error', schedule);
      req.on('timeout', () => { req.destroy(); schedule(); });
    };
    const schedule = () => {
      if (Date.now() > deadline) resolve(false);
      else setTimeout(ping, 500);
    };
    ping();
  });
}

/**
 * DSH 引擎使用的模型提供方（默认 deepseek）。
 * 用 HESI_DSH_PROVIDER 覆盖：复用 Hesi「模型服务」页里任意 provider 的 key/baseUrl
 * （openai / anthropic / qwen / glm / kimi / openrouter / nvidia-nim / ollama / lmstudio / vllm…）。
 * 注意：DSH 的 llm-deepseek 适配器带 DeepSeek 专用 thinking 参数，
 * 非 DeepSeek 官方端点是否兼容取决于服务端（OpenAI 兼容端点一般忽略未知字段）。
 */
function getDshProvider() {
  // HESI_DSH_PROVIDER env 优先；否则读取 Hesi「模型服务」页的
  // 用户默认选择 provider（data/llm-providers.json 的 _default）。
  return process.env.HESI_DSH_PROVIDER || getDefaultProvider() || 'deepseek';
}

/**
 * DSH 引擎模型（env HESI_DSH_MODEL 优先，其次 Hesi 该 provider 的已选模型，
 * 最后回退 web 默认 deepseek-v4-flash）。DSH Web UI 内也支持每会话选模型。
 */
function getDshModel(cfg) {
  return process.env.HESI_DSH_MODEL || cfg.model || 'deepseek-v4-flash';
}

/**
 * 当使用自定义模型（非默认 deepseek-v4-flash）时，生成 DSH 模型补丁文件
 * （--patch 覆盖 agent-default-model + llm-deepseek 目录），并返回其路径；
 * 默认模型时返回 null（无需补丁）。
 * 注意：DSH 的 llm-deepseek 适配器按 contextWindow 推算 max_tokens，
 * 第三方端点常有上限（如 Agnes 65536），故显式 maxTokens: 32000。
 * @returns {string|null}
 */
function buildModelPatch() {
  const provider = getDshProvider();
  const model = getDshModel(getConfig(provider));
  if (!model || model === 'deepseek-v4-flash') return null;
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const patchPath = path.join(dataDir, 'dsh-model-patch.yml');
  // 模型名做基础 YAML 转义（防止特殊字符破坏组合文件）
  const safeModel = String(model).replace(/(^['"]|[\n\r])/g, '');
  const content = [
    '# 由 Hesi 生成：DSH 引擎模型补丁（勿手改，Hesi 重启/重启 DSH 时重建）',
    '- id: llm-deepseek',
    '  config:',
    '    models:',
    `      - id: '${safeModel}'`,
    `        name: '${safeModel} (Hesi 配置)'`,
    '        contextWindow: 128000',
    '        maxTokens: 32000',
    '- id: agent-default-model',
    '  config:',
    '    provider: deepseek-official',
    `    model: '${safeModel}'`,
    '',
  ].join('\n');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(patchPath, content, 'utf8');
    return patchPath;
  } catch (e) {
    console.warn('[dsh] 生成模型补丁失败，使用默认模型:', e && e.message);
    return null;
  }
}

const DSH_ROOT_DIR = path.join(__dirname, '..', '..');
/**
 * 本地模式（机主单机部署）判定：项目根存在 `.env.local` 即视为本地模式。
 * 本地模式本就只有一个机主（admin），无多用户隔离需求，
 * 因此允许启动 Phase 1 全局 DSH Web UI 作为「管理窗口」，供机主直接调 DSH 内部
 * 模式 / 插件 / 技能；企业模式（无 .env.local）则保持退役，强制走 Phase 2。
 * @returns {boolean}
 */
function isLocalDshMode() {
  try { return fs.existsSync(path.join(DSH_ROOT_DIR, '.env.local')); } catch { return false; }
}

/** 注入 DSH 子进程所需的 Hesi 配置。@returns {Record<string, string>} */
function buildEnv() {
  const env = { ...process.env };
  // DSH_HOME 由 server.js 启动时的 init() 设置；此处仅做防御性同步（首次调用）。
  if (!env.DSH_HOME) env.DSH_HOME = process.env.DSH_HOME;
  const provider = getDshProvider();
  const cfg = getConfig(provider);
  if (cfg.apiKey) env.DEEPSEEK_API_KEY = cfg.apiKey;
  if (cfg.baseUrl) env.DEEPSEEK_BASE_URL = cfg.baseUrl;
  env.DSH_MODEL = getDshModel(cfg);
  try {
    env.DSH_CWD = getWorkspace();
  } catch { /* ignore */ }
  // 隐私开关：默认关闭 DSH 遥测
  env.DSH_TELEMETRY_DISABLED = '1';
  // 沙箱模式：本地机主管理窗口放行 full-access（可改模式/插件/技能）；
  // 企业模式不会走到这里（start() 已拦截），此分支仅为防守。
  env.DSH_PERMISSION_MODE = isLocalDshMode() ? 'danger-full-access' : 'workspace-write';
  return env;
}

function clearReadyTimer() {
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
}

/**
 * 启动 DSH 引擎（幂等：已在运行则直接返回状态）。
 * @returns {Promise<{ok: boolean, running: boolean, port?: number, version?: string, error?: string}>}
 */
async function start() {
  // Phase 1（DSH Web UI 子进程，--profile web）仅在「本地模式」可用：
  // 它是全局单例、无 per-user 隔离，但本地模式本就单机机主（admin），
  // 机主需要一个能直接调 DSH 内部 模式/插件/技能 的管理窗口。
  // 判定：项目根存在 .env.local（机主单机部署信号）即视为本地模式。
  // 企业模式（无 .env.local）下保持退役，强制走 Phase 2（dsh2，已 per-user 隔离、沙箱受控）。
  if (!isLocalDshMode()) {
    return { ok: false, retired: true, running: false, error: 'Phase 1 DSH Web UI 仅本地模式（.env.local）可用；企业模式请使用 DSH 引擎模式（🐷）' };
  }
  if (proc && proc.exitCode === null) {
    const cfg = getConfig(getDshProvider());
    return { ok: true, running: true, port: actualPort, version: versionCache, provider: getDshProvider(), model: getDshModel(cfg), keyConfigured: !!cfg.apiKey };
  }
  const bin = findDshBin();
  if (!bin) {
    state = 'error';
    lastError = '未找到 dsh 命令（请安装 @deepseek-ai/dsh 或将其加入 PATH）';
    return { ok: false, running: false, error: lastError };
  }
  reclaimOrphanDsh();
  // 坏 profile 会导致 dsh web 无法启动（页面打不开），spawn 前先自愈
  const repaired = repairWebProfile();
  if (repaired) lastError = null; // 自愈后清除旧的失败状态
  const port = await findFreePort(DEFAULT_PORT);
  const cfg0 = getConfig(getDshProvider());
  console.log(`[dsh] 启动 DSH Web UI（provider=${getDshProvider()} model=${getDshModel(cfg0)} keyConfigured=${!!cfg0.apiKey}${cfg0.baseUrl ? ` baseUrl=${cfg0.baseUrl}` : ''}${repaired ? ' · 已修复坏 profile' : ''}）`);
  state = 'starting';
  lastError = null;

  const patchFile = buildModelPatch();
  // 注意：launcher 标志（--profile/--patch）必须在 app 标志（--port）之前；
  // 用 --profile web 而非 web 别名（npm rc.6 的 web 别名不接收 --patch）。
  const args = patchFile
    ? ['--profile', 'web', '--patch', patchFile, '--port', String(port)]
    : ['--profile', 'web', '--port', String(port)];
  const child = spawn(bin, args, {
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', '..'),
    shell: IS_WIN,
  });
  proc = child;
  actualPort = port;
  const spawnT0 = Date.now();

  child.stdout.on('data', (d) => console.log(`[dsh] ${String(d).trimEnd()}`));
  child.stderr.on('data', (d) => console.warn(`[dsh] ${String(d).trimEnd()}`));
  child.on('error', (err) => {
    lastError = err.message;
    console.error('[dsh] spawn error:', err.message);
  });
  child.on('exit', (code, signal) => {
    const wasRunning = state === 'running' || state === 'starting';
    proc = null;
    actualPort = 0;
    clearReadyTimer();
    if (state === 'stopping') {
      state = 'stopped';
      return;
    }
    // 启动早期（还没进入 running）就崩溃：大概率是 profile/依赖问题。
    // 先做一次自愈（坏 profile → 备份重建），自愈成功则不消耗重启次数、立即重试；
    // 避免 40s 就绪超时 + 3 次同配置重启全部白等，表现就是「DSH 页面打不开」。
    const crashedEarly = state === 'starting' && (Date.now() - spawnT0) < 15_000;
    const repairedEarly = crashedEarly ? repairWebProfile() : null;
    state = 'stopped';
    if (wasRunning) {
      const stable = Date.now() - stableSince > 30_000;
      if (stable) restartCount = 0;
      if (repairedEarly) {
        restartCount = Math.max(0, restartCount - 1);
        console.warn('[dsh] 启动早期崩溃，已重建 web profile，立即重试一次');
        setTimeout(() => { start().catch(() => {}); }, 500);
      } else if (restartCount < MAX_RESTART_ATTEMPTS) {
        restartCount += 1;
        console.warn(`[dsh] 进程退出 (code=${code} signal=${signal})，${RESTART_BACKOFF_MS}ms 后自动重启 (${restartCount}/${MAX_RESTART_ATTEMPTS})`);
        setTimeout(() => { start().catch(() => {}); }, RESTART_BACKOFF_MS);
      } else {
        state = 'error';
        lastError = `DSH 进程连续异常退出（最近 code=${code} signal=${signal}）`;
        console.error(`[dsh] ${lastError}`);
      }
    }
  });

  const ready = await waitReady(port, READY_TIMEOUT_MS);
  if (!ready) {
    state = 'error';
    lastError = `DSH Web UI 在 ${READY_TIMEOUT_MS / 1000}s 内未就绪（端口 ${port}）`;
    console.error(`[dsh] ${lastError}`);
    return { ok: false, running: false, port, error: lastError };
  }
  state = 'running';
  stableSince = Date.now();
  const version = await getVersion(bin);
  const cfg = getConfig(getDshProvider());
  return { ok: true, running: true, port, version, provider: getDshProvider(), model: getDshModel(cfg), keyConfigured: !!cfg.apiKey };
}

/**
 * 杀 dsh 进程树。Windows 下 spawn 走 cmd shim（child.pid 是 cmd.exe），
 * 只杀它 node 会变孤儿继续占端口 —— 必须 taskkill /T 连整棵树一起杀。
 * POSIX 直接杀子进程（dsh 本体即 node 进程）。
 */
function killDshTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) { /* 已退出则忽略 */ }
}

/** 停止 DSH 引擎。@returns {Promise<void>} */
function stop() {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) {
      state = 'stopped';
      proc = null;
      actualPort = 0;
      resolve();
      return;
    }
    state = 'stopping';
    const child = proc;
    const killer = setTimeout(() => {
      if (child.exitCode === null) killDshTree(child.pid);
    }, 5_000);
    child.once('exit', () => { clearTimeout(killer); resolve(); });
    killDshTree(child.pid);
  });
}

/** 重启 DSH 引擎。@returns {Promise<object>} */
async function restart() {
  await stop();
  return start();
}

/** 获取引擎状态。@returns {Promise<object>} */
async function getStatus() {
  const bin = findDshBin();
  const running = !!(proc && proc.exitCode === null);
  const provider = getDshProvider();
  const cfg = getConfig(provider);
  return {
    available: !!bin,
    dshBin: bin,
    running,
    state,
    port: running ? actualPort : 0,
    version: versionCache || (bin ? await getVersion(bin) : null),
    provider,
    model: getDshModel(cfg),
    keyConfigured: !!cfg.apiKey,
    baseUrl: cfg.baseUrl || null,
    error: lastError,
    restartCount,
  };
}

/** 同步取当前实际端口（代理中间件用；未运行返回 0）。@returns {number} */
function getActualPort() {
  return state === 'running' ? actualPort : 0;
}

module.exports = { start, stop, restart, getStatus, getActualPort, findDshBin, DEFAULT_PORT };
