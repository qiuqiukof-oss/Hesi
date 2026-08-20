/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// engine.js — 默认搜索引擎解析
//
// 把"关键词"解析成最终要导航的搜索 URL，遵循"用浏览器自己
// 设置好的默认引擎"：
//   1. 环境变量 HESI_WEB_SEARCH_ENGINE_URL（显式设定，含 {q} 占位符）
//   2. 读本机浏览器（Chrome/Edge）Preferences 的
//      default_search_provider.search_url（用户改过默认引擎时生效）
//   3. 按浏览器类型回退内置默认：Edge→Bing，Chrome→Google
//
// 这样既不写死引擎，又不依赖任何外部索引 API；URL 由本机浏览器
// 的真实配置决定。
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const FALLBACK_TEMPLATES = {
  edge: 'https://www.bing.com/search?q={q}',
  chrome: 'https://www.google.com/search?q={q}',
  chromium: 'https://www.google.com/search?q={q}',
};

/** 探测本机浏览器类型（Edge / Chrome），用于回退内置默认引擎 */
function detectBrowserType() {
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const cands = bases.flatMap((b) => [
    path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  for (const c of cands) {
    if (fs.existsSync(c)) {
      if (/edge/i.test(c)) return 'edge';
      if (/chrome/i.test(c)) return 'chrome';
    }
  }
  if (process.platform === 'darwin') return 'chrome';
  if (process.platform === 'linux') return 'chrome';
  return 'chrome';
}

/** 从浏览器 Preferences 读 default_search_provider.search_url */
function readSearchUrlFromPrefs(userDataDir) {
  if (!userDataDir) return null;
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  if (!fs.existsSync(prefsPath)) return null;
  try {
    let raw = fs.readFileSync(prefsPath, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 去 BOM
    const j = JSON.parse(raw);
    const url = j && j.default_search_provider && j.default_search_provider.search_url;
    return typeof url === 'string' && url.length ? url : null;
  } catch {
    return null;
  }
}

/** 解析本机用户真实浏览器 User Data 目录（优先日常配置） */
function resolveProfileDir() {
  if (process.env.HESI_SEARCH_PROFILE_DIR) return process.env.HESI_SEARCH_PROFILE_DIR;
  const local = process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.config'));
  const tries = [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data'),
  ];
  for (const t of tries) {
    if (fs.existsSync(path.join(t, 'Default', 'Preferences'))) return t;
  }
  return null;
}

/** 把 {searchTerms}/{q} 占位符替换为编码后关键词，清掉其它内部占位符 */
function replaceTokens(template, query) {
  const q = encodeURIComponent(query);
  return template
    .replace(/\{searchTerms\}/gi, q)
    .replace(/\{q\}/gi, q)
    .replace(/\{[^}]+\}/g, ''); // 去掉 {google:...} 等 Chromium 内部占位符
}

let _cache = null;

/** 返回 { template, source }，结果缓存避免每次读盘 */
function getTemplate() {
  if (_cache) return _cache;
  let template;
  let source;
  if (process.env.HESI_WEB_SEARCH_ENGINE_URL) {
    template = process.env.HESI_WEB_SEARCH_ENGINE_URL;
    source = 'env:HESI_WEB_SEARCH_ENGINE_URL';
  } else {
    const prefsUrl = readSearchUrlFromPrefs(resolveProfileDir());
    if (prefsUrl) {
      template = prefsUrl;
      source = 'browser-prefs';
    } else {
      template = FALLBACK_TEMPLATES[detectBrowserType()] || FALLBACK_TEMPLATES.chrome;
      source = 'builtin-fallback';
    }
  }
  _cache = { template, source };
  return _cache;
}

/** 判断 target 是否为 URL（否则视为关键词） */
function isUrl(target) {
  if (!target) return false;
  const t = String(target).trim();
  return /^https?:\/\//i.test(t) || /^(www\.|[\w-]+\.[a-z]{2,})(\/|$)/i.test(t);
}

/** 把关键词或 URL 解析为最终要导航的目标 URL */
function resolveTargetUrl(target) {
  const t = String(target || '').trim();
  if (!t) throw new Error('target 为空');
  if (isUrl(t)) {
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }
  const { template } = getTemplate();
  return replaceTokens(template, t);
}

module.exports = { resolveTargetUrl, isUrl, getTemplate, replaceTokens, detectBrowserType };
