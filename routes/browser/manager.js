/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// BrowserManager — single instance managing CDP connection lifecycle.
//
// Extracted from routes/browser.js so route files can share one instance
// without browser.js becoming a 1900-line god file.
// ============================================================
const { getEnabledScripts, matchesUrlPattern } = require('../browser-scripts');

/**
 * Lazily load Playwright's chromium.
 * Playwright is now an OPTIONAL dependency — if it isn't installed, browser
 * features fail with a clear error at call time instead of crashing server
 * startup (which a top-level `require('playwright')` would do).
 * @returns {import('playwright').Chromium}
 */
function getChromium() {
  let pw;
  try {
    pw = require('playwright');
  } catch (e) {
    throw new Error('Playwright is not installed. Run `npm install playwright` to enable browser automation features.');
  }
  return pw.chromium;
}

class BrowserManager {
  constructor() {
    this.browser = null;
    this.cdpUrl = DEFAULT_CDP_URL;
    this.connected = false;
    this.retries = 0;
    this.healthTimer = null;
    this._pagesCache = [];
    this.networkMonitoring = false;
  }

  /**
   * 连接到已有的 Edge/Chrome 实例 (CDP)
   * @param {string} [cdpUrl] - CDP 端点 URL，默认 http://127.0.0.1:9222
   */
  async connect(cdpUrl) {
    const url = cdpUrl || DEFAULT_CDP_URL;
    this.cdpUrl = url;
    this.retries = 0; // 每次真正发起连接都重置计数，避免失败路径堆积导致永久死锁

    // 先试探 CDP 端点是否存活
    try {
      const probe = await fetch(`${url}/json/version`).catch(() => null);
      if (!probe || !probe.ok) {
        throw new Error(`CDP endpoint ${url} 无响应。请确保 Edge/Chrome 已用 --remote-debugging-port=9222 启动`);
      }
    } catch (err) {
      if (err.message.includes('CDP endpoint')) throw err;
      throw new Error(`无法连接到 ${url} — ${err.message}。请确认 Edge/Chrome 已开启远程调试端口`);
    }

    // 通过 CDP 连接
    this.browser = await getChromium().connectOverCDP(url);
    this.connected = true;
    this.retries = 0;

    // 注入隐身脚本 (隐藏自动化特征)
    await this._applyStealth();

    // 注入用户启用的浏览器脚本
    await this._applyUserScripts();

    // 启动健康检查
    this._startHealthCheck();

    // 返回摘要信息
    const pages = this.browser.contexts()[0]?.pages() || [];
    const tabs = pages.map((p, i) => ({
      index: i,
      url: p.url(),
      title: p.url().startsWith('about:') ? '(new tab)' : '',
    }));

    return {
      connected: true,
      browser: this.browser.version() || 'unknown',
      tabs,
      tabCount: tabs.length,
    };
  }

  /**
   * 确保 CDP 连接有效，断开时自动重连
   */
  async ensureConnected() {
    if (this.browser && this.connected && this.browser.isConnected()) {
      return true;
    }

    const isFirstConnect = !this.browser && !this.connected;
    if (!isFirstConnect && this.retries >= MAX_RETRIES) {
      throw new Error(`CDP 重连失败（已重试 ${MAX_RETRIES} 次），请检查浏览器是否仍在运行`);
    }

    const delay = isFirstConnect ? 0 : Math.min(1000 * Math.pow(2, this.retries), 60000);
    this.retries++;

    // 清理旧连接
    try { await this.browser?.close(); } catch (e) { console.warn('[Browser] cleanup error on retry:', e?.message); }

    // 等待后重试（首连不延迟）
    await new Promise(r => setTimeout(r, delay));
    await this.connect(this.cdpUrl);
    return true;
  }

  /**
   * 获取当前活跃页面（用户最后交互的那个 tab）
   * 优先使用浏览器农场设置的 _activeContext
   */
  async getActivePage() {
    await this.ensureConnected();

    // 检查是否有农场会话上下文
    const targetContext = this._activeContext || this.browser.contexts()[0];
    if (!targetContext) throw new Error('浏览器无可用上下文');

    const pages = targetContext.pages();
    if (pages.length === 0) throw new Error('浏览器没有打开的 tab');

    // 返回第一个非 about:blank 的页面，或第一个页面
    const activePage = pages.find(p => !p.url().startsWith('about:')) || pages[0];
    return activePage;
  }

