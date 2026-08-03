/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Pin Report — Upgrade sidebar pins to a full report tool
//   - Title/tag editing directly in the pinned list
//   - Sort pins (date / source / title)
//   - Multi-select merge into a single report
//   - Export to Markdown / clipboard
//   - Full-screen report panel overlay
// ============================================================
'use strict';

import { escapeHtml } from './escape.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

  // ── State ──
  let pinOrder = [];            // ordered pin IDs (for sorted display)
  const selectedPins = new Set(); // pin IDs selected for merge
  let mergeMode = false;
  let sortBy = 'date';          // 'date' | 'source' | 'title'

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
    switch (sortBy) {
      case 'date':
        sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        break;
      case 'source':
        sorted.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
        break;
      case 'title':
        sorted.sort((a, b) => (a.title || a.text.slice(0, 40) || '').localeCompare(b.title || b.text.slice(0, 40) || ''));
        break;
    }
    pinOrder = sorted.map(p => p.id);
    return sorted;
  }

  // ── Enhanced renderPinnedList — replaces app.js original ──
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

      // ── Checkbox for merge mode ──
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'pin-checkbox';
      cb.checked = selectedPins.has(pin.id);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedPins.add(pin.id);
        else selectedPins.delete(pin.id);
        updateMergeActions();
      });
      el.appendChild(cb);

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

      // Edit title button
      const editBtn = document.createElement('button');
      editBtn.className = 'pin-edit-btn';
      editBtn.textContent = '✏';
      editBtn.title = 'Edit title & tags';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showPinEditor(pin, el);
      });
      titleRow.appendChild(editBtn);

      content.appendChild(titleRow);

      // Meta row (source + time)
      const metaRow = document.createElement('div');
      metaRow.className = 'pin-meta';
      const src = pin.source || 'terminal';
      metaRow.textContent = `${src} · ${fmtDate(pin.timestamp)}`;
      content.appendChild(metaRow);

      // Tags row
      if (pin.tags && pin.tags.length > 0) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'pin-tags';
        for (const tag of pin.tags) {
          const chip = document.createElement('span');
          chip.className = 'pin-tag';
          chip.textContent = tag;
          tagsRow.appendChild(chip);
        }
        content.appendChild(tagsRow);
      }

      // Preview (first line of text)
      const preview = document.createElement('div');
      preview.className = 'pin-preview';
      const firstLine = pin.text.split('\n')[0] || '';
      preview.textContent = stripAnsi(firstLine).slice(0, 60);
      content.appendChild(preview);

      el.appendChild(content);

      // ── Actions ──
      const actions = document.createElement('div');
      actions.className = 'pin-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'pin-action-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy to clipboard';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = stripAnsi(pin.text);
        navigator.clipboard.writeText(text).then(() => {
          Q.showToast('Copied to clipboard', 'success');
        }).catch(err => console.warn('[PinReport] clipboard error:', err));
      });
      actions.appendChild(copyBtn);
      attachTip(copyBtn, '复制这段钉住内容到剪贴板');

      const delBtn = document.createElement('button');
      delBtn.className = 'pin-action-btn danger';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove pin';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.remove(pin.id).then(() => renderPinnedList()).catch(err => console.error('[PinReport] remove failed:', err));
      });
      actions.appendChild(delBtn);
      attachTip(delBtn, '从钉住列表移除这条');

      el.appendChild(actions);

      // Click to expand
      el.addEventListener('click', () => {
        el.classList.toggle('expanded');
      });

      container.appendChild(el);
    }

    updateMergeActions();
  }

  // ── Show inline pin editor ──
  function showPinEditor(pin, el) {
    // Close any existing editors
    document.querySelectorAll('.pin-editor').forEach(e => e.remove());

    const editor = document.createElement('div');
    editor.className = 'pin-editor';

    // Title input
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'pin-editor-title';
    titleInput.value = pin.title || '';
    titleInput.placeholder = 'Pin title…';

    // Tags input
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'pin-editor-tags';

    // Show existing tags as chips with remove
    const tagChips = document.createElement('div');
    tagChips.className = 'pin-editor-chips';
    if (pin.tags) {
      for (const tag of pin.tags) {
        const chip = document.createElement('span');
        chip.className = 'pin-tag removable';
        chip.textContent = tag + ' ×';
        chip.addEventListener('click', () => {
          pin.tags = pin.tags.filter(t => t !== tag);
          renderChips();
          save();
        });
        tagChips.appendChild(chip);
      }
    }

    // Tag input
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.className = 'pin-editor-tag-input';
    tagInput.placeholder = '+ Add tag (Enter to add)';
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        e.preventDefault();
        if (!pin.tags) pin.tags = [];
        const tag = tagInput.value.trim().toLowerCase().replace(/\s+/g, '-');
        if (!pin.tags.includes(tag)) {
          pin.tags.push(tag);
          tagInput.value = '';
          renderChips();
          save();
        }
      }
    });

    tagsContainer.appendChild(tagChips);
    tagsContainer.appendChild(tagInput);

    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.className = 'pin-editor-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      pin.title = titleInput.value.trim();
      save();
      editor.remove();
      renderPinnedList();
    });

    editor.appendChild(titleInput);
    editor.appendChild(tagsContainer);
    editor.appendChild(saveBtn);

    el.appendChild(editor);
    titleInput.focus();
    titleInput.select();

    function renderChips() {
      tagChips.innerHTML = '';
      if (pin.tags) {
        for (const tag of pin.tags) {
          const chip = document.createElement('span');
          chip.className = 'pin-tag removable';
          chip.textContent = tag + ' ×';
          chip.addEventListener('click', () => {
            pin.tags = pin.tags.filter(t => t !== tag);
            renderChips();
            save();
          });
          tagChips.appendChild(chip);
        }
      }
    }

    async function save() {
      const store = window.QCLI?.PinStore;
      if (store) {
        await store.update(pin.id, { title: pin.title || '', tags: pin.tags || [] });
      }
    }
  }

  // ── Update merge action buttons visibility/text ──
  function updateMergeActions() {
    const mergeBar = document.getElementById('pin-merge-bar');
    const mergeBtn = document.getElementById('pin-merge-btn');
    const exportBtn = document.getElementById('pin-export-all-btn');
    if (!mergeBar) return;

    const count = selectedPins.size;
    const mergeLabel = document.getElementById('pin-merge-count');
    if (mergeLabel) mergeLabel.textContent = count > 0 ? `${count} selected` : '';

    if (mergeMode) {
      mergeBar.classList.remove('hidden');
    } else {
      mergeBar.classList.add('hidden');
    }
  }

  // ── Toggle merge mode ──
  function toggleMergeMode() {
    mergeMode = !mergeMode;
    selectedPins.clear();
    const bar = document.getElementById('pin-merge-bar');
    if (bar) bar.classList.toggle('hidden', !mergeMode);
    // Show checkboxes on pin items
    document.querySelectorAll('.pin-checkbox').forEach(cb => {
      cb.style.display = mergeMode ? '' : 'none';
      cb.checked = false;
    });
    updateMergeActions();
  }

  // ── Merge selected pins into a single report ──
  async function mergeSelectedPins() {
    const store = window.QCLI?.PinStore;
    if (!store || selectedPins.size < 2) return;

    const all = await store.getAll();
    const selected = all.filter(p => selectedPins.has(p.id));
    if (selected.length < 2) return;

    const mergedText = selected.map(p => {
      const title = p.title || 'Untitled';
      const src = p.source || 'terminal';
      const ts = fmtDate(p.timestamp);
      const body = stripAnsi(p.text);
      return `## ${title}\n\n*Source: ${src} · ${ts}*\n\n\`\`\`\n${body}\n\`\`\``;
    }).join('\n\n---\n\n');

    const tags = [...new Set(selected.flatMap(p => p.tags || []))];

    const id = await store.add(mergedText, 'merged', 'Merged Report',
      `Merged Report (${selected.length} pins)`);

    if (id) {
      await store.update(id, { tags });
    }

    selectedPins.clear();
    mergeMode = false;
    document.querySelectorAll('.pin-checkbox').forEach(cb => {
      cb.style.display = 'none';
      cb.checked = false;
    });
    const bar = document.getElementById('pin-merge-bar');
    if (bar) bar.classList.add('hidden');
    await renderPinnedList();
    Q.showToast(`Merged ${selected.length} pins into one report`, 'success');
  }

  // ── Export pins to Markdown ──
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

    // Copy to clipboard
    try {
      await navigator.clipboard.writeText(md);
      Q.showToast('Exported to clipboard as Markdown', 'success');
    } catch (e) {
      // Fallback: download as file
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qcli-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      Q.showToast('Downloaded as Markdown file', 'success');
    }
  }

  // ── Export selected pins to Markdown ──
  async function exportSelectedToMarkdown() {
    const store = window.QCLI?.PinStore;
    if (!store || selectedPins.size === 0) return;

    const all = await store.getAll();
    const selected = all.filter(p => selectedPins.has(p.id));
    if (selected.length === 0) return;

    const lines = [];
    lines.push('# Hesi Report (Selected)');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Selected: ${selected.length} pins*`);
    lines.push('');

    for (const pin of selected) {
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

    try {
      await navigator.clipboard.writeText(md);
      Q.showToast('Exported selected pins to clipboard', 'success');
    } catch (e) {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qcli-report-selected-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
      Q.showToast('Downloaded as Markdown file', 'success');
    }
  }

  // ── Open the report panel overlay ──
  function openReportPanel() {
    const overlay = document.getElementById('pin-report-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    renderReportPanel();
  }

  function closeReportPanel() {
    const overlay = document.getElementById('pin-report-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  async function renderReportPanel() {
    const list = document.getElementById('pin-report-list');
    const count = document.getElementById('pin-report-count');
    const store = window.QCLI?.PinStore;
    if (!list || !store) return;

    const allPins = await store.getAll();
    if (count) count.textContent = `${allPins.length} pins`;

    if (allPins.length === 0) {
      list.innerHTML = '<div class="pin-report-empty">No pins yet. Right-click terminal output → "Pin to sidebar"</div>';
      return;
    }

    list.innerHTML = '';
    for (const pin of allPins) {
      const card = document.createElement('div');
      card.className = 'pin-report-card';

      const header = document.createElement('div');
      header.className = 'pin-report-card-header';
      header.innerHTML = `
        <span class="pin-report-card-title">${escapeHtml(pin.title || pin.text.slice(0, 40) + '…')}</span>
        <span class="pin-report-card-meta">${pin.source || 'terminal'} · ${fmtDate(pin.timestamp)}</span>
      `;
      card.appendChild(header);

      const preview = document.createElement('div');
      preview.className = 'pin-report-card-preview';
      preview.textContent = stripAnsi(pin.text).slice(0, 120);
      card.appendChild(preview);

      if (pin.tags && pin.tags.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'pin-report-card-tags';
        for (const tag of pin.tags) {
          const chip = document.createElement('span');
          chip.className = 'pin-tag';
          chip.textContent = tag;
          tags.appendChild(chip);
        }
        card.appendChild(tags);
      }

      list.appendChild(card);
    }
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
  function init() {
    // Enhance pinned section header
    const header = document.querySelector('.pinned-header');
    if (header) {
      // Guard: prevent duplicate header actions if init() runs multiple times
      if (header.querySelector('.pinned-header-actions')) return;

      const actions = document.createElement('div');
      actions.className = 'pinned-header-actions';
      actions.style.display = 'flex';
      actions.style.gap = '2px';

      // Sort button
      const sortBtn = document.createElement('button');
      sortBtn.className = 'pinned-header-btn';
      sortBtn.textContent = '⇅';
      sortBtn.title = 'Sort pins (date/source/title)';
      attachTip(sortBtn, '切换排序方式：按时间 / 来源 / 标题（循环切换）');
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleSort();
      });
      actions.appendChild(sortBtn);

      // Merge button
      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'pinned-header-btn';
      mergeBtn.textContent = '⊞';
      mergeBtn.title = 'Merge mode';
      attachTip(mergeBtn, '进入合并模式：勾选多条钉住内容，合并成一条报告（便于一次性导出）');
      mergeBtn.id = 'pin-merge-btn';
      mergeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMergeMode();
      });
      actions.appendChild(mergeBtn);

      // Export all button
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

      header.appendChild(actions);
    }

    // Merge bar (below pinned header)
    const mergeBar = document.createElement('div');
    mergeBar.id = 'pin-merge-bar';
    mergeBar.className = 'pin-merge-bar hidden';

    const mergeCount = document.createElement('span');
    mergeCount.id = 'pin-merge-count';
    mergeCount.className = 'pin-merge-count';
    mergeBar.appendChild(mergeCount);

    const mergeBtn = document.createElement('button');
    mergeBtn.className = 'pin-merge-action-btn';
    mergeBtn.textContent = '🔗 Merge';
    mergeBtn.addEventListener('click', mergeSelectedPins);
    mergeBar.appendChild(mergeBtn);

    const exportSelBtn = document.createElement('button');
    exportSelBtn.className = 'pin-merge-action-btn';
    exportSelBtn.textContent = '📥 Export selected';
    exportSelBtn.addEventListener('click', exportSelectedToMarkdown);
    mergeBar.appendChild(exportSelBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pin-merge-action-btn cancel';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.addEventListener('click', () => {
      mergeMode = false;
      selectedPins.clear();
      document.querySelectorAll('.pin-checkbox').forEach(cb => {
        cb.style.display = 'none';
        cb.checked = false;
      });
      mergeBar.classList.add('hidden');
      updateMergeActions();
    });
    mergeBar.appendChild(cancelBtn);

    const section = document.getElementById('pinned-section');
    if (section) {
      section.appendChild(mergeBar);
    }

    // Report panel overlay — close on overlay click
    const overlay = document.getElementById('pin-report-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeReportPanel();
      });
    }

    // Close button
    const closeBtn = document.getElementById('pin-report-close');
    if (closeBtn) closeBtn.addEventListener('click', closeReportPanel);
  }

  function cycleSort() {
    const modes = ['date', 'source', 'title'];
    const labels = { date: 'by date', source: 'by source', title: 'by title' };
    const idx = modes.indexOf(sortBy);
    sortBy = modes[(idx + 1) % modes.length];
    renderPinnedList();
    Q.showToast(`Sorted ${labels[sortBy]}`, 'info');
  }

  // ── Export API ──
  export const PinReport = {
    renderPinnedList,
    openReportPanel,
    closeReportPanel,
    exportPinsToMarkdown,
    exportSelectedToMarkdown,
    mergeSelectedPins,
    toggleMergeMode,
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
