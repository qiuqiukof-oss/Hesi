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
//   - 自己持有「专属 worker context + page」，**常驻不关**，跨调用复用，
//     满足"浏览器不关闭"；且是独立 context，绝不碰 Hesi 管理页（context 0）。
//   - 只抽 innerText / 链接，**绝不截图、绝不走视觉识别**。
//   - 关闭时只关自己的 worker context，不杀共享浏览器进程
//     （connectOverCDP 的 browser.close() 会把共享浏览器一起断开，故刻意不调）。
//
// 健壮性：
//   - 启动带超时+重试（吸收首启慢/偶发失败）。
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

    const args = [
      `--remote-debugging-port=${WG_CDP_PORT}`,
      `--user-data-dir=${WG_PROFILE_DIR}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows',
      '--disable-gpu',
      '--mute-audio',
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

class GroundingSession {
  constructor() {
    this.browser = null; // Playwright Browser（connectOverCDP）
    this.context = null; // 专属 worker context（隔离，不碰 context 0）
    this.page = null;
    this.ready = false;
  }

  /** 重置悬挂状态（用于断链后重试） */
  _reset() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ready = false;
  }

  /** 确保浏览器就绪并持有常驻 worker 页 */
  async ensure() {
    if (this.ready && this.page && !this.page.isClosed() && this.browser && this.browser.isConnected()) {
      return this;
    }
    this._reset();

    // 1) 自持浏览器（独立端口 9223 + 专属 profile）
    if (!_wgProc || _wgProc.exitCode != null) {
      await launchOwnBrowser();
    }

    // 2) 独立 CDP 客户端连自持浏览器（带超时+重试，吸收瞬时握手失败）
    const chromium = getChromium();
    this.browser = await chromium.connectOverCDP(WG_CDP_URL, { timeout: 8000 });

    // 3) 专属常驻 worker context + page（隔离于 Hesi 管理页）
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.ready = true;
    return this;
  }

  /**
   * 内容感知等待：搜索结果/正文多为异步渲染，load 事件后仍需等 DOM 注入。
   * 判定条件（覆盖任意引擎的异步渲染，受 budget 上限保护）：
   *   - search：结果块数量 >= 2（Bing/Google 的 #b_results/.g 已渲染）即算就绪；
   *   - 通用：body 文本长度连续两轮不变（稳定态）且超过阈值。
   * 单阈值不够稳——页面壳 HTML 本身就能超过阈值，导致结果未注入就提前结算。
   */
  async settlePage(mode) {
    const minWait = 400;
    const budget = Date.now() + (this._settleBudget || 8000);
    await this.page.waitForTimeout(minWait);
    let prevLen = -1;
    let stableRounds = 0;
    while (Date.now() < budget) {
      const state = await this.page
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
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * 导航到 target 并抽取页面文本。
   * 对"连接断开类"错误自动重置并重试（吸收瞬时断链），其余错误上抛。
   * @param {string} url 已解析好的目标 URL
   * @param {object} [opts] { waitUntil, timeout, mode, settleBudget }
   */
  async read(url, opts = {}) {
    const maxAttempts = 2;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.ensure();
        this._settleBudget = opts.settleBudget || 8000;
        const waitUntil = opts.waitUntil || 'domcontentloaded';
        const timeout = opts.timeout || 20000;
        await this.page.goto(url, { waitUntil, timeout });
        await this.settlePage(opts.mode || 'search');
        // 页内一次 evaluate 完成抽取（search/fetch 双逻辑，默认降噪）
        const data = await extractPage(this.page, opts.mode || 'search');
        return data;
      } catch (e) {
        lastErr = e;
        if (!isConnError(e)) throw e; // 非连接类错误（导航超时等）不重试
        // 断链：重置会话，退避后由下一次 attempt 的 ensure() 重建
        this._reset();
        await sleep(800);
      }
    }
    throw lastErr;
  }

  /** 关闭专属 worker context（不杀自持浏览器；进程随服务退出由 stopOwnBrowser 清理） */
  async close() {
    try { await this.context?.close(); } catch { /* already gone */ }
    this.context = null;
    this.page = null;
    this.ready = false;
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

module.exports = { GroundingSession, getSession, stopOwnBrowser, WG_CDP_URL, WG_CDP_PORT };
