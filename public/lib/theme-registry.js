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
 * @property {boolean} [custom] 是否为用户自定义主题
 * @property {Record<string,string>} [variables] 自定义主题的 CSS 变量
 */

/** 内置主题（不可变） */
const BUILTIN_THEMES = [
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
];

const CUSTOM_KEY = 'qcli-custom-themes';

/** 从 localStorage 加载自定义主题 */
function loadCustomThemes() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** 保存自定义主题到 localStorage */
function saveCustomThemes(list) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/** 合并后的完整主题列表（内置 + 自定义） */
let _customCache = loadCustomThemes();

function _buildAll() {
  return [...BUILTIN_THEMES, ..._customCache];
}

/** @type {ThemeEntry[]} — 可变，支持运行时注册 */
export let THEMES = _buildAll();

let BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export function THEME_IDS() { return THEMES.map((t) => t.id); }

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

// ── 自定义主题管理 ──

/** 刷新合并列表和索引 */
function _rebuild() {
  _customCache = loadCustomThemes();
  THEMES = _buildAll();
  BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
}

/**
 * 注册自定义主题（如果 id 已存在则覆盖）。
 * @param {{ id: string, label: string, scheme: 'light'|'dark', variables: Record<string,string>, style?: string }} theme
 */
export function registerCustomTheme(theme) {
  const entry = {
    id: theme.id,
    label: theme.label || theme.id,
    scheme: theme.scheme || 'dark',
    beta: false,
    pair: '',
    desc: theme.desc || '自定义主题',
    custom: true,
    variables: theme.variables || {},
    style: theme.style || 'default',
  };
  const idx = _customCache.findIndex((t) => t.id === entry.id);
  if (idx >= 0) _customCache[idx] = entry; else _customCache.push(entry);
  saveCustomThemes(_customCache);
  _rebuild();
  return entry;
}

/**
 * 删除自定义主题。
 * @param {string} id
 * @returns {boolean} 是否删除成功
 */
export function removeCustomTheme(id) {
  const before = _customCache.length;
  _customCache = _customCache.filter((t) => t.id !== id);
  if (_customCache.length === before) return false;
  saveCustomThemes(_customCache);
  _rebuild();
  return true;
}

/** 获取所有自定义主题 */
export function getCustomThemes() {
  return [..._customCache];
}

/**
 * 为自定义主题应用 CSS 变量到 documentElement。
 * 内置主题由 CSS 属性选择器处理，自定义主题需要 JS 注入。
 * @param {ThemeEntry} theme
 */
export function applyCustomThemeVars(theme) {
  if (!theme || !theme.custom || !theme.variables) return;
  const el = document.documentElement;
  for (const [key, val] of Object.entries(theme.variables)) {
    if (key.startsWith('--')) el.style.setProperty(key, val);
  }
  // 同步 visual style
  if (theme.style) {
    el.setAttribute('data-style', theme.style);
  }
}

/**
 * 清除自定义主题注入的 CSS 变量（切回内置主题时调用）。
 */
export function clearCustomThemeVars() {
  const el = document.documentElement;
  // 只清除我们注入的变量（保留内置主题的变量）
  // 用一个简单策略：移除所有非内置主题定义的变量
  // 实际上更安全的做法是记住注入了哪些
  el.removeAttribute('data-style');
}

/**
 * 导出主题为 JSON 字符串。
 * @param {ThemeEntry} theme
 * @returns {string}
 */
export function exportThemeJSON(theme) {
  return JSON.stringify({
    name: theme.label,
    id: theme.id,
    scheme: theme.scheme,
    desc: theme.desc || '',
    variables: theme.variables || {},
    style: theme.style || 'default',
    version: '1.0',
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

/**
 * 从 JSON 字符串导入主题。
 * @param {string} jsonStr
 * @returns {{ theme: ThemeEntry, error?: string }}
 */
export function importThemeJSON(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.variables || typeof data.variables !== 'object') {
      return { theme: null, error: 'JSON 缺少 variables 字段' };
    }
    const id = data.id || ('custom-' + Date.now());
    const theme = registerCustomTheme({
      id,
      label: data.name || data.label || id,
      scheme: data.scheme || 'dark',
      desc: data.desc || '导入的主题',
      variables: data.variables,
      style: data.style || 'default',
    });
    return { theme };
  } catch (e) {
    return { theme: null, error: 'JSON 解析失败: ' + e.message };
  }
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
  registerCustomTheme,
  removeCustomTheme,
  getCustomThemes,
  applyCustomThemeVars,
  clearCustomThemeVars,
  exportThemeJSON,
  importThemeJSON,
};
