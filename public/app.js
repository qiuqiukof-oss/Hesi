/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

﻿// ============================================================
// Hesi — Frontend (Orchestrator)
//
// 将原来的 1,582 行拆分为 public/app/ 下的子模块：
//   shared.js   — 模块间共享可变状态
//   terminal.js — 终端初始化、字体缩放
//   ws-router.js — WebSocket 消息路由
//   sidebar.js  — CLI 列表渲染、文件夹管理、启动
//   boot.js     — init() 入口、UI 面板事件绑定
// ============================================================
// @ts-check

/** @typedef {import('./types').QCLI} QCLI */

// ESM imports — each module registers its own QCLI.* exports
import './i18n.js';
import './state.js';
import './app/error-boundary.js';
import './app/shared.js';
import './app/terminal.js';
import './app/ws-router.js';
import './app/sidebar.js';
import { init } from './app/boot.js';
import { installErrorBoundary } from './app/error-boundary.js';

// ━━ Q namespace (single source of truth) ━━
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ━━ Utility: garbled version detection ━━
/**
 * Check if a version string appears garbled (encoding issues in terminal output).
 * @param {string|null|undefined} v - Version string from CLI
 * @returns {boolean}
 */
Q.isGarbledVersion = function isGarbledVersion(v) {
  if (!v) return true;
  if (v === 'unknown') return true;
  if (v.includes('\uFFFD')) return true;
  const highAscii = v.split('').filter(ch => ch.charCodeAt(0) > 0x7E).length;
  if (highAscii / v.length >= 0.6) return true;
  if (v.length < 12 && /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(v)) return true;
  return false;
};

// ━━ Bridge: input buffer reset ━━
import { inputBuf } from './app/shared.js';

/** Reset the shared input buffer (value, tabId, clk) */
Q.resetInputBuffer = function() {
  inputBuf.value = '';
  inputBuf.tabId = null;
  inputBuf.clk = null;
};

// ━━ Bridge: reconnect entry point ━━
/** Re-establish WebSocket connection */
Q.connectWS = () => Q.wsConnect();

// ━━ Bridge: expose _pendingInit for cross-module access ━━
import { pendingInit } from './app/shared.js';
Q._pendingInit = pendingInit;

// ━━ Boot ━━
// 全局错误边界：单点异常→顶部降级横幅，不白屏
installErrorBoundary();

const __bootStart = (typeof performance !== 'undefined') ? performance.now() : Date.now();

/** 启动入口（包错误边界，异常走横幅而非整页崩） */
function boot() {
  try {
    init();
  } catch (err) {
    console.error('[Hesi] init 失败：', err);
    // 横幅由 error-boundary 统一处理；此处确保不阻断后续
  }
  // 首屏耗时埋点（P0.1a）
  const fp = Math.round(((typeof performance !== 'undefined') ? performance.now() : Date.now()) - __bootStart);
  console.info('[Hesi] first-paint=' + fp + 'ms');
  // 更准的 FCP（浏览器支持则补一条）
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            console.info('[Hesi] FCP=' + Math.round(entry.startTime) + 'ms');
          }
        }
      });
      po.observe({ type: 'paint', buffered: true });
    } catch { /* 不支持则忽略 */ }
  }
}

// ━━ Boot ━━
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
