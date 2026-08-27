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

import { THEMES, getTheme, removeCustomTheme, importThemeJSON } from '../lib/theme-registry.js';
import { readThemeTokens } from '../lib/term-theme.js';
import { getStyle, applyStyle } from './theme-switcher.js';
import { openEditor } from './theme-editor.js';

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
  const custom = theme.custom ? '<span class="ts-custom">自定义</span>' : '';
  const desc = theme.desc ? `<span class="ts-desc">${theme.desc}</span>` : '';

  const delBtn = theme.custom ? '<button class="ts-delete-btn" title="删除">✕</button>' : '';

  card.innerHTML = `
    ${delBtn}
    <span class="ts-swatch" style="--s-ground:${ground};--s-surface:${surface};--s-accent:${accent};--s-accent-sub:${accentSub};--s-text:${text}">
      <span class="ts-sw-top"></span>
      <span class="ts-sw-dot ts-sw-a"></span>
      <span class="ts-sw-dot ts-sw-b"></span>
    </span>
    <span class="ts-meta">
      <span class="ts-name">${theme.label}${beta}${custom}</span>
      ${desc}
    </span>`;

  card.addEventListener('click', (e) => {
    // 自定义主题的删除按钮
    if (e.target.closest('.ts-delete-btn')) {
      e.stopPropagation();
      if (confirm('删除自定义主题「' + theme.label + '」？')) {
        removeCustomTheme(id);
        applyTheme('dark');
        render();
      }
      return;
    }
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

/** 渲染视觉风格切换行 */
function renderStyleRow(container) {
  const row = document.createElement('div');
  row.className = 'ts-style-row';
  row.innerHTML = `
    <span class="ts-style-label">视觉风格</span>
    <div class="ts-style-options">
      <button class="ts-style-btn" data-style="default">默认</button>
      <button class="ts-style-btn" data-style="glass">🔮 玻璃拟态</button>
    </div>
  `;
  container.appendChild(row);

  // 绑定点击
  row.querySelectorAll('.ts-style-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyStyle(btn.dataset.style);
      syncStyleRow();
    });
  });
}

/** 渲染工具行（编辑器 / 导入） */
function renderToolRow(container) {
  const row = document.createElement('div');
  row.className = 'ts-tool-row';
  row.innerHTML = `
    <button class="te-btn ts-tool-btn" data-action="editor">🎨 编辑器</button>
    <button class="te-btn ts-tool-btn" data-action="import">📥 导入主题</button>
    <input type="file" class="ts-import-file" accept=".json" style="display:none" />
  `;
  container.appendChild(row);

  row.querySelector('[data-action="editor"]').addEventListener('click', () => openEditor());

  const fileInput = row.querySelector('.ts-import-file');
  row.querySelector('[data-action="import"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importThemeJSON(reader.result);
      if (result.error) {
        alert('导入失败: ' + result.error);
        return;
      }
      render();
      // 应用导入的主题
      if (result.theme) {
        const q = window.QCLI || {};
        if (q.applyTheme) q.applyTheme(result.theme.id);
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}

/** 同步视觉风格按钮高亮 */
function syncStyleRow() {
  const current = getStyle();
  document.querySelectorAll('.ts-style-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.style === current);
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
  // 视觉风格切换行
  renderStyleRow(root);
  // 工具行（编辑器 / 导入）
  renderToolRow(root);
  setActive();
  syncStyleRow();
}

/** 初始化：渲染 + 监听主题/风格变化 */
export function init() {
  render();
  // 主题被其它入口（如明暗切换按钮）改变时，同步高亮
  const obs = new MutationObserver(() => {
    setActive();
    syncStyleRow();
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style'] });
}

// ── Auto-init ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export default { render, setActive, init };
