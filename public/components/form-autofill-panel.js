/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <form-autofill-panel> — 表单自动填表面板
//
// 检测页面表单字段，预览并一键填充。
// 通过 UIRegistry 注册。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

function Q() { return window.QCLI || {}; }

let _formData = null;
/** @type {{ panel:HTMLElement, list:HTMLElement|null, statusBar:HTMLElement|null }} */
let dom = null;

async function detectForms() {
  try {
    const resp = await fetch('/api/browser/detect-forms', { method: 'POST' });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

async function fillForms(fields) {
  try {
    const resp = await fetch('/api/browser/fill-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

function renderFormData() {
  if (!dom || !dom.list) return;

  if (!_formData || !_formData.forms || _formData.forms.length === 0) {
    dom.list.innerHTML = '<div class="af-empty"><div class="af-empty-icon">📝</div><p>未检测到表单</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">导航到包含表单的页面后点击「检测表单」</p></div>';
    return;
  }

  let html = '';
  for (let fi = 0; fi < _formData.forms.length; fi++) {
    const form = _formData.forms[fi];
    if (form.fields.length === 0) continue;

    html += `<div class="af-form-section">
      <div class="af-form-header">
        <span class="af-form-title">表单 ${fi + 1}${form.id ? ' #' + escapeHtml(form.id) : ''}</span>
        <span class="af-form-action">${escapeHtml(form.method || 'GET')} ${form.action ? '→ ' + escapeHtml(form.action.slice(0, 40)) : ''}</span>
        <span class="af-form-count">${form.fieldCount} 字段</span>
      </div>`;

    for (let i = 0; i < form.fields.length; i++) {
      const f = form.fields[i];
      html += `<div class="af-field">
        <div class="af-field-label">
          <span class="af-field-name">${escapeHtml(f.label || f.name || f.id || 'unknown')}</span>
          ${f.required ? '<span class="af-field-required">*</span>' : ''}
          <span class="af-field-type">${escapeHtml(f.type || f.tag)}</span>
        </div>
        <div class="af-field-input-row">
          <input type="text" class="af-field-input" id="af-input-${fi}-${i}"
            placeholder="${escapeHtml(f.placeholder || '输入值...')}"
            value="${escapeHtml(f.value || '')}"
            data-form="${fi}" data-field="${i}" />
          <button class="af-fill-btn" data-form="${fi}" data-field="${i}" title="仅填充此字段">▶</button>
        </div>
        <div class="af-field-meta">${f.name ? 'name="' + escapeHtml(f.name) + '"' : ''}${f.id ? ' id="' + escapeHtml(f.id) + '"' : ''}</div>
        ${f.options ? '<div class="af-field-options">选项: ' + f.options.map(o => escapeHtml(o.text)).join(', ') + '</div>' : ''}
      </div>`;
    }

    // "Fill all" button for this form
    html += `<button class="af-btn af-fill-all" data-form-index="${fi}">📝 填写此表单所有字段</button>`;
    html += `</div>`;
  }

  dom.list.innerHTML = html;

  // Wire up individual fill buttons
  dom.list.querySelectorAll('.af-fill-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fi = parseInt(btn.dataset.form);
      const fieldI = parseInt(btn.dataset.field);
      const field = _formData.forms[fi]?.fields[fieldI];
      if (!field) return;

      const input = /** @type {HTMLInputElement} */ (document.getElementById(`af-input-${fi}-${fieldI}`));
      const value = input ? input.value : '';

      const result = await fillForms([{
        name: field.name,
        id: field.id,
        value: value,
        type: field.type,
      }]);

      const toast = Q().showToast;
      if (result.success && result.filled > 0) {
        if (toast) toast(`✅ 已填充: ${field.label || field.name}`, 'success');
      } else {
        if (toast) toast(`❌ 填充失败: ${result.error || '未知错误'}`, 'error');
      }
    });
  });

  // Wire up fill-all buttons
  dom.list.querySelectorAll('.af-fill-all').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fi = parseInt(btn.dataset.formIndex);
      const form = _formData.forms[fi];
      if (!form) return;

      const fields = [];
      for (let i = 0; i < form.fields.length; i++) {
        const input = /** @type {HTMLInputElement} */ (document.getElementById(`af-input-${fi}-${i}`));
        const value = input ? input.value : '';
        if (value) {
          fields.push({
            name: form.fields[i].name,
            id: form.fields[i].id,
            value: value,
            type: form.fields[i].type,
          });
        }
      }

      if (fields.length === 0) {
        const toast = Q().showToast;
        if (toast) toast('请先输入要填充的值', 'info');
        return;
      }

      const result = await fillForms(fields);
      const toast = Q().showToast;
      if (result.success) {
        if (toast) toast(`✅ 已填充 ${result.filled}/${result.attempted} 个字段`, 'success');
      } else {
        if (toast) toast(`❌ 填充失败: ${result.error}`, 'error');
      }
    });
  });

  // Auto-fill suggestion buttons
  const statusBar = dom.statusBar;
  if (statusBar) {
    statusBar.innerHTML = `
      <span class="af-stat">表单: ${_formData.formCount || 0}</span>
      <span class="af-stat">字段: ${_formData.totalFields || 0}</span>
    `;
  }
}

function init(container) {
  container.innerHTML = `
    <div class="af-panel">
      <div class="af-toolbar">
        <button class="af-btn primary" id="af-detect-btn">🔍 检测表单</button>
        <button class="af-btn" id="af-clear-btn">🗑 清除</button>
      </div>
      <div class="af-status-bar" id="af-status-bar">
        <span class="af-stat">点击「检测表单」开始</span>
      </div>
      <div class="af-list" id="af-list">
        <div class="af-empty"><div class="af-empty-icon">📝</div><p>检测页面上的表单字段</p></div>
      </div>
    </div>
  `;

  dom = {
    panel: container,
    list: container.querySelector('#af-list'),
    statusBar: container.querySelector('#af-status-bar'),
  };

  container.querySelector('#af-detect-btn').addEventListener('click', async () => {
    const result = await detectForms();
    if (result.success) {
      _formData = result;
      renderFormData();
      const toast = Q().showToast;
      if (toast) toast(`检测到 ${result.formCount} 个表单，${result.totalFields} 个字段`, 'success');
    } else {
      const toast = Q().showToast;
      if (toast) toast('检测失败: ' + (result.error || ''), 'error');
    }
  });

  container.querySelector('#af-clear-btn').addEventListener('click', () => {
    _formData = null;
    dom.list.innerHTML = '<div class="af-empty"><div class="af-empty-icon">📝</div><p>检测页面上的表单字段</p></div>';
    if (dom.statusBar) dom.statusBar.innerHTML = '<span class="af-stat">点击「检测表单」开始</span>';
  });
}

// ── UIRegistry Registration ──
(function register() {
  const Qq = window.QCLI || {};
  const UIR = Qq.UIRegistry;
  if (!UIR) { setTimeout(register, 500); return; }

  UIR.registerTab('form-autofill', {
    icon: '📝',
    label: '表单填表',
    category: 'other',
    order: 23,
    render: (container) => init(container),
  });

  UIR.registerCommand('form-autofill:open', {
    icon: '📝',
    name: '打开表单自动填表',
    desc: '检测并填充页面表单',
    category: 'browser',
    execute: () => {
      const rp = Qq.RightPanel;
      if (rp) { if (rp.collapsed) rp.open(); rp.switchTab('form-autofill'); }
    },
  });

  console.log('[FormAutofill] Panel registered');
})();
