/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 主题令牌体检 —— 供 UI 主题体系改造与后续新增主题时自查
//
// 检查两件事：
//   1. 完整性：每套主题定义的颜色令牌集合，必须与 dark 基准完全一致。
//      少一个就会静默继承 dark 的值（亮色主题里出现深色阴影就是这么来的）。
//   2. 可读性：关键前景/背景组合的 WCAG 对比度。
//      正文要求 ≥ 4.5:1，次要文字与终端亮色 ANSI 放宽到 3.0:1。
//
// 用法：node scripts/check-theme-tokens.mjs
// 退出码非 0 表示体检不通过。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/css/theme.css'), 'utf8');

/** 非颜色令牌（间距/圆角/缓动/字体/布局），不参与体检 */
const NON_COLOR = /^--(space|radius|ease|font|sidebar|status)/;

/**
 * 收集某个选择器下所有令牌（同选择器可能出现多个块，合并）
 * @param {RegExp} selRe 必须带 g 标志，第 1 个捕获组为声明体
 */
function collect(selRe) {
  /** @type {Record<string,string>} */
  const out = {};
  let m;
  while ((m = selRe.exec(CSS))) {
    for (const line of m[1].split('\n')) {
      const mm = line.match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/);
      if (mm && !NON_COLOR.test(mm[1])) out[mm[1]] = mm[2].trim();
    }
  }
  return out;
}

const themeBlock = (id) =>
  collect(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`, 'g'));

// dark 基准：:root 与 [data-theme="dark"] 合并写法
const dark = collect(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/g);

/** 别名与推导型令牌：由 var() 构成，天然跟随主题，无需各主题重复定义 */
const DERIVED = new Set([
  '--border-color', '--hover-bg', '--bg-primary',
  '--accent-gradient', '--accent-gradient-warm', '--accent-gradient-cool',
]);

const baseline = Object.keys(dark).filter((k) => !DERIVED.has(k)).sort();
const THEMES = ['light', 'quiet', 'xuan', 'xuanye', 'cyber'];

let failed = 0;

console.log(`基准（dark）需覆盖的颜色令牌：${baseline.length} 个`
  + `（另有 ${DERIVED.size} 个 var() 别名自动跟随，不计入）\n`);

console.log('── 1. 令牌完整性 ──');
for (const t of THEMES) {
  const b = themeBlock(t);
  const miss = baseline.filter((k) => !(k in b));
  const extra = Object.keys(b).filter((k) => !baseline.includes(k) && !DERIVED.has(k));
  const ok = miss.length === 0 && extra.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? '  ok  ' : '  FAIL'} ${t.padEnd(7)} 定义 ${String(Object.keys(b).length).padStart(2)} 个`
    + (miss.length ? `\n         缺失(${miss.length}): ${miss.join(' ')}` : '')
    + (extra.length ? `\n         多余(${extra.length}): ${extra.join(' ')}` : ''),
  );
}

// ── 对比度 ──

