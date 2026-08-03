/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <browser-scripts-panel> — 浏览器脚本管理面板
//
// 注册为右侧面板的「浏览器脚本」标签页 (📜)。
// 提供：脚本列表、启用/禁用开关、新建/编辑/删除功能。
// 通过 UIRegistry 注册，符合插件体系。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

// ── State ──
let _scripts = [];
let _filterText = '';
let _editingScript = null;

// ── DOM 引用（懒缓存） ──
/** @type {{ panel:HTMLElement, list:HTMLElement, searchInput:HTMLInputElement|null, addBtn:HTMLElement|null }} */
let dom = null;

// ============================================================
// API 调用
// ============================================================

async function fetchScripts() {
  try {
    const resp = await fetch('/api/browser/scripts');
    const data = await resp.json();
    _scripts = data.scripts || [];
    return _scripts;
  } catch {
    _scripts = [];
    return [];
  }
}

async function toggleScript(id) {
  try {
    const resp = await fetch(`/api/browser/scripts/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
    const data = await resp.json();
    if (!data.success) return false;
    const script = _scripts.find(s => s.id === id);
    if (script) script.enabled = data.enabled;
    return true;
  } catch {
    return false;
  }
}

async function deleteScript(id) {
  try {
    const resp = await fetch(`/api/browser/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return resp.ok;
  } catch {
    return false;
  }
}

async function saveScript(scriptData) {
  try {
    const method = scriptData.id ? 'PUT' : 'POST';
    const url = scriptData.id
      ? `/api/browser/scripts/${encodeURIComponent(scriptData.id)}`
      : '/api/browser/scripts';
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scriptData),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Save failed');
    return data.script;
  } catch (err) {
    throw err;
  }
}

// ============================================================
// 渲染
// ============================================================

function renderList() {
  if (!dom || !dom.list) return;

  const filtered = _filterText
    ? _scripts.filter(s =>
        s.name.toLowerCase().includes(_filterText) ||
        s.urlPattern.toLowerCase().includes(_filterText) ||
        (s.tags || []).some(t => t.toLowerCase().includes(_filterText))
      )
    : _scripts;

  dom.list.innerHTML = '';

  if (filtered.length === 0) {
    dom.list.innerHTML = `<div class="bs-empty">${_filterText ? '没有匹配的脚本' : '还没有创建任何脚本\n点击"+ 新建脚本"开始'}</div>`;
    return;
  }

  for (const script of filtered) {
    const item = document.createElement('div');
    item.className = 'bs-item' + (script.enabled ? '' : ' disabled');

    // Toggle switch
    const toggle = document.createElement('label');
    toggle.className = 'bs-toggle';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = script.enabled;
    toggleInput.addEventListener('change', async () => {
      await toggleScript(script.id);
      item.classList.toggle('disabled', !script.enabled);
    });
    toggle.appendChild(toggleInput);
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'bs-toggle-slider';
    toggle.appendChild(toggleSlider);
    item.appendChild(toggle);

    // Info
    const info = document.createElement('div');
    info.className = 'bs-item-info';

    const header = document.createElement('div');
    header.className = 'bs-item-header';
    const nameEl = document.createElement('span');
    nameEl.className = 'bs-item-name';
    nameEl.textContent = script.name;
    header.appendChild(nameEl);

    if (script.tags && script.tags.length > 0) {
      for (const tag of script.tags) {
        const tagEl = document.createElement('span');
        tagEl.className = 'bs-item-tag';
        tagEl.textContent = tag;
        header.appendChild(tagEl);
      }
    }
    info.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'bs-item-meta';
    meta.textContent = `${script.urlPattern} · 修改于 ${timeAgo(script.updatedAt)}`;
    info.appendChild(meta);

    item.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'bs-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'bs-action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(script);
    });
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'bs-action-btn danger';
    delBtn.textContent = '🗑️';
    delBtn.title = '删除';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`确定删除脚本"${script.name}"？`)) return;
      const ok = await deleteScript(script.id);
      if (ok) {
        _scripts = _scripts.filter(s => s.id !== script.id);
        renderList();
        const toast = Q().showToast;
        if (toast) toast(`已删除脚本"${script.name}"`, 'info');
      }
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);

    // Expand on click → show code preview
    item.addEventListener('click', () => {
      const preview = item.querySelector('.bs-item-preview');
      if (preview) {
        preview.classList.toggle('expanded');
      } else {
        const codePreview = document.createElement('div');
        codePreview.className = 'bs-item-preview';
        codePreview.textContent = script.code.length > 300
          ? script.code.slice(0, 300) + '\n// ...'
          : script.code;
        item.appendChild(codePreview);
        requestAnimationFrame(() => codePreview.classList.add('expanded'));
      }
    });

    dom.list.appendChild(item);
  }
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return `${day} 天前`;
}