  /**
   * 获取活跃页面的状态快照
   */
  async getPageState(page) {
    try {
      const url = page.url();
      const title = await page.title().catch(() => '');
      const ready = await page.evaluate(() => document.readyState === 'complete').catch(() => false);
      return { url, title, ready };
    } catch {
      return { url: 'unknown', title: '页面不可访问', ready: false };
    }
  }

  /**
   * 断开 CDP 连接并清理
   */
  async disconnect() {
    this._stopHealthCheck();
    try {
      await this.browser?.close();
    } catch (e) { console.warn('[Browser] disconnect error:', e?.message); }
    this.browser = null;
    this.connected = false;
    this.networkMonitoring = false;
  }

  /** 当前网络监控是否处于激活状态（前端轮询用） */
  getNetworkMonitoring() {
    return this.networkMonitoring;
  }

  /**
   * 启动健康检查定时器
   */
  _startHealthCheck() {
    this._stopHealthCheck();
    this.healthTimer = setInterval(async () => {
      try {
        const probe = await fetch(`${this.cdpUrl}/json/version`).catch(() => null);
        if (!probe || !probe.ok) {
          console.log('[Browser] 健康检查：CDP 端点无响应，尝试重连...');
          this.connected = false;
          await this.ensureConnected().catch(() => {});
        }
      } catch {
        // 静默，下次检查再说
      }
    }, HEALTH_CHECK_INTERVAL);
    this.healthTimer.unref(); // Don't prevent process exit
  }

  _stopHealthCheck() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /**
   * 注入隐身脚本：隐藏 Playwright/CDP 自动化特征
   */
  async _applyStealth() {
    const context = this.browser.contexts()[0];
    if (!context) return;

    await context.addInitScript(() => {
      // 隐藏 webdriver 标记
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      // 伪装 plugins 长度（自动化浏览器通常为 0）
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // 伪装 languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      });
      // 覆盖 chrome.runtime 检测
      if (window.chrome) {
        window.chrome.runtime = window.chrome.runtime || {};
      }
    });
  }

  /**
   * 注入用户启用的浏览器脚本（用户脚本系统）。
   * 使用 context.addInitScript() 注入，所有启用的脚本在页面创建时自动执行。
   *
   * 注意：
   * - Playwright 的 context.addInitScript() 固定为 document-start 执行，不支持 runAt 参数
   * - URL 匹配需要在脚本内部自行判断（如 if (location.href.includes(...))）
   * - 脚本对所有已存在和新创建的页面生效
   * - 对于连接时已有的标签页，脚本在下次页面导航时触发
   */
  async _applyUserScripts() {
    const context = this.browser.contexts()[0];
    if (!context) return;

    const scripts = getEnabledScripts();
    if (scripts.length === 0) return;

    for (const script of scripts) {
      try {
        // 包裹脚本：添加自执行 URL 匹配包装
        // 这样脚本只在其匹配的 URL 上执行，不影响其他页面
        const wrappedCode = `
(function() {
  // Auto-generated wrapper for user script "${script.name}"
  // URL pattern: ${script.urlPattern}
  if (!${matchesUrlPattern.toString()}("${script.urlPattern.replace(/"/g, '\\"')}", location.href)) return;
  ${script.code}
})();
`;
        await context.addInitScript(wrappedCode);
        console.log(`[BrowserScripts] Injected "${script.name}" (pattern: ${script.urlPattern})`);
      } catch (err) {
        console.warn(`[BrowserScripts] Failed to inject "${script.name}": ${err.message}`);
      }
    }

    if (scripts.length > 0) {
      console.log(`[BrowserScripts] Applied ${scripts.length} user script(s)`);
    }
  }
}

// 从 helpers.js 引入配置常量（避免循环依赖副作用，常量均为字面量）
const { DEFAULT_CDP_URL, MAX_RETRIES, HEALTH_CHECK_INTERVAL } = require('./helpers');

// ── 全局单例 ──
const browserManager = new BrowserManager();

module.exports = { BrowserManager, browserManager };
