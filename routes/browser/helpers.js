/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser route helpers + shared config constants.
//
// Config constants live here so every sub-router can import them by the
// same names used in the original monolithic routes/browser.js (keeping the
// extracted route handlers byte-for-byte identical). The BrowserManager
// singleton is imported lazily inside buildResponse to avoid a load-time
// circular dependency between this file and manager.js.
// ============================================================

// ── 配置 ──
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const MAX_RETRIES = 10;
const NAVIGATE_TIMEOUT = 30000;
const LOCATOR_TIMEOUT = 10000;
const HEALTH_CHECK_INTERVAL = 30000;
const SCREENSHOT_MAX_WIDTH = 1280;
const MAX_TYPE_LENGTH = 1000;
const MAX_TEXT_LENGTH = 8000;

// ── 允许的 URL 协议白名单 ──
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

// ── 禁止导航的目标（精确 hostname + path 匹配，防止 includes 绕过） ──
const BLOCKED_URL_PATTERNS = [
  { hostname: 'chrome.google.com', pathPrefix: '/webstore' },
];

/**
 * Sanitize strings by redacting sensitive info (API keys, tokens).
 * @param {string} str
 * @returns {string}
 */
function sanitizeString(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/(sk-[A-Za-z0-9]{10,})/g, 'sk-***REDACTED***')
    .replace(/([A-Za-z0-9+/=]{40,})/g, '***REDACTED***');
}

/**
 * Validate URL safety (protocol whitelist, blocked patterns, length limits).
 * @param {string} url
 * @returns {{valid:boolean, error?:string, url?:string}}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 不能为空' };
  }

  // 限制最大长度
  if (url.length > 2048) {
    return { valid: false, error: 'URL 过长（最大 2048 字符）' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: `URL 格式无效: ${url}` };
  }

  // 协议白名单
  if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, error: `不允许的协议: ${parsed.protocol}（仅允许 http/https）` };
  }

  // 禁止导航（精确 hostname + path 前缀匹配）
  for (const { hostname, pathPrefix } of BLOCKED_URL_PATTERNS) {
    if (parsed.hostname === hostname && parsed.pathname.startsWith(pathPrefix)) {
      return { valid: false, error: `不允许导航到受限制的地址: ${hostname}${pathPrefix}` };
    }
  }

  return { valid: true, url: parsed.href };
}

/**
 * Build standard response (page state + screenshot).
 * @param {import('playwright').Page} page
 * @param {object} [extra]
 * @returns {Promise<object>}
 */
async function buildResponse(page, extra = {}) {
  // Lazy require to avoid a load-time circular dependency with manager.js
  const { browserManager } = require('./manager');

  const state = await browserManager.getPageState(page);

  // 轻量截图（缩略图，用于 AI 视觉分析）
  let screenshot = null;
  try {
    screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 60,
      fullPage: false,
    }).then(buf => buf.toString('base64')).catch(() => null);
  } catch (e) { console.debug('[Browser] screenshot capture error:', e?.message); }

  const response = {
    success: true,
    ...state,
    screenshot, // base64 JPEG 缩略图
    tabCount: browserManager.browser?.contexts()[0]?.pages().length || 0,
    ...extra,
  };

  return response;
}

/**
 * Capture screenshot before destructive action (audit).
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function captureBeforeAction(page) {
  try {
    return await page.screenshot({ type: 'jpeg', quality: 40 }).then(buf => buf.toString('base64'));
  } catch {
    return null;
  }
}

/**
 * 检测当前页面 URL 是否为 Hesi 管理页面（即 agent 自身的宿主页面）。
 * Hesi 默认监听端口由 lib/port.js 单一事实源管理（默认 4264），也可通过 PORT 环境变量修改。
 * @param {string} pageUrl - 页面 URL 字符串
 * @returns {boolean}
 */
function isCLIQPageUrl(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return false;
  try {
    const parsed = new URL(pageUrl);
    // Hesi 页面特征：localhost/127.0.0.1 且端口匹配 getPort()
    const { getPort } = require('../../lib/port');
    const cliqPort = getPort();
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (isLocalhost && parsed.port === String(cliqPort)) return true;
    // loopback 地址 + 端口号匹配足以确定是 Hesi 管理页面，无需额外 hostname 关键词匹配
    return false;
  } catch {
    return false;
  }
}

/**
 * 检查页面是否在 Hesi 默认上下文（context index 0）中。
 * 默认上下文包含 Hesi 管理页面，对其进行操作会导致 CDP 断开。
 * @param {import('playwright').Page} page
 * @returns {Promise<{isCLIQ: boolean, message?: string}>}
 */
async function checkCLIQPage(page) {
  if (!page) return { isCLIQ: false };
  try {
    const pageUrl = page.url();
    if (isCLIQPageUrl(pageUrl)) {
      return {
        isCLIQ: true,
        message: `当前在 Hesi 管理页面（${pageUrl}）上操作，该页面是 CDP 连接的宿主页面。对其进行导航/点击/输入等操作会导致 CDP 断开连接，所有浏览器能力将不可用！\n请改用 browser_farm_create 创建新的隔离浏览器会话，然后在新会话中进行操作。`,
      };
    }
    return { isCLIQ: false };
  } catch {
    return { isCLIQ: false };
  }
}

module.exports = {
  DEFAULT_CDP_URL, MAX_RETRIES, NAVIGATE_TIMEOUT, LOCATOR_TIMEOUT, HEALTH_CHECK_INTERVAL,
  SCREENSHOT_MAX_WIDTH, MAX_TYPE_LENGTH, MAX_TEXT_LENGTH, ALLOWED_URL_PROTOCOLS, BLOCKED_URL_PATTERNS,
  sanitizeString, validateUrl, buildResponse, captureBeforeAction,
  isCLIQPageUrl, checkCLIQPage,
};