// ============================================================
// 编辑器 Modal
// ============================================================

function openEditor(script) {
  _editingScript = script ? { ...script } : null;
  showEditor();
}

function showEditor() {
  const existing = document.getElementById('bs-editor-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'bs-editor-overlay';
  overlay.className = 'bs-editor-overlay';
  overlay.innerHTML = `
    <div class="bs-editor-panel">
      <div class="bs-editor-header">
        <span class="bs-editor-title">${_editingScript?.id ? '✏️ 编辑脚本' : '📜 新建脚本'}</span>
        <button class="bs-editor-close" id="bs-editor-close">✕</button>
      </div>
      <div class="bs-editor-body">
        <div class="bs-field">
          <label class="bs-field-label">名称</label>
          <input type="text" class="bs-field-input" id="bs-editor-name" 
                 value="${escapeHtml(_editingScript?.name || '')}" 
                 placeholder="脚本名称" maxlength="100">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">URL 匹配模式</label>
          <input type="text" class="bs-field-input bs-field-mono" id="bs-editor-urlpattern" 
                 value="${escapeHtml(_editingScript?.urlPattern || '*://*/*')}" 
                 placeholder="*://*.example.com/*">
          <div class="bs-field-hint">支持 glob 通配符：* 匹配一个路径段，** 匹配任意路径</div>
        </div>
        <div class="bs-field">
          <label class="bs-field-label">描述</label>
          <input type="text" class="bs-field-input" id="bs-editor-desc" 
                 value="${escapeHtml(_editingScript?.description || '')}" 
                 placeholder="简短描述这个脚本的作用" maxlength="500">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">标签（逗号分隔）</label>
          <input type="text" class="bs-field-input" id="bs-editor-tags" 
                 value="${escapeHtml((_editingScript?.tags || []).join(', '))}" 
                 placeholder="utility, login, automation">
        </div>
        <div class="bs-field">
          <label class="bs-field-label">JavaScript 代码</label>
          <textarea class="bs-field-textarea" id="bs-editor-code" 
                    placeholder="// 在这里编写你的用户脚本" 
                    spellcheck="false">${escapeHtml(_editingScript?.code || '')}</textarea>
          <div class="bs-field-hint">脚本在页面加载时自动执行。如果要限制在特定 URL 上运行，脚本内部判断 location.href。</div>
        </div>
      </div>
      <div class="bs-editor-footer">
        <span class="bs-editor-error" id="bs-editor-error"></span>
        <button class="bs-editor-cancel" id="bs-editor-cancel">取消</button>
        <button class="bs-editor-save" id="bs-editor-save">💾 保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Wire up events
  document.getElementById('bs-editor-close').addEventListener('click', closeEditor);
  document.getElementById('bs-editor-cancel').addEventListener('click', closeEditor);
  document.getElementById('bs-editor-save').addEventListener('click', handleSave);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditor();
  });

  // Keyboard shortcuts
  const keyHandler = (e) => {
    if (e.key === 'Escape') closeEditor();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSave();
  };
  document.addEventListener('keydown', keyHandler);
  overlay._keyHandler = keyHandler;

  // Focus name field
  setTimeout(() => document.getElementById('bs-editor-name').focus(), 100);
}

function closeEditor() {
  const overlay = document.getElementById('bs-editor-overlay');
  if (overlay) {
    if (overlay._keyHandler) {
      document.removeEventListener('keydown', overlay._keyHandler);
    }
    overlay.remove();
  }
  _editingScript = null;
}

async function handleSave() {
  const name = document.getElementById('bs-editor-name').value.trim();
  const urlPattern = document.getElementById('bs-editor-urlpattern').value.trim();
  const description = document.getElementById('bs-editor-desc').value.trim();
  const tagsRaw = document.getElementById('bs-editor-tags').value.trim();
  const code = document.getElementById('bs-editor-code').value;
  const errorEl = document.getElementById('bs-editor-error');

  if (!name) { errorEl.textContent = '名称不能为空'; return; }
  if (!code) { errorEl.textContent = '代码不能为空'; return; }
  if (!urlPattern) { errorEl.textContent = 'URL 匹配模式不能为空'; return; }

  errorEl.textContent = '';
  const saveBtn = document.getElementById('bs-editor-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  try {
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const scriptData = {
      name,
      urlPattern,
      description,
      tags,
      code,
      ...(_editingScript?.id ? { id: _editingScript.id } : {}),
    };

    await saveScript(scriptData);
    closeEditor();
    await refreshList();
    const toast = Q().showToast;
    if (toast) toast(`脚本"${name}"已保存`, 'success');
  } catch (err) {
    errorEl.textContent = `保存失败: ${err.message}`;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 保存';
  }
}

// ============================================================
// 刷新列表
// ============================================================

async function refreshList() {
  await fetchScripts();
  renderList();
}

// ============================================================
// 初始化
// ============================================================

function init(container) {
  container.innerHTML = `
    <div class="bs-panel">
      <div class="bs-search-bar">
        <input type="text" class="bs-search-input" id="bs-search-input"
               placeholder="🔍 搜索脚本..." aria-label="搜索脚本" >
      </div>
      <div class="bs-list" id="bs-list">
        <div class="bs-empty">加载中...</div>
      </div>
      <div class="bs-toolbar">
        <button class="bs-toolbar-btn primary" id="bs-add-btn">+ 新建脚本</button>
        <button class="bs-toolbar-btn" id="bs-refresh-btn">🔄 刷新</button>
      </div>
    </div>
  `;

  dom = {
    panel: container,
    list: container.querySelector('#bs-list'),
    searchInput: container.querySelector('#bs-search-input'),
  };

  // Search
  dom.searchInput.addEventListener('input', (e) => {
    _filterText = e.target.value.toLowerCase().trim();
    renderList();
  });

  // Add button
  container.querySelector('#bs-add-btn').addEventListener('click', () => openEditor(null));

  // Refresh button
  container.querySelector('#bs-refresh-btn').addEventListener('click', refreshList);

  // Load data
  refreshList();
}

// ============================================================
// 注册到 UIRegistry
// ============================================================

(function register() {
  const Qq = /** @type {QCLI} */ (window.QCLI || {});
  const UIR = Qq.UIRegistry;

  if (!UIR) {
    console.warn('[BrowserScripts] UIRegistry not available, will retry');
    setTimeout(register, 500);
    return;
  }

  const ok = UIR.registerTab('browser-scripts', {
    category: "other",
    icon: '📜',
    label: '浏览器脚本',
    order: 20,
    render: (container) => init(container),
  });

  if (ok) {
    console.log('[BrowserScripts] Panel registered as "browser-scripts" tab');
  }

  // 注册右键菜单项
  UIR.registerMenuItem('browser-scripts:new-from-selection', {
    label: '📜 为此页面创建脚本',
    requiresSelection: false,
    order: 80,
    action: async (selection, _term) => {
      // 获取当前页面 URL
      let currentUrl = '';
      try {
        // 尝试从浏览器标签获取 URL（必须 await，否则编辑器打开时 URL 仍为空）
        const resp = await fetch('/api/browser/ping');
        const data = await resp.json();
        if (data.connected && data.url) currentUrl = data.url;
      } catch (e) { console.warn('[BrowserScripts] Failed to fetch browser ping:', e?.message); }

      // 打开编辑器，预填代码
      const code = selection
        ? `// Created from terminal selection\n// URL: ${currentUrl || 'unknown'}\n\n${selection}`
        : '// 在此编写脚本\nconsole.log("Browser script running on:", location.href);\n';

      openEditor({
        name: '',
        urlPattern: currentUrl ? currentUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1/*') : '*://*/*',
        description: '从终端创建的脚本',
        code,
        tags: ['terminal'],
      });
    },
  });

  // 注册命令面板命令
  UIR.registerCommand('browser-scripts:open', {
    icon: '📜',
    name: '打开浏览器脚本管理',
    desc: '管理用户脚本（新建、编辑、启用/禁用）',
    category: 'browser',
    execute: () => {
      const Qright = Qq.RightPanel;
      if (Qright) {
        if (Qright.collapsed) Qright.open();
        Qright.switchTab('browser-scripts');
      }
    },
  });

  // 注入 CSS 样式
  Qq.injectCSS('/css/browser-scripts.css');
})();
