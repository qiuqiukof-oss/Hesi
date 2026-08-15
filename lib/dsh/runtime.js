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

const { getConfig } = require('../llm-provider/provider-config');
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

/** 定位 dsh 可执行文件：Hesi 自带依赖 → 系统全局 → null。 */
function findDshBin() {
  const own = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'dsh');
  try {
    if (fs.existsSync(own)) return own;
  } catch { /* ignore */ }
  try {
    const found = execFileSync('command -v dsh', { shell: true, encoding: 'utf8' }).trim();
    if (found) return found;
  } catch { /* not found */ }
  return null;
}

/** 取 DSH 版本（带缓存）。@returns {Promise<string>} */
async function getVersion(bin) {
  if (versionCache) return versionCache;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

/** 查询监听指定端口的进程 PID（Linux ss）。@param {number} port @returns {number|null} */
function pidListeningOn(port) {
  try {
    const out = execFileSync('ss', ['-tlnp'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const m = line.match(/pid=(\d+)/);
      if (m) return Number(m[1]);
    }
  } catch { /* ss 不可用则跳过 */ }
  return null;
}

/** 同步睡眠（等待端口释放）。@param {number} ms */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

/**
 * 回收孤儿 dsh web 进程：Hesi 异常退出时其 dsh 子进程可能残留并占用
 * DEFAULT_PORT（且带着旧配置）。启动前若发现该端口被 dsh 占用则先回收，
 * 保证端口稳定、配置最新。
 */
function reclaimOrphanDsh() {
  const pid = pidListeningOn(DEFAULT_PORT);
  if (!pid) return;
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    if (!cmd.includes('dsh') || !cmd.includes('web')) return; // 被其它程序占用，不碰
    console.warn(`[dsh] 回收孤儿 dsh 进程 (pid=${pid})，释放端口 ${DEFAULT_PORT}`);
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (pidListeningOn(DEFAULT_PORT) === null) return;
      sleepSync(200);
    }
  } catch { /* 无权限或已退出，忽略 */ }
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
  return process.env.HESI_DSH_PROVIDER || 'deepseek';
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

/** 注入 DSH 子进程所需的 Hesi 配置。@returns {Record<string, string>} */
function buildEnv() {
  const env = { ...process.env };
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
  const port = await findFreePort(DEFAULT_PORT);
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
  });
  proc = child;
  actualPort = port;

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
    state = 'stopped';
    if (wasRunning) {
      const stable = Date.now() - stableSince > 30_000;
      if (stable) restartCount = 0;
      if (restartCount < MAX_RESTART_ATTEMPTS) {
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
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => { clearTimeout(killer); resolve(); });
    child.kill('SIGTERM');
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

module.exports = { start, stop, restart, getStatus, findDshBin, DEFAULT_PORT };
