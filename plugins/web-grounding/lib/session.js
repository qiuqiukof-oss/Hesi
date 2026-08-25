/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// session.js — 常驻浏览器会话（CDP 文本抽取）
//
// 设计要点：
//   - 自持一个「独立、隔离」的 headless Edge 进程（专属端口 9223 + 专属 profile），
//     不复用 Hesi 的 9222 浏览器 —— 避免与 Hesi 看门狗/其它实例争用 9222 导致的
//     ws 1006 断链 / ECONNREFUSED 竞态（实测反复出现，已弃用共享方案）。
//   - 仍用「本机 Edge 二进制 + 本机网络出口 + 本机默认搜索引擎」
//     （默认引擎由 engine.js 读 Edge Preferences 决定，与本进程无关）。
//   - 浏览器进程常驻（模块级 _wgProc + 一个 CDP 连接），**每次 read 独立
//     context+page**（用完即关）：天然并发隔离 —— 并发调用各用各的 page，
//     无页面劫持/导航冲突；Chromium 单进程可承载数十 tab，浏览器仍只常驻一个。
//   - 并发上限信号量（默认 8，env HESI_WG_MAX_CONCURRENCY 可调）：防 tab 失控、
//     防爬虫特征。超出排队，不报错。
//   - 只抽 innerText / 链接，**绝不截图、绝不走视觉识别**。
//   - 关闭时只关自己的 worker context，不杀共享浏览器进程
//     （connectOverCDP 的 browser.close() 会把共享浏览器一起断开，故刻意不调）。
//
// 健壮性：
//   - ensure() 用 init-promise 记忆化：冷启动并发调用只执行一次
//     launchOwnBrowser + connectOverCDP（消除重入竞态）。
//   - read() 对"连接断开类"错误自动重置会话并重试，非连接类错误（如导航超时）直接上抛。
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const { findBrowser } = require('./find-browser');
const { extractPage } = require('./extract-content');

const ROOT = path.join(__dirname, '..');
const WG_CDP_PORT = Number(process.env.HESI_WG_CDP_PORT) || 9223;
const WG_CDP_URL = `http://127.0.0.1:${WG_CDP_PORT}`;
const WG_PROFILE_DIR = process.env.HESI_WG_PROFILE_DIR || path.join(ROOT, 'data', 'web-grounding-profile');
// 并发上限：同一时刻最多 N 个 in-flight read（超出排队）。
// 默认 4：资源（每 tab ~100MB）与反爬（风控看并发标签）双平衡；需要再调。
const WG_MAX_CONCURRENCY = Number(process.env.HESI_WG_MAX_CONCURRENCY) || 4;
// 空闲回收：N ms 无请求则停浏览器进程（下次懒启动），默认 30min；设 0 禁用
const WG_IDLE_MS = Number(process.env.HESI_WG_IDLE_MS) || 30 * 60 * 1000;
// 会话 cookie 持久化文件（模拟老用户，降低风控；仅存 SERP 域 cookie）
const COOKIE_FILE = process.env.HESI_WG_COOKIE_FILE || path.join(ROOT, 'data', 'cookies.json');
// context 拟人化参数（降低 headless 指纹特征；UA 由 connectOverCDP 继承真实浏览器，不需设）
const CONTEXT_OPTS = {
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  colorScheme: 'light',
  viewport: { width: 1366, height: 768 },
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
};

// 空闲回收检查（低频，unref 不阻塞退出）
let _lastUsedAt = Date.now();
function touch() { _lastUsedAt = Date.now(); }
if (WG_IDLE_MS > 0) {
  const _idleTimer = setInterval(() => {
    if (_wgProc && _wgProc.exitCode == null && Date.now() - _lastUsedAt > WG_IDLE_MS) {
      stopOwnBrowser();
      if (_session) _session._resetConn();
    }
  }, 60_000);
  if (typeof _idleTimer.unref === 'function') _idleTimer.unref();
}

// ── 并发信号量（模块级，全 session 共享）──────────────────────────
let _inflight = 0;
const _waiters = [];
async function acquireSlot() {
  if (_inflight < WG_MAX_CONCURRENCY) {
    _inflight += 1;
    return releaseSlot;
  }
  await new Promise((resolve) => {
    _waiters.push(() => { _inflight += 1; resolve(); });
  });
  return releaseSlot;
}
function releaseSlot() {
  _inflight -= 1;
  while (_waiters.length > 0 && _inflight < WG_MAX_CONCURRENCY) {
    const w = _waiters.shift();
    w();
  }
}

