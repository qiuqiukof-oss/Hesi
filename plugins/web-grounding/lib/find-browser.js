/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// find-browser.js — 跨平台查找本机 Chrome/Edge（独立实现）
//
// 从 Hesi lib/cdp-auto-launch.js 抽出，去掉一切 Hesi 依赖，
// 供独立包使用。顺序：
//   1. env WG_BROWSER_EXE（显式指定浏览器可执行文件）
//   2. Windows：Program Files / Program Files(x86) / LOCALAPPDATA
//      下的 chrome.exe / msedge.exe；再兜底 where chrome|msedge
//   3. macOS：/Applications 下的 Chrome / Edge / Chromium
//   4. Linux：which google-chrome|chromium|...
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

/** 跨平台查找 Chrome/Edge 可执行文件 */
function findBrowser() {
  const explicit = process.env.WG_BROWSER_EXE;
  if (explicit) return explicit;

  if (process.platform === 'win32') {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const cands = bases.flatMap((base) => [
      path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
    for (const c of cands) if (fs.existsSync(c)) return c;
    for (const cmd of ['chrome', 'msedge']) {
      try {
        const p = execFileSync('where', [cmd], { stdio: 'pipe' }).toString().split(/\r?\n/)[0];
        if (p) return p.trim();
      } catch (e) { /* not on PATH */ }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const cands = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const c of cands) if (fs.existsSync(c)) return c;
  }

  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable', 'microsoft-edge']) {
    try {
      const p = execSync('command -v ' + cmd, { stdio: 'pipe' }).toString().trim();
      if (p) return p;
    } catch (e) { /* not found */ }
  }
  return null;
}

module.exports = { findBrowser };
