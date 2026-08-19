/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// pin-quick — 不依赖右键菜单的快速钉住入口
//   A. 选区浮动条：终端选中文字 → 选区上方浮现 📌 Pin → 点即钉
//   B. 面板图钉按钮：终端面板右上角 hover 出现 📌 → 点即钉当前选区
// 复用 context-menu 的 Q.pinSelectedOutput（已支持 selectionOverride + {skipPrompt}）
// ============================================================
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

function getActiveTerm() {
  const q = Q();
  return q.term || (q.Tabs && q.Tabs.term) || null;
}

function getSelectionText() {
  const term = getActiveTerm();
  const sel = term && term.getSelection ? term.getSelection() : '';
  return sel ? sel.trim() : '';
}

// 定位选区像素矩形（优先 xterm 选区渲染层，回退终端容器顶部）
function locateSelectionRect() {
  const selEl = document.querySelector('#terminal .xterm-selection');
  if (selEl) {
    const r = selEl.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) return r;
  }
  const term = document.getElementById('terminal');
  if (term) return term.getBoundingClientRect();
  return null;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── 浮动条（A）──
let barEl = null;
function ensureBar() {
  if (barEl) return barEl;
  barEl = document.createElement('div');
  barEl.id = 'pin-quick-bar';
  barEl.className = 'pin-quick-bar hidden';
  const btn = document.createElement('button');
  btn.className = 'pin-quick-btn';
  btn.type = 'button';
  btn.innerHTML = '📌 <span>Pin</span>';
  btn.title = '将终端选中内容存至Hesi剪切板';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getSelectionText();
    const q = Q();
    if (!text) {
      if (q.showToast) q.showToast('请先选中要钉住的内容', 'info');
      hideBar();
      return;
    }
    if (q.pinSelectedOutput) q.pinSelectedOutput(text, { skipPrompt: true });
    hideBar();
  });
  barEl.appendChild(btn);
  document.body.appendChild(barEl);
  return barEl;
}

function showBar() {
  const bar = ensureBar();
  const rect = locateSelectionRect();
  if (!rect) { hideBar(); return; }
  bar.classList.remove('hidden'); // 先显示以测量尺寸
  const bw = bar.offsetWidth || 84;
  const bh = bar.offsetHeight || 30;
  let left = rect.left + rect.width / 2 - bw / 2;
  let top = rect.top - bh - 8;
  left = clamp(left, 8, window.innerWidth - bw - 8);
  if (top < 8) top = rect.bottom + 8; // 选区贴顶则放下方
  bar.style.left = left + 'px';
  bar.style.top = top + 'px';
}

function hideBar() {
  if (barEl) barEl.classList.add('hidden');
}

// ── 面板图钉按钮（B）──
let hoverBtn = null;
function ensureHoverBtn() {
  if (hoverBtn) return hoverBtn;
  const container = document.getElementById('terminal-container');
  if (!container) return null;
  hoverBtn = document.createElement('button');
  hoverBtn.id = 'pin-hover-btn';
  hoverBtn.className = 'pin-hover-btn';
  hoverBtn.type = 'button';
  hoverBtn.innerHTML = '📌';
  hoverBtn.title = '将终端选中内容存至Hesi剪切板';
  hoverBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getSelectionText();
    const q = Q();
    if (!text) {
      if (q.showToast) q.showToast('请先选中要钉住的内容', 'info');
      return;
    }
    if (q.pinSelectedOutput) q.pinSelectedOutput(text, { skipPrompt: true });
  });
  container.appendChild(hoverBtn);
  return hoverBtn;
}

// ── 选区变化监听（不依赖右键菜单）──
function onMaybeSelectionChange() {
  requestAnimationFrame(() => {
    const text = getSelectionText();
    if (text) showBar();
    else hideBar();
  });
}

function init() {
  ensureHoverBtn();
  document.addEventListener('mouseup', (e) => {
    if (barEl && barEl.contains(e.target)) return;
    onMaybeSelectionChange();
  });
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || (e.key && e.key.startsWith('Arrow'))) onMaybeSelectionChange();
  });
  window.addEventListener('scroll', hideBar, true);
  window.addEventListener('resize', hideBar);
  window.addEventListener('blur', hideBar);
  document.addEventListener('mousedown', (e) => {
    if (barEl && !barEl.contains(e.target)) hideBar();
  });
}

export const PinQuick = { init, showBar, hideBar };
if (window.QCLI) window.QCLI.PinQuick = PinQuick;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
} else {
  setTimeout(init, 0);
}
