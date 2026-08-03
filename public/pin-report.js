/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Pin Report — Minimal sidebar pins utility
//   - Sort pins (date / source / title)
//   - Export all to Markdown
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

  // Safe toast helper (toast.js lives in the main bundle; use runtime lookup)
  function showToast(message, type = 'info') {
    window.QCLI?.showToast?.(message, type);
  }

  // ── State ──
  let sortBy = 'date-desc';     // 'date-desc' | 'date-asc' | 'source-asc' | 'source-desc' | 'title-asc' | 'title-desc'

  // ── Format helpers ──
  function fmtDate(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  // ── Sort pins ──
  function sortPins(pins) {
    const sorted = [...pins];
    const [field, dir] = sortBy.split('-');
    const asc = dir === 'asc' ? 1 : -1;
    const cmp = (aVal, bVal) => {
      const a = aVal ?? '';
      const b = bVal ?? '';
      if (a === b) return 0;
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * asc;
    };
    sorted.sort((a, b) => {
      let result = 0;
      switch (field) {
        case 'date':
          result = ((a.timestamp || 0) - (b.timestamp || 0)) * asc;
          break;
        case 'source':
          result = cmp(a.source, b.source);
          break;
        case 'title':
          result = cmp(a.title || a.text.slice(0, 40), b.title || b.text.slice(0, 40));
          break;
      }
      // Stable fallback: if equal by chosen key, tie-break by timestamp desc
      if (result === 0) {
        result = (b.timestamp || 0) - (a.timestamp || 0);
      }
      return result;
    });
    return sorted;
  }

  // ── Minimal renderPinnedList — replaces app.js original ──
  async function renderPinnedList() {
    const container = document.getElementById('pinned-list');
    const section = document.getElementById('pinned-section');
    const store = window.QCLI?.PinStore;
    if (!container || !store) return;

    const allPins = await store.getAll();
    const pins = sortPins(allPins);

    if (pins.length === 0) {
      section?.classList.add('hidden');
      return;
    }
    section?.classList.remove('hidden');

    container.innerHTML = '';

    for (const pin of pins) {
      const el = document.createElement('div');
      el.className = 'pin-item';
      el.dataset.pinId = pin.id;

      // ── Content ──
      const content = document.createElement('div');
      content.className = 'pin-content';

      // Title row
      const titleRow = document.createElement('div');
      titleRow.className = 'pin-title-row';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'pin-title';
      titleSpan.textContent = pin.title || pin.text.slice(0, 40) + (pin.text.length > 40 ? '…' : '');
      titleSpan.title = pin.title || pin.text.slice(0, 120);
      titleRow.appendChild(titleSpan);

      content.appendChild(titleRow);

      // Meta row (source + time)
      const metaRow = document.createElement('div');
      metaRow.className = 'pin-meta';
      const src = pin.source || 'terminal';
      metaRow.textContent = `${src} · ${fmtDate(pin.timestamp)}`;
      content.appendChild(metaRow);

      // Preview (first line of text)
      const preview = document.createElement('div');
      preview.className = 'pin-preview';
      const firstLine = pin.text.split('\n')[0] || '';
      preview.textContent = stripAnsi(firstLine).slice(0, 60);
      content.appendChild(preview);

      el.appendChild(content);

      // Click to expand
      el.addEventListener('click', () => {
        el.classList.toggle('expanded');
      });

      container.appendChild(el);
    }
  }

  // ── Export all pins to Markdown ──
  async function exportPinsToMarkdown() {
    const store = window.QCLI?.PinStore;
    if (!store) return;

    const all = await store.getAll();
    if (all.length === 0) return;

    const lines = [];
    lines.push('# Hesi Output Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push('');
    lines.push(`*Total pins: ${all.length}*`);
    lines.push('');

    for (const pin of all) {
      const title = pin.title || `Pin from ${pin.source || 'terminal'}`;
      const ts = fmtDate(pin.timestamp);
      const src = pin.source || 'terminal';
      const tags = (pin.tags || []).join(', ');
      lines.push(`## ${title}`);
      lines.push('');
      lines.push(`**Source:** ${src}  ·  **Time:** ${ts}`);
      if (tags) lines.push(`**Tags:** ${tags}`);
      lines.push('');
      lines.push('```');
      lines.push(stripAnsi(pin.text));
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const md = lines.join('\n');

    // Export = download .md file (visible action) + best-effort clipboard copy
    try {
      await navigator.clipboard.writeText(md);
    } catch (e) { /* clipboard is optional */ }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hesi-report-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('已导出 Markdown 文件（同时已复制到剪贴板）', 'success');
  }

  // ── Lightweight hover tooltip (气泡说明) ──
  let _tipEl = null;
  function ensureTipEl() {
    if (_tipEl) return _tipEl;
    _tipEl = document.createElement('div');
    _tipEl.className = 'pin-tip-bubble';
    _tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(_tipEl);
    return _tipEl;
  }
  function attachTip(el, text) {
    if (!el || !text) return;
    el.setAttribute('data-tip', text);
    el.addEventListener('mouseenter', () => {
      const tip = ensureTipEl();
      tip.textContent = text;
      tip.classList.add('visible'); // 先可见以测量高度
      const th = tip.offsetHeight;
      const r = el.getBoundingClientRect();
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8; // 顶部不够则翻到下方
      tip.style.left = Math.max(8, r.left) + 'px';
      tip.style.top = top + 'px';
    });
    el.addEventListener('mouseleave', () => {
      if (_tipEl) _tipEl.classList.remove('visible');
    });
  }

  // ── Initialise — wire up events ──
  let _pinReportInited = false;
  function init() {
    if (_pinReportInited) return;
    _pinReportInited = true;

    // Enhance pinned section header
    const header = document.querySelector('.pinned-header');
    if (header) {
      let actions = header.querySelector('.pinned-header-actions');
      const createActions = !actions;
      if (createActions) {
        actions = document.createElement('div');
        actions.className = 'pinned-header-actions';
        actions.style.display = 'flex';
        actions.style.gap = '2px';
      }

      // Sort button
      if (!document.getElementById('pin-sort-btn')) {
        const sortBtn = document.createElement('button');
        sortBtn.className = 'pinned-header-btn';
        sortBtn.id = 'pin-sort-btn';
        sortBtn.textContent = '⇅';
        sortBtn.title = 'Sort pins (date/source/title)';
        attachTip(sortBtn, '切换排序方式：按时间 / 来源 / 标题（循环切换）');
        sortBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          cycleSort();
        });
        actions.appendChild(sortBtn);
      }

      // Export all button
      if (!document.getElementById('pin-export-all-btn')) {
        const exportBtn = document.createElement('button');
        exportBtn.className = 'pinned-header-btn';
        exportBtn.textContent = '📥';
        exportBtn.title = 'Export all as Markdown';
        attachTip(exportBtn, '把所有钉住内容导出为 Markdown（复制到剪贴板，失败则下载 .md 文件）');
        exportBtn.id = 'pin-export-all-btn';
        exportBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          exportPinsToMarkdown();
        });
        actions.appendChild(exportBtn);
      }

      if (createActions) {
        header.appendChild(actions);
      }
    }
  }

  function cycleSort() {
    const modes = ['date-desc', 'date-asc', 'source-asc', 'source-desc', 'title-asc', 'title-desc'];
    const labels = {
      'date-desc': '按时间倒序',
      'date-asc': '按时间正序',
      'source-asc': '按来源正序',
      'source-desc': '按来源倒序',
      'title-asc': '按标题正序',
      'title-desc': '按标题倒序'
    };
    const idx = modes.indexOf(sortBy);
    sortBy = modes[(idx + 1) % modes.length];
    renderPinnedList();
    showToast(`已切换排序：${labels[sortBy]}`, 'info');
  }

  // ── Export API ──
  export const PinReport = {
    renderPinnedList,
    exportPinsToMarkdown,
    get sortBy() { return sortBy; },
    init,
  };
  // Legacy compat
  Q.PinReport = PinReport;

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }
