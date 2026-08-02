/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// theme-registry.js — 主题清单与明暗基调判定
//
// 两个属性各司其职（与 public/css/theme.css 的约定一致）：
//   data-theme  取哪套颜色令牌  —— light / dark / quiet / xuan / xuanye / cyber
//   data-scheme 按明还是暗排版 —— light / dark
//
// 为什么要拆开：从前全靠 data-theme==='light' 判断明暗，
// 一旦出现第三套亮色主题，所有这类判断全部失效
// （xuan 是亮色却会被判成暗色）。data-scheme 让「明暗」这件事
// 与「具体哪套配色」解耦，新增主题不必再改一遍判断逻辑。
// ============================================================
// @ts-check
'use strict';

/**
 * @typedef {Object} ThemeEntry
 * @property {string}  id     data-theme 取值
 * @property {string}  label  界面显示名
 * @property {'light'|'dark'} scheme 明暗基调
 * @property {boolean} beta   是否标记为 Beta
 * @property {string}  pair   切换明暗时的对位主题
 * @property {string}  desc   一句话描述，用于选择器提示
 */

/** @type {ReadonlyArray<ThemeEntry>} */
export const THEMES = Object.freeze([
  {
    id: 'light', label: '明亮', scheme: 'light', beta: false,
    pair: 'dark', desc: '默认亮色，中性灰白',
  },
  {
    id: 'dark', label: '暗黑', scheme: 'dark', beta: false,
    pair: 'light', desc: '默认暗色，中性深灰',
  },
  {
    id: 'quiet', label: '静谧', scheme: 'light', beta: true,
    pair: 'dark', desc: '暖白纸感配橄榄灰绿，久看不累',
  },
  {
    id: 'xuan', label: '宣纸', scheme: 'light', beta: true,
    pair: 'xuanye', desc: '绢帛底、墨字、朱砂点睛',
  },
  {
    id: 'xuanye', label: '玄夜', scheme: 'dark', beta: true,
    pair: 'xuan', desc: '夜色描金，宣纸的暗色对位',
  },
  {
    id: 'cyber', label: '深空', scheme: 'dark', beta: true,
    pair: 'light', desc: '近黑蓝底配青紫霓虹',
  },
]);

/** @type {Readonly<Record<string, ThemeEntry>>} */
const BY_ID = Object.freeze(Object.fromEntries(THEMES.map((t) => [t.id, t])));

export const THEME_IDS = Object.freeze(THEMES.map((t) => t.id));

/**
 * 各基调的兜底主题：没有历史记录时切换明暗落到哪一套。
 *
 * 决策 #2「默认宣纸」：默认家族取 xuan(宣纸)/xuanye(玄夜) 这一对——
 * 系统偏好亮色时落到宣纸，偏好暗色时落到其暗色对位玄夜，
 * 这样无论明还是暗，首屏都是同一视觉家族。
 * @type {Readonly<Record<'light'|'dark', string>>}
 */
export const DEFAULT_BY_SCHEME = Object.freeze({ light: 'xuan', dark: 'xuanye' });

/** 首次访问且系统未表态时使用的主题（默认宣纸） */
export const DEFAULT_THEME = 'xuan';

/**
 * @param {string|null|undefined} id
 * @returns {ThemeEntry|null}
 */
export function getTheme(id) {
  return (id && BY_ID[id]) || null;
}

/**
 * @param {string|null|undefined} id
 * @returns {boolean}
 */
export function isValidTheme(id) {
  return !!(id && Object.prototype.hasOwnProperty.call(BY_ID, id));
}

/**
 * 取当前明暗基调。
 *
 * 优先读 data-scheme；读不到再从 data-theme 反查注册表兜底 ——
 * 这样即使某条代码路径只设了 data-theme（或页面刚加载还没跑到
 * applyTheme），判断也不会错。
 *
 * @param {Element} [root] 默认 <html>
 * @returns {'light'|'dark'}
 */
export function getScheme(root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return 'dark';
  const s = el.getAttribute('data-scheme');
  if (s === 'light' || s === 'dark') return s;
  const t = getTheme(el.getAttribute('data-theme'));
  return t ? t.scheme : 'dark';
}

/**
 * @param {Element} [root]
 * @returns {boolean}
 */
export function isDarkScheme(root) {
  return getScheme(root) === 'dark';
}

/**
 * 求切换明暗后应落到的主题：
 * 优先用调用方给的「该基调上次用过的主题」，其次用当前主题的对位主题，
 * 最后回落到该基调的兜底主题。
 *
 * @param {string} currentId 当前主题 id
 * @param {string} [lastUsedInTarget] 目标基调上次用过的主题 id
 * @returns {string} 目标主题 id
 */
export function resolveToggleTarget(currentId, lastUsedInTarget) {
  const cur = getTheme(currentId) || getTheme(DEFAULT_THEME);
  const target = cur && cur.scheme === 'dark' ? 'light' : 'dark';

  const last = getTheme(lastUsedInTarget);
  if (last && last.scheme === target) return last.id;

  const paired = cur && getTheme(cur.pair);
  if (paired && paired.scheme === target) return paired.id;

  return DEFAULT_BY_SCHEME[target];
}

export default {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME,
  DEFAULT_BY_SCHEME,
  getTheme,
  isValidTheme,
  getScheme,
  isDarkScheme,
  resolveToggleTarget,
};
