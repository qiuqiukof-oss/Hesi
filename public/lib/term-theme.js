/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// term-theme.js — CSS 令牌 → xterm.js ITheme 转换层
//
// 设计目标：**单一事实源**。
//   颜色只在 public/css/theme.css 的 --term-* 令牌中定义一次，
//   JS 侧不再持有任何调色板常量。终端配色由令牌运行时派生，
//   因此天然与 UI 主题同步。
//
// 为什么必须在运行时转换：
//   xterm.js 的 theme 选项只接受具体颜色值，不认 var(--x)，
//   所以只能用 getComputedStyle 把令牌解析成真实颜色再注入。
//
// 优先级：用户自定义 innerBg（theme-customizer） > 主题令牌 > 内置兜底
// ============================================================
// @ts-check
'use strict';

import { safeStorage } from './storage.js';

/** theme-customizer 的自定义配色存储键（与 theme-switcher.js 保持一致） */
const CUSTOM_THEME_KEY = 'cli-q-custom-theme';

/**
 * xterm ITheme 键 → [CSS 令牌名, 兜底值]
 * 兜底值取自改造前 tabs.js 的硬编码字面量，
 * 保证令牌缺失（如 CSS 未加载完）时终端仍可读，不白屏。
 * @type {Readonly<Record<string, [string, string]>>}
 */
export const TERM_TOKENS = Object.freeze({
  background:    ['--term-bg',             'rgba(13, 14, 16, 0.85)'],
  foreground:    ['--term-fg',             '#e4e4e7'],
  cursor:        ['--term-cursor',         '#e4e4e7'],
  cursorAccent:  ['--term-cursor-accent',  '#0d0e10'],

  black:         ['--term-black',          '#18181b'],
  red:           ['--term-red',            '#ef4444'],
  green:         ['--term-green',          '#22c55e'],
  yellow:        ['--term-yellow',         '#eab308'],
  blue:          ['--term-blue',           '#6366f1'],
  magenta:       ['--term-magenta',        '#a78bfa'],
  cyan:          ['--term-cyan',           '#22d3ee'],
  white:         ['--term-white',          '#e4e4e7'],

  brightBlack:   ['--term-bright-black',   '#71717a'],
  brightRed:     ['--term-bright-red',     '#f87171'],
  brightGreen:   ['--term-bright-green',   '#4ade80'],
  brightYellow:  ['--term-bright-yellow',  '#facc15'],
  brightBlue:    ['--term-bright-blue',    '#818cf8'],
  brightMagenta: ['--term-bright-magenta', '#c4b5fd'],
  brightCyan:    ['--term-bright-cyan',    '#67e8f9'],
  brightWhite:   ['--term-bright-white',   '#fafafa'],
});

const SELECTION_FALLBACK = 'rgba(99,102,241,0.3)';

/**
 * 从当前生效的 CSS 令牌构建 xterm ITheme 对象。
 * @param {HTMLElement} [root] 读取令牌的根元素，默认 <html>
 * @returns {Record<string, string>} xterm ITheme
 */
export function buildXtermTheme(root) {
  const el = root || document.documentElement;
  /** @type {CSSStyleDeclaration|null} */
  let cs = null;
  try {
    cs = getComputedStyle(el);
  } catch {
    cs = null; // 极端环境（如无 DOM）下退化为纯兜底值
  }

  /** @param {string} token @param {string} fallback @returns {string} */
  const read = (token, fallback) => {
    if (!cs) return fallback;
    const v = cs.getPropertyValue(token);
    return (v && v.trim()) || fallback;
  };

  /** @type {Record<string, string>} */
  const theme = {};
  for (const key of Object.keys(TERM_TOKENS)) {
    const [token, fallback] = TERM_TOKENS[key];
    theme[key] = read(token, fallback);
  }

  // 选区高亮：xterm v6 的 ITheme 使用 selectionBackground，
  // 旧代码里的 `selection` 键实际无效（历史遗留），这里两者都写：
  // selectionBackground 真正生效，selection 保留以兼容可能的外部读取。
  const sel = read('--term-selection', SELECTION_FALLBACK);
  theme.selectionBackground = sel;
  theme.selection = sel;

  // 用户自定义内层底色优先级最高（含用户设定的 alpha，切主题时不应丢失）
  try {
    const custom = safeStorage.getJSON(CUSTOM_THEME_KEY);
    if (custom && typeof custom.innerBg === 'string' && custom.innerBg) {
      theme.background = custom.innerBg;
    }
  } catch { /* localStorage 不可用时忽略，用主题令牌值 */ }

  return theme;
}

/**
 * 收集当前页面上所有存活的终端实例（去重）。
 * 覆盖多 Tab 场景 —— 旧实现只同步「当前活动的那一个」，其余 Tab 不刷新。
 * @returns {Set<any>}
 */
function collectTerminals() {
  const Q = /** @type {any} */ (window.QCLI) || {};
  const terms = new Set();
  const list = Q.Tabs?.tabs;
  if (Array.isArray(list)) {
    for (const t of list) {
      if (t && t.term) terms.add(t.term);
    }
  }
  // 兜底：Tabs 尚未初始化时的单终端引用
  if (Q.Tabs?.term) terms.add(Q.Tabs.term);
  if (Q.term) terms.add(Q.term);
  return terms;
}

/**
 * 把当前主题令牌同步到**全部**终端实例。
 * @param {HTMLElement} [root] 读取令牌的根元素
 * @returns {number} 实际同步成功的终端数（便于验收/排障观测）
 */
export function applyTermThemeToAll(root) {
  const theme = buildXtermTheme(root);
  let ok = 0;
  for (const term of collectTerminals()) {
    try {
      if (!term || typeof term.options === 'undefined') continue;
      term.options.theme = theme;
      if (typeof term.refresh === 'function' && term.rows > 0) {
        term.refresh(0, term.rows - 1);
      }
      ok++;
    } catch {
      // 终端可能已被 dispose 或 WebGL 渲染器异常 —— 非致命，下次切 Tab 会重绘
    }
  }
  return ok;
}

export default { TERM_TOKENS, buildXtermTheme, applyTermThemeToAll };
