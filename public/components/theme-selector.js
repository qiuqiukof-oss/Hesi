/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <theme-selector> — 主题选择网格（T8）
//
// 数据源：theme-registry THEMES（单一事实源，6 套主题）。
// 每张卡片用 term-theme.readThemeTokens 在离屏探针上读取令牌，
// 渲染一小块「色卡」预览（底色 / 表面 / 主强调 / 副强调），
// Beta 主题显示 Beta 徽标（决策 #5）。
// 点击调用 Q.applyTheme(id) 切换；并随 documentElement[data-theme]
// 变化同步高亮，保证明暗切换按钮等其它入口改主题后网格状态一致。
// ============================================================
// @ts-check
'use strict';

import { THEMES, getTheme } from '../lib/theme-registry.js';
import { readThemeTokens } from '../lib/term-theme.js';

/** 色卡预览需要的令牌 */
const SWATCH_TOKENS = ['--bg-ground', '--bg-surface', '--accent', '--accent-sub', '--text-primary'];

/**
 * 构建一张主题卡片。
 * @param {string} id
 * @returns {HTMLButtonElement}
 */
function buildCard(id) {
  const theme = getTheme(id);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ts-card';
  card.dataset.theme = id;
  card.setAttribute('aria-pressed', 'false');
  if (!theme) return card;

  const t = readThemeTokens(id, SWATCH_TOKENS, theme.scheme);
  const ground = t['--bg-ground'] || '#222';
  const surface = t['--bg-surface'] || ground;
  const accent = t['--accent'] || '#888';
  const accentSub = t['--accent-sub'] || accent;
  const text = t['--text-primary'] || '#fff';

  const beta = theme.beta ? '<span class="ts-beta">Beta</span>' : '';
  const desc = theme.desc ? `<span class="ts-desc">${theme.desc}</span>` : '';

  card.innerHTML = `
    <span class="ts-swatch" style="--s-ground:${ground};--s-surface:${surface};--s-accent:${accent};--s-accent-sub:${accentSub};--s-text:${text}">
      <span class="ts-sw-top"></span>
      <span class="ts-sw-dot ts-sw-a"></span>
      <span class="ts-sw-dot ts-sw-b"></span>
    </span>
    <span class="ts-meta">
      <span class="ts-name">${theme.label}${beta}</span>
      ${desc}
    </span>`;

  card.addEventListener('click', () => {
    const q = window.QCLI || {};
    if (q.applyTheme) q.applyTheme(id);
    setActive(id);
  });
  return card;
}

/**
 * 根据当前 data-theme 高亮对应卡片。
 * @param {string} [id]
 */
export function setActive(id) {
  const root = document.getElementById('theme-selector');
  if (!root) return;
  const current = id || document.documentElement.getAttribute('data-theme') || '';
  root.querySelectorAll('.ts-card').forEach((card) => {
    const on = card.dataset.theme === current;
    card.classList.toggle('active', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** 渲染主题选择网格 */
export function render() {
  const root = document.getElementById('theme-selector');
  if (!root) return;
  root.textContent = '';
  for (const t of THEMES) {
    root.appendChild(buildCard(t.id));
  }
  setActive();
}

/** 初始化：渲染 + 监听主题变化 */
export function init() {
  render();
  // 主题被其它入口（如明暗切换按钮）改变时，同步高亮
  const obs = new MutationObserver(() => setActive());
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ── Auto-init ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export default { render, setActive, init };
