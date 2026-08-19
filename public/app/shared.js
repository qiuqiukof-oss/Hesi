/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// App Shared State — 模块间共享的可变状态
//
// 替代原 app.js 中的 module-level 变量（term, fitAddon 等），
// 让拆分的子模块都能安全引用同一份引用。
// ============================================================

/** @type {{ current: import('@xterm/xterm').Terminal | null }} */
export const termRef = { current: null };

/** @type {{ current: import('@xterm/addon-fit').FitAddon | null }} */
export const fitAddonRef = { current: null };

/** @type {{ current: import('@xterm/addon-webgl').WebglAddon | null }} */
export const webglAddonRef = { current: null };

/** 输入缓冲区（用于完整命令捕获） */
export const inputBuf = { value: '', tabId: null, clk: null };

/** 待执行的 init 命令 Map<cliId, command> */
export const pendingInit = new Map();

/** 断线重连中标记 */
export let reconnectingFromLost = false;
export function setReconnecting(v) { reconnectingFromLost = v; }