/** @param {string} c @returns {[number,number,number]|null} 忽略 alpha */
function parseColor(c) {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = c.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/** @param {[number,number,number]} rgb */
function luminance([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** @param {string} fg @param {string} bg */
function contrast(fg, bg) {
  const a = parseColor(fg), b = parseColor(bg);
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * 检查项：[前景令牌, 背景令牌, 最低比值, 说明]
 *
 * 阈值取法：正文按 WCAG AA 的 4.5:1；语义色与 ANSI 基础色多用于图标、
 * 边框、短标签，按非文本/大字号的 3.0:1。
 * bright-* 变体**不检查** —— ANSI 约定里 bright 就是更亮，在亮色底上
 * 必然低对比，既有 light 主题同样如此，强行拉高反而破坏终端配色语义。
 */
const CHECKS = [
  ['--text-primary', '--bg-surface', 4.5, '正文/界面主色'],
  ['--text-primary', '--bg-elevated', 4.5, '正文/浮层'],
  ['--text-secondary', '--bg-surface', 4.0, '次要文字'],
  ['--text-on-accent', '--accent', 4.5, '强调色按钮文字'],
  ['--accent', '--bg-surface', 3.0, '强调色'],
  ['--accent-sub', '--bg-surface', 3.0, '副强调色'],
  ['--success', '--bg-surface', 3.0, '语义-成功'],
  ['--warning', '--bg-surface', 3.0, '语义-警告'],
  ['--danger', '--bg-surface', 3.0, '语义-危险'],
  ['--info', '--bg-surface', 3.0, '语义-信息'],
  ['--term-fg', '--term-bg', 4.5, '终端正文'],
  ['--term-red', '--term-bg', 3.0, '终端 ANSI 红'],
  ['--term-green', '--term-bg', 3.0, '终端 ANSI 绿'],
  ['--term-yellow', '--term-bg', 3.0, '终端 ANSI 黄'],
  ['--term-blue', '--term-bg', 3.0, '终端 ANSI 蓝'],
  ['--term-magenta', '--term-bg', 3.0, '终端 ANSI 品红'],
  ['--term-cyan', '--term-bg', 3.0, '终端 ANSI 青'],
];

/**
 * 既有主题的历史欠账：记录在案、只告警不判失败。
 *
 * 为什么不顺手改掉：--accent #6366f1 是 dark/light 沿用至今的品牌色，
 * 差 0.03 属肉眼不可辨的边界值，为了凑 4.5 去动它会改变产品既有观感 —— 
 * 那是产品决策，不该藏在一次主题改造里悄悄做掉。
 * 新增主题不享受此豁免，必须一次做对。
 * @type {Record<string, string>}
 */
const KNOWN = {
  'dark/强调色按钮文字': '#fff on #6366f1 = 4.47，既有品牌色，差 0.03',
  'light/强调色按钮文字': '#fff on #6366f1 = 4.47，同上',
};

console.log('\n── 2. WCAG 对比度 ──');
/** @type {string[]} */
const warned = [];
for (const t of ['dark', ...THEMES]) {
  const b = t === 'dark' ? dark : themeBlock(t);
  /** @type {string[]} */
  const problems = [];
  let min = Infinity, minName = '';
  for (const [fgK, bgK, need, label] of CHECKS) {
    const r = contrast(b[fgK], b[bgK]);
    if (r === null) continue;
    if (r < min) { min = r; minName = label; }
    if (r < need) {
      const key = `${t}/${label}`;
      if (KNOWN[key]) warned.push(`${key} —— ${KNOWN[key]}`);
      else problems.push(`${label} ${r.toFixed(2)}<${need}`);
    }
  }
  if (problems.length) failed++;
  console.log(
    `${problems.length ? '  FAIL' : '  ok  '} ${t.padEnd(7)}`
    + ` 最低 ${min.toFixed(2)}:1 (${minName})`
    + (problems.length ? `\n         不达标: ${problems.join('; ')}` : ''),
  );
}
if (warned.length) {
  console.log('\n  已知欠账（不判失败，仅记录）:');
  for (const w of warned) console.log('    ·', w);
}

// ── 3. 角色撞色 ──
// 承担不同语义的颜色若过于接近，用户无法从颜色分辨状态
// （比如「副强调」和「报错」都是同一支红）。
// 用 RGB 欧氏距离做粗筛：够用、无依赖，且不会像纯色相比较那样
// 被低饱和度的中性色误报。
/** @type {[string,string][]} */
const PAIRS = [
  ['--accent', '--accent-sub'],
  ['--accent-sub', '--danger'],
  ['--accent', '--danger'],
  ['--warning', '--danger'],
  ['--success', '--warning'],
];
const MIN_DIST = 40;

/** @param {string} a @param {string} b */
function dist(a, b) {
  const p = parseColor(a), q = parseColor(b);
  if (!p || !q) return null;
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

console.log('\n── 3. 角色撞色（RGB 距离需 ≥ ' + MIN_DIST + '）──');
for (const t of ['dark', ...THEMES]) {
  const b = t === 'dark' ? dark : themeBlock(t);
  /** @type {string[]} */
  const clashes = [];
  let min = Infinity, minPair = '';
  for (const [x, y] of PAIRS) {
    const d = dist(b[x], b[y]);
    if (d === null) continue;
    if (d < min) { min = d; minPair = `${x} ↔ ${y}`; }
    if (d < MIN_DIST) clashes.push(`${x} ↔ ${y} 仅 ${d.toFixed(0)}`);
  }
  if (clashes.length) failed++;
  console.log(
    `${clashes.length ? '  FAIL' : '  ok  '} ${t.padEnd(7)} 最近 ${min.toFixed(0)} (${minPair})`
    + (clashes.length ? `\n         撞色: ${clashes.join('; ')}` : ''),
  );
}

console.log(failed ? `\n❌ 体检未通过（${failed} 项）` : '\n✅ 全部通过');
process.exit(failed ? 1 : 0);