let _pwChromium = null;
function getChromium() {
  if (_pwChromium) return _pwChromium;
  let pw;
  try {
    pw = require('playwright');
  } catch (e) {
    throw new Error('Playwright 未安装，web-grounding 无法连接浏览器（需 npm install playwright）');
  }
  _pwChromium = pw.chromium;
  return _pwChromium;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function probePort(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 1200 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

// 连接断开类错误特征（ws 1006 / Target/Browser closed / 连接中断 / 端口拒绝）
const CONN_ERR_RE = /1006|disconnect|closed|Connection (?:reset|closed)|socket hang|Browser.*closed|Target.*closed|ECONNREFUSED/i;
function isConnError(err) {
  return !!err && CONN_ERR_RE.test(err.message || String(err));
}

// 自持浏览器进程（模块级，常驻）
let _wgProc = null;

async function launchOwnBrowser(attempts = 3) {
  const exe = findBrowser();
  if (!exe) throw new Error('未找到本机 Chrome/Edge，web-grounding 无法启动浏览器');

  for (let i = 0; i < attempts; i++) {
    // 端口被占用则先清空专属 profile 再试（避免上次异常残留）
    if (i > 0) {
      try { fs.rmSync(WG_PROFILE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    try { fs.mkdirSync(WG_PROFILE_DIR, { recursive: true }); } catch { /* ignore */ }
    // 启动前清理浏览器磁盘缓存（防 profile 无限膨胀），保留 Preferences/cookies
    for (const sub of ['Cache', 'Code Cache', 'GPUCache', 'Service Worker']) {
      try { fs.rmSync(path.join(WG_PROFILE_DIR, sub), { recursive: true, force: true }); } catch { /* ignore */ }
    }

    const args = [
      `--remote-debugging-port=${WG_CDP_PORT}`,
      `--user-data-dir=${WG_PROFILE_DIR}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-gpu',
      '--mute-audio',
      // 磁盘缓存上限（100MB 磁盘 / 10MB 媒体），防资源失控
      '--disk-cache-size=104857600',
      '--media-cache-size=10485760',
      'about:blank',
    ];
    const proc = spawn(exe, args, { stdio: 'ignore' });
    proc.on('exit', () => { if (_wgProc === proc) _wgProc = null; });
    proc.on('error', () => { if (_wgProc === proc) _wgProc = null; });
    _wgProc = proc;

    // 等待端口就绪（最多 15s）
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await probePort(WG_CDP_PORT)) { ready = true; break; }
      await sleep(300);
    }
    if (ready) return proc;
    // 未就绪：杀掉这个失败的子进程，下一轮重试
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(800);
  }
  throw new Error('web-grounding 浏览器在多次尝试后仍无法就绪（端口可能被占用或 Edge 启动失败）');
}

// ── cookie 持久化（模拟老用户，降低风控判定）────────────────────
async function loadCookies(ctx) {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    const cookies = (data && Array.isArray(data.cookies) && data.cookies) || [];
    if (cookies.length) await ctx.addCookies(cookies);
  } catch { /* 无 cookie 或损坏：忽略，按新访客处理 */ }
}
async function saveCookies(ctx) {
  try {
    const state = await ctx.storageState();
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(state));
  } catch { /* 写失败不阻断主流程 */ }
}

class GroundingSession {
  constructor() {
    this.browser = null; // Playwright Browser（connectOverCDP，常驻）
    this._initPromise = null; // init 记忆化：冷启动并发只执行一次
    this.ready = false;
  }

  /** 重置连接状态（断链后重试 / 显式关闭时） */
  _resetConn() {
    this.browser = null;
    this._initPromise = null;
    this.ready = false;
  }

  /**
   * 确保浏览器进程 + CDP 连接就绪（init-promise 记忆化）。
   * @returns {Promise<Browser>} Playwright Browser
   */
  ensure() {
    if (this.ready && this.browser && this.browser.isConnected()) {
      return Promise.resolve(this.browser);
    }
    if (!this._initPromise) {
      this._initPromise = this._doEnsure().catch((err) => {
        this._initPromise = null; // 失败允许下次重试
        this.ready = false;
        throw err;
      });
    }
    return this._initPromise;
  }

  async _doEnsure() {
    // 1) 自持浏览器（独立端口 9223 + 专属 profile）
    if (!_wgProc || _wgProc.exitCode != null) {
      await launchOwnBrowser();
    }
    // 2) 独立 CDP 客户端连自持浏览器（带超时+重试，吸收瞬时握手失败）
    const chromium = getChromium();
    this.browser = await chromium.connectOverCDP(WG_CDP_URL, { timeout: 8000 });
    this.ready = true;
    return this.browser;
  }

  /**
   * 内容感知等待：搜索结果/正文多为异步渲染，load 事件后仍需等 DOM 注入。
   * 判定条件（覆盖任意引擎的异步渲染，受 budget 上限保护）：
   *   - search：结果块数量 >= 2（Bing/Google 的 #b_results/.g 已渲染）即算就绪；
   *   - 通用：body 文本长度连续两轮不变（稳定态）且超过阈值。
   * 单阈值不够稳——页面壳 HTML 本身就能超过阈值，导致结果未注入就提前结算。
   * @param {import('playwright').Page} page 本次调用独立 page
   */
  async settlePage(page, mode, budget = 8000) {
    // 等待节奏加随机 jitter：固定节奏可被风控识别为自动化
    const minWait = Math.floor(400 + Math.random() * 300);
    const deadline = Date.now() + budget;
    await page.waitForTimeout(minWait);
    let prevLen = -1;
    let stableRounds = 0;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate((m) => {
          const len = document.body ? document.body.innerText.length : 0;
          let blocks = 0;
          if (m === 'search') {
            blocks = document.querySelectorAll('#b_results .b_algo, #search .g, [id*="result"] li').length;
          }
          return { len, blocks };
        }, mode)
        .catch(() => ({ len: 0, blocks: 0 }));
      if (mode === 'search' && state.blocks >= 2) return; // 结果块已注入
      const threshold = mode === 'search' ? 300 : 150;
      if (state.len >= threshold && state.len === prevLen) {
        stableRounds += 1;
        if (stableRounds >= 2) return; // 文本两轮不变 → 渲染稳定
      } else {
        stableRounds = 0;
      }
      prevLen = state.len;
      await page.waitForTimeout(Math.floor(300 + Math.random() * 200));
    }
  }

  /**
   * 导航到 target 并抽取页面文本 —— 每次调用独立 context+page（真并发、天然隔离）。
   * 对"连接断开类"错误自动重置并重试（吸收瞬时断链），其余错误上抛。
   * @param {string} url 已解析好的目标 URL
   * @param {object} [opts] { waitUntil, timeout, mode, settleBudget }
   */
  async read(url, opts = {}) {
    touch(); // 空闲回收计时
    const release = await acquireSlot();
    try {
      return await this._read(url, opts);
    } finally {
      release();
    }
  }

  async _read(url, opts = {}) {
    const maxAttempts = 2;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let ctx = null;
      try {
        const browser = await this.ensure();
        // 每次调用独立 context + page（并发互不干扰），带拟人化参数 + 会话 cookie
        ctx = await browser.newContext(CONTEXT_OPTS);
        await loadCookies(ctx);
        const page = await ctx.newPage();
        const waitUntil = opts.waitUntil || 'domcontentloaded';
        const timeout = opts.timeout || 20000;
        const budget = opts.settleBudget || 8000;
        await page.goto(url, { waitUntil, timeout });
        await this.settlePage(page, opts.mode || 'search', budget);
        const data = await extractPage(page, opts.mode || 'search');
        // 成功路径回存 cookie（模拟老用户持续积累）
        await saveCookies(ctx).catch(() => {});
        await ctx.close().catch(() => {});
        ctx = null;
        return data;
      } catch (e) {
        lastErr = e;
        if (ctx) { try { await ctx.close(); } catch { /* ignore */ } }
        if (!isConnError(e)) throw e; // 非连接类错误（导航超时等）不重试
        // 断链：重置连接，退避后由下一次 attempt 的 ensure() 重建
        this._resetConn();
        await sleep(800);
      }
    }
    throw lastErr;
  }

  /** 断开 CDP 连接（不杀自持浏览器；进程随服务退出由 stopOwnBrowser 清理） */
  async close() {
    this._resetConn();
    // 刻意不调用 this.browser.close()：保留自持浏览器常驻复用
  }
}

/** 停止自持浏览器（服务退出时调用，防孤儿进程） */
function stopOwnBrowser() {
  const proc = _wgProc;
  _wgProc = null;
  if (proc && proc.pid && proc.exitCode == null) {
    try { proc.kill(); } catch { /* ignore */ }
    if (process.platform === 'win32') {
      try { require('child_process').execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    }
  }
}

// 模块级单例（常驻）
let _session = null;
function getSession() {
  if (!_session) _session = new GroundingSession();
  return _session;
}

module.exports = { GroundingSession, getSession, stopOwnBrowser, WG_CDP_URL, WG_CDP_PORT, WG_MAX_CONCURRENCY };
