/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <browser-farm-panel> — 跨会话浏览器农场面板
//
// 管理多个隔离浏览器会话（context），支持创建、切换、关闭。
// 通过 UIRegistry 注册。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @returns {QCLI} */
function Q() { return window.QCLI || {}; }

let _contexts = [];
let _activeIndex = 0;

/** @type {{ panel:HTMLElement, list:HTMLElement|null }} */
let dom = null;

async function fetchContexts() {
  try {
    const resp = await fetch('/api/browser/farm/contexts');
    const data = await resp.json();
    if (data.success) {
      _contexts = data.contexts || [];
      _activeIndex = data.activeContext || 0;
    }
    return data;
  } catch { return { contexts: [] }; }
}

async function createContext(label) {
  try {
    const resp = await fetch('/api/browser/farm/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

async function switchContext(index) {
  try {
    const resp = await fetch('/api/browser/farm/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

async function closeContext(index) {
  try {
    const resp = await fetch('/api/browser/farm/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

function renderList() {
  if (!dom || !dom.list) return;
  dom.list.innerHTML = '';

  if (_contexts.length === 0) {
    dom.list.innerHTML = '<div class="bf-empty"><div class="bf-empty-icon">🌾</div><p>没有活跃的浏览器会话</p><p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">先连接浏览器，然后创建新会话</p></div>';
    return;
  }

  for (let i = 0; i < _contexts.length; i++) {
    const ctx = _contexts[i];
    const isActive = i === _activeIndex;
    const item = document.createElement('div');
    item.className = 'bf-session' + (isActive ? ' active' : '');

    // Status indicator
    const status = document.createElement('div');
    status.className = 'bf-session-status' + (isActive ? ' online' : '');
    item.appendChild(status);

    // Info
    const info = document.createElement('div');
    info.className = 'bf-session-info';
    const header = document.createElement('div');
    header.className = 'bf-session-header';
    header.innerHTML = `<span class="bf-session-name">${escapeHtml(ctx.label || 'Session #' + i)}</span>
      <span class="bf-session-id">ctx-${i}</span>
      ${isActive ? '<span class="bf-session-badge">当前</span>' : ''}`;
    info.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'bf-session-meta';
    meta.textContent = `${ctx.pages || 0} 个页面 · ${ctx.createdAt ? timeAgo(ctx.createdAt) : '刚刚'}`;
    info.appendChild(meta);

    if (ctx.urls && ctx.urls.length > 0) {
      const urls = document.createElement('div');
      urls.className = 'bf-session-urls';
      urls.textContent = ctx.urls.slice(0, 3).join(', ') + (ctx.urls.length > 3 ? ` +${ctx.urls.length - 3}` : '');
      info.appendChild(urls);
    }

    item.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'bf-session-actions';

    if (!isActive) {
      const switchBtn = document.createElement('button');
      switchBtn.className = 'bf-action-btn';
      switchBtn.textContent = '切换';
      switchBtn.title = '切换到该会话';
      switchBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await switchContext(i);
        if (result.success) {
          await refreshList();
          const toast = Q().showToast;
          if (toast) toast(`已切换到会话 #${i}`, 'success');
        }
      });
      actions.appendChild(switchBtn);
    }

    if (i > 0) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'bf-action-btn danger';
      closeBtn.textContent = '✕';
      closeBtn.title = '关闭会话';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const result = await closeContext(i);
        if (result.success) {
          await refreshList();
          const toast = Q().showToast;
          if (toast) toast(result.message, 'info');
        }
      });
      actions.appendChild(closeBtn);
    }

    item.appendChild(actions);
    dom.list.appendChild(item);
  }
}

function refreshList() {
  return fetchContexts().then(() => renderList());
}

function init(container) {
  container.innerHTML = `
    <div class="bf-panel">
      <div class="bf-toolbar">
        <button class="bf-btn primary" id="bf-create-btn">+ 新建会话</button>
        <button class="bf-btn" id="bf-refresh-btn">🔄 刷新</button>
      </div>
      <div class="bf-list" id="bf-list">
        <div class="bf-empty">加载中...</div>
      </div>
    </div>
  `;

  dom = { panel: container, list: container.querySelector('#bf-list') };

  container.querySelector('#bf-create-btn').addEventListener('click', async () => {
    const label = prompt('会话标签（可选）：');
    const result = await createContext(label || undefined);
    if (result.success) {
      await refreshList();
      const toast = Q().showToast;
      if (toast) toast(result.message, 'success');
    } else {
      const toast = Q().showToast;
      if (toast) toast('创建失败: ' + (result.error || '未知错误'), 'error');
    }
  });

  container.querySelector('#bf-refresh-btn').addEventListener('click', refreshList);

  refreshList();
}

function timeAgo(ts) {
  if (!ts) return '刚刚';
  const diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

// ── UIRegistry Registration ──
(function register() {
  const Qq = window.QCLI || {};
  const UIR = Qq.UIRegistry;
  if (!UIR) { setTimeout(register, 500); return; }

  UIR.registerTab('browser-farm', {
    category: "other",
    icon: '🌾',
    label: '浏览器农场',
    order: 21,
    render: (container) => init(container),
  });

  UIR.registerCommand('browser-farm:open', {
    icon: '🌾',
    name: '打开浏览器农场',
    desc: '管理多个隔离的浏览器会话',
    category: 'browser',
    execute: () => {
      const rp = Qq.RightPanel;
      if (rp) { if (rp.collapsed) rp.open(); rp.switchTab('browser-farm'); }
    },
  });

  console.log('[BrowserFarm] Panel registered');
})();
