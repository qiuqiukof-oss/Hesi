// ============================================================
// Plugin Manager Panel — Right sidebar panel for managing plugins
//
// Registered as a UIRegistry tab. Shows installed plugins with:
//   - Enable/disable toggle
//   - Version + author info
//   - Capabilities list (CLIs, workflows, etc.)
//   - Quick uninstall
//   - Link to plugin market page
//   - Plugin creation wizard (scaffold new plugin)
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});

// ── State ──
const state = {
  plugins: [],
  loading: false,
  detail: null, // expanded plugin detail
};

// ── CSS (injected once) ──
(function injectCSS() {
  const id = 'pm-panel-css';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    /* ── Plugin Manager Panel ── */
    .pmp-container {
      padding: 8px;
      height: 100%;
      overflow-y: auto;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      align-content: start;
    }
    .pmp-container > .pmp-header,
    .pmp-container > .pmp-stats,
    .pmp-container > .pmp-empty {
      grid-column: 1 / -1;
    }

    .pmp-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px 8px;
      border-bottom: 1px solid var(--border-default, rgba(255,255,255,0.06));
      margin-bottom: 4px;
    }
    .pmp-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }
    .pmp-header-btn {
      background: none;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      color: var(--text-secondary, #98989d);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .pmp-header-btn:hover {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
      border-color: var(--accent, #6366f1);
    }

    /* ── Stats bar ── */
    .pmp-stats {
      display: flex;
      gap: 12px;
      padding: 4px 4px;
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
    }
    .pmp-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .pmp-stat-val {
      font-weight: 600;
      color: var(--text-secondary, #98989d);
    }

    /* ── Plugin cards ── */
    .pmp-card {
      background: var(--bg-overlay, rgba(255,255,255,0.02));
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      border-radius: 10px;
      padding: 10px 12px;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .pmp-card:hover {
      border-color: var(--accent, #6366f1);
      background: var(--bg-hover, rgba(99,102,241,0.04));
    }
    .pmp-card.disabled {
      opacity: 0.55;
    }

    .pmp-card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .pmp-card-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .pmp-card-info {
      flex: 1;
      min-width: 0;
    }
    .pmp-card-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pmp-card-meta {
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 1px;
    }

    /* ── Toggle switch ── */
    .pmp-toggle {
      position: relative;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .pmp-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .pmp-toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: var(--bg-hover, rgba(255,255,255,0.08));
      border-radius: 9px;
      transition: all 0.2s ease;
    }
    .pmp-toggle-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      left: 2px;
      bottom: 2px;
      background: var(--text-tertiary, #71717a);
      border-radius: 50%;
      transition: all 0.2s ease;
    }
    .pmp-toggle input:checked + .pmp-toggle-slider {
      background: var(--accent, #6366f1);
    }
    .pmp-toggle input:checked + .pmp-toggle-slider::before {
      transform: translateX(14px);
      background: #fff;
    }

    /* ── Capability badges ── */
    .pmp-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 8px;
    }
    .pmp-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-tertiary, #71717a);
      border: 1px solid var(--border-default, rgba(255,255,255,0.04));
      white-space: nowrap;
    }
    .pmp-badge.cli { color: #22c55e; border-color: rgba(34,197,94,0.2); background: rgba(34,197,94,0.06); }
    .pmp-badge.workflow { color: #6366f1; border-color: rgba(99,102,241,0.2); background: rgba(99,102,241,0.06); }
    .pmp-badge.aiTool { color: #f59e0b; border-color: rgba(245,158,11,0.2); background: rgba(245,158,11,0.06); }
    .pmp-badge.route { color: #06b6d4; border-color: rgba(6,182,212,0.2); background: rgba(6,182,212,0.06); }
    .pmp-badge.preset { color: #a855f7; border-color: rgba(168,85,247,0.2); background: rgba(168,85,247,0.06); }
    .pmp-badge.mcp { color: #ec4899; border-color: rgba(236,72,153,0.2); background: rgba(236,72,153,0.06); }
    .pmp-badge.ui { color: #14b8a6; border-color: rgba(20,185,166,0.2); background: rgba(20,185,166,0.06); }

    /* ── Card actions ── */
    .pmp-card-actions {
      display: none;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-default, rgba(255,255,255,0.04));
    }
    .pmp-card:hover .pmp-card-actions {
      display: flex;
    }
    .pmp-action-btn {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 6px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      background: none;
      color: var(--text-secondary, #98989d);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pmp-action-btn:hover {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-action-btn.danger {
      color: #ef4444;
      border-color: rgba(239,68,68,0.15);
    }
    .pmp-action-btn.danger:hover {
      background: rgba(239,68,68,0.1);
    }

    /* ── Empty state ── */
    .pmp-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
      gap: 8px;
      padding: 40px 20px;
      text-align: center;
    }
    .pmp-empty-icon { font-size: 36px; }
    .pmp-empty-action {
      margin-top: 8px;
      padding: 6px 16px;
      border-radius: 8px;
      border: 1px solid var(--accent, #6366f1);
      background: var(--accent, #6366f1);
      color: #fff;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pmp-empty-action:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }

    /* ── Loading ── */
    .pmp-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 8px;
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
    }
    .pmp-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border-default, rgba(255,255,255,0.08));
      border-top-color: var(--accent, #6366f1);
      border-radius: 50%;
      animation: pmp-spin 0.6s linear infinite;
    }
    @keyframes pmp-spin {
      to { transform: rotate(360deg); }
    }

    /* ── Detail view ── */
    .pmp-detail-back {
      display: flex; align-items: center; gap: 6px;
      background: none; border: none; color: var(--text-secondary, #98989d);
      font-size: 12px; cursor: pointer; padding: 4px 0; margin-bottom: 8px;
      transition: color 0.15s;
    }
    .pmp-detail-back:hover { color: var(--text-primary, #f5f5f7); }

    .pmp-detail-header {
      display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
    }
    .pmp-detail-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: var(--bg-hover, rgba(255,255,255,0.04));
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .pmp-detail-title {
      font-size: 16px; font-weight: 700; color: var(--text-primary, #f5f5f7);
    }
    .pmp-detail-subtitle {
      font-size: 11px; color: var(--text-tertiary, #71717a);
      margin-top: 1px;
    }
    .pmp-detail-status {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; padding: 2px 8px; border-radius: 10px;
      font-weight: 500;
    }
    .pmp-detail-status.loaded {
      background: rgba(34,197,94,0.1); color: #22c55e;
    }
    .pmp-detail-status.disabled {
      background: rgba(239,68,68,0.1); color: #ef4444;
    }

    .pmp-detail-section {
      background: var(--bg-overlay, rgba(255,255,255,0.02));
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    }
    .pmp-detail-section-title {
      font-size: 11px; font-weight: 600; color: var(--text-tertiary, #71717a);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .pmp-detail-row {
      display: flex; align-items: baseline;
      padding: 3px 0; font-size: 12px;
    }
    .pmp-detail-label {
      color: var(--text-tertiary, #71717a); width: 80px; flex-shrink: 0;
    }
    .pmp-detail-value {
      color: var(--text-primary, #f5f5f7); word-break: break-all;
    }
    .pmp-detail-value.missing {
      color: var(--text-tertiary, #71717a); font-style: italic;
    }

    .pmp-detail-code {
      font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', monospace);
      font-size: 11px; background: rgba(0,0,0,0.2);
      border-radius: 6px; padding: 8px 10px; overflow-x: auto;
      white-space: pre-wrap; word-break: break-word;
      color: var(--text-secondary, #98989d); line-height: 1.5;
      margin-top: 4px;
    }

    .pmp-detail-cap-item {
      padding: 6px 0; border-bottom: 1px solid var(--border-default, rgba(255,255,255,0.04));
      font-size: 12px;
    }
    .pmp-detail-cap-item:last-child { border-bottom: none; }
    .pmp-detail-cap-name {
      font-weight: 600; color: var(--text-primary, #f5f5f7);
    }
    .pmp-detail-cap-desc {
      font-size: 11px; color: var(--text-tertiary, #71717a); margin-top: 2px;
    }
    .pmp-detail-cap-table {
      margin-top: 4px; font-size: 11px; width: 100%;
      border-collapse: collapse;
    }
    .pmp-detail-cap-table td {
      padding: 2px 8px 2px 0; vertical-align: top;
      color: var(--text-secondary, #98989d);
    }
    .pmp-detail-cap-table td:first-child {
      color: var(--text-tertiary, #71717a); width: 70px;
    }

    /* ── Create dialog ── */
    .pmp-create-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(5,5,8,0.7);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pmp-fade-in 0.15s ease;
    }
    .pmp-create-overlay.hidden { display: none; }
    @keyframes pmp-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .pmp-create-dialog {
      width: 440px;
      max-width: 90vw;
      max-height: 85vh;
      overflow-y: auto;
      background: var(--bg-overlay, #1c1c1e);
      border: 1px solid var(--border-default, rgba(255,255,255,0.1));
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .pmp-create-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f7);
      margin: 0 0 16px;
    }

    .pmp-create-field {
      margin-bottom: 12px;
    }
    .pmp-create-field label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary, #98989d);
      margin-bottom: 4px;
    }
    .pmp-create-field input,
    .pmp-create-field textarea {
      width: 100%;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
      background: var(--bg-input, rgba(255,255,255,0.04));
      color: var(--text-primary, #f5f5f7);
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }
    .pmp-create-field input:focus,
    .pmp-create-field textarea:focus {
      outline: none;
      border-color: var(--accent, #6366f1);
    }
    .pmp-create-field textarea {
      resize: vertical;
      min-height: 50px;
    }
    .pmp-create-field small {
      display: block;
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      margin-top: 2px;
    }

    .pmp-features-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
    }
    .pmp-feature-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-default, rgba(255,255,255,0.06));
      background: none;
      color: var(--text-secondary, #98989d);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pmp-feature-chip:hover {
      border-color: var(--accent, #6366f1);
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-feature-chip.selected {
      border-color: var(--accent, #6366f1);
      background: rgba(99,102,241,0.1);
      color: var(--text-primary, #f5f5f7);
    }
    .pmp-feature-icon { font-size: 14px; }

    .pmp-create-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .pmp-create-btn {
      padding: 7px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      border: none;
    }
    .pmp-create-btn.primary {
      background: var(--accent, #6366f1);
      color: #fff;
    }
    .pmp-create-btn.primary:hover { opacity: 0.9; }
    .pmp-create-btn.primary:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .pmp-create-btn.secondary {
      background: var(--bg-hover, rgba(255,255,255,0.04));
      color: var(--text-secondary, #98989d);
      border: 1px solid var(--border-default, rgba(255,255,255,0.08));
    }
    .pmp-create-btn.secondary:hover {
      color: var(--text-primary, #f5f5f7);
    }

    .pmp-create-error {
      color: #ef4444;
      font-size: 12px;
      margin-top: 8px;
    }
    .pmp-create-success {
      color: #22c55e;
      font-size: 12px;
      margin-top: 8px;
    }
  `;
  document.head.appendChild(style);
})();

// ============================================================
// Plugin Loader
// ============================================================

function loadPlugins() {
  state.loading = true;
  render();

  fetch('/api/plugins/all')
    .then(r => r.json())
    .then(data => {
      state.plugins = data.plugins || [];
      state.loading = false;
      render();
    })
    .catch(err => {
      console.error('[PluginManager] Failed to load plugins:', err);
      state.loading = false;
      render();
    });
}

// ============================================================
// Toggle Plugin
// ============================================================

function togglePlugin(name, enabled) {
  fetch('/api/plugins/' + encodeURIComponent(name) + '/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        loadPlugins();
      } else {
        Q.showToast?.('插件切换失败: ' + (data.error || '未知错误'), 'error');
      }
    })
    .catch(err => {
      Q.showToast?.('网络错误: ' + err.message, 'error');
    });
}

// ============================================================
// Uninstall Plugin
// ============================================================

function uninstallPlugin(name) {
  if (!confirm('确定要卸载插件 "' + name + '" 吗？插件目录将被删除。')) return;

  fetch('/api/plugins/market/installed/' + encodeURIComponent(name), {
    method: 'DELETE',
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        Q.showToast?.('✅ 插件 "' + name + '" 已卸载', 'success');
        loadPlugins();
      } else {
        Q.showToast?.('卸载失败: ' + (data.error || '未知错误'), 'error');
      }
    })
    .catch(err => {
      Q.showToast?.('卸载失败: ' + err.message, 'error');
    });
}

// ============================================================
// Render
// ============================================================

function render() {
  const container = document.getElementById('rp-plugin-manager');
  if (!container) return;

  if (state.loading) {
    container.innerHTML = '<div class="pmp-loading"><div class="pmp-spinner"></div><span>加载插件列表...</span></div>';
    return;
  }

  // Detail view
  if (state.detail) {
    container.innerHTML = renderDetailView(state.detail);
    return;
  }

  const enabled = state.plugins.filter(p => p.enabled);
  const disabled = state.plugins.filter(p => !p.enabled);

  let html = '<div class="pmp-container">';

  // Header
  html += '<div class="pmp-header">' +
    '<h3>🔌 插件管理</h3>' +
    '<div class="pmp-header-actions">' +
    '<button class="pmp-header-btn" onclick="PMANAGER.openMarket()">🏪 广场</button>' +
    '<button class="pmp-header-btn" onclick="PMANAGER.openCreate()">+ 新建</button>' +
    '<button class="pmp-header-btn" onclick="PMANAGER.refresh()">⟳</button>' +
    '</div></div>';

  // Stats
  html += '<div class="pmp-stats">' +
    '<span class="pmp-stat">已加载 <span class="pmp-stat-val">' + enabled.length + '</span></span>' +
    '<span class="pmp-stat">已禁用 <span class="pmp-stat-val">' + disabled.length + '</span></span>' +
    '<span class="pmp-stat">共 <span class="pmp-stat-val">' + state.plugins.length + '</span></span>' +
    '</div>';

  if (state.plugins.length === 0) {
    html += '<div class="pmp-empty">' +
      '<div class="pmp-empty-icon">🔌</div>' +
      '<div>还没有安装任何插件</div>' +
      '<div style="font-size:11px;color:var(--text-tertiary);">点击「广场」浏览社区插件，或「新建」创建你自己的插件</div>' +
      '<button class="pmp-empty-action" onclick="PMANAGER.openMarket()">🏪 打开插件广场</button>' +
      '</div>';
  } else {
    // Enabled plugins
    for (const p of enabled) {
      html += renderPluginCard(p, true);
    }
    // Disabled plugins
    for (const p of disabled) {
      html += renderPluginCard(p, false);
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderPluginCard(p, enabled) {
  const icon = getPluginIcon(p);
  const version = p.version || '—';
  const author = p.author || '—';
  const capIcons = {
    clis: '🔧', workflow: '⚡', aiTool: '🤖',
    route: '🌐', preset: '🎨', mcp: '🔗', ui: '🖥️',
  };
  const capLabels = {
    clis: 'CLI', workflow: 'Workflow', aiTool: 'AI Tool',
    route: 'Route', preset: 'Preset', mcp: 'MCP', ui: 'UI',
  };

  const badges = (p.capabilities || []).map(c => {
    const ci = capIcons[c] || '📦';
    const cl = capLabels[c] || c;
    return '<span class="pmp-badge ' + c + '">' + ci + ' ' + cl + '</span>';
  }).join('');

  const disabledClass = enabled ? '' : ' disabled';

  return '<div class="pmp-card' + disabledClass + '" onclick="PMANAGER.showDetail(\'' + escapeHtml(p.name) + '\')">' +
    '<div class="pmp-card-header">' +
    '<div class="pmp-card-icon">' + icon + '</div>' +
    '<div class="pmp-card-info">' +
    '<div class="pmp-card-name">' + escapeHtml(p.name) + '</div>' +
    '<div class="pmp-card-meta">' +
    '<span>v' + escapeHtml(version) + '</span>' +
    '<span>by ' + escapeHtml(author) + '</span>' +
    '</div></div>' +
    '<label class="pmp-toggle" title="' + (enabled ? '禁用' : '启用') + '">' +
    '<input type="checkbox"' + (enabled ? ' checked' : '') +
    ' onchange="PMANAGER.toggle(\'' + escapeHtml(p.name) + '\', this.checked)" />' +
    '<span class="pmp-toggle-slider"></span></label>' +
    '</div>' +
    (badges ? '<div class="pmp-badges">' + badges + '</div>' : '') +
    '<div class="pmp-card-actions">' +
    '<button class="pmp-action-btn" onclick="PMANAGER.reload(\'' + escapeHtml(p.name) + '\')">⟳ 重载</button>' +
    '<button class="pmp-action-btn danger" onclick="PMANAGER.uninstall(\'' + escapeHtml(p.name) + '\')">🗑 卸载</button>' +
    '</div></div>';
}

// ============================================================
// Create Plugin Dialog
// ============================================================

let createDialogState = {
  name: '',
  description: '',
  author: '',
  version: '0.1.0',
  features: [],
  creating: false,
  error: '',
  success: '',
};

function openCreateDialog() {
  createDialogState = {
    name: '',
    description: '',
    author: '',
    version: '0.1.0',
    features: [],
    creating: false,
    error: '',
    success: '',
  };
  renderCreateDialog();
  document.body.insertAdjacentHTML('beforeend', '<div class="pmp-create-overlay" id="pmp-create-overlay"></div>');
  const overlay = document.getElementById('pmp-create-overlay');
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeCreateDialog();
  });
  overlay.innerHTML = '';
  const dialog = document.createElement('div');
  dialog.className = 'pmp-create-dialog';
  dialog.id = 'pmp-create-dialog';
  overlay.appendChild(dialog);
  renderCreateDialogContent();
}

function closeCreateDialog() {
  const overlay = document.getElementById('pmp-create-overlay');
  if (overlay) overlay.remove();
}

function renderCreateDialog() {
  // Handled by renderCreateDialogContent
}

function renderCreateDialogContent() {
  const dialog = document.getElementById('pmp-create-dialog');
  if (!dialog) return;

  const features = [
    { id: 'cli', icon: '🔧', label: 'CLI 工具' },
    { id: 'workflow', icon: '⚡', label: '工作流' },
    { id: 'aiTool', icon: '🤖', label: 'AI 工具' },
    { id: 'route', icon: '🌐', label: 'HTTP 路由' },
    { id: 'ui', icon: '🖥️', label: 'UI 面板' },
    { id: 'mcp', icon: '🔗', label: 'MCP 服务' },
    { id: 'lifecycle', icon: '🔄', label: '生命周期' },
  ];

  const errorHtml = createDialogState.error
    ? '<div class="pmp-create-error">❌ ' + escapeHtml(createDialogState.error) + '</div>'
    : '';
  const successHtml = createDialogState.success
    ? '<div class="pmp-create-success">✅ ' + escapeHtml(createDialogState.success) + '</div>'
    : '';

  const featuresHtml = features.map(function(f) {
    const selected = createDialogState.features.indexOf(f.id) !== -1;
    const selectedClass = selected ? ' selected' : '';
    return '<button class="pmp-feature-chip' + selectedClass + '" ' +
      'onclick="PMANAGER.toggleFeature(\'' + f.id + '\')">' +
      '<span class="pmp-feature-icon">' + f.icon + '</span>' +
      '<span>' + f.label + '</span>' +
      '</button>';
  }).join('');

  dialog.innerHTML =
    '<h3 class="pmp-create-title">🔌 创建新插件</h3>' +
    '<div class="pmp-create-field">' +
    '<label for="pmp-create-name">插件名称 *</label>' +
    '<input type="text" id="pmp-create-name" placeholder="my-awesome-plugin" ' +
    'value="' + escapeHtml(createDialogState.name) + '" ' +
    'oninput="PMANAGER.updateField(\'name\', this.value)" />' +
    '<small>仅支持小写字母、数字和连字符（kebab-case）</small>' +
    '</div>' +
    '<div class="pmp-create-field">' +
    '<label for="pmp-create-desc">描述</label>' +
    '<input type="text" id="pmp-create-desc" placeholder="A short description of your plugin" ' +
    'value="' + escapeHtml(createDialogState.description) + '" ' +
    'oninput="PMANAGER.updateField(\'description\', this.value)" />' +
    '</div>' +
    '<div style="display:flex;gap:12px;">' +
    '<div class="pmp-create-field" style="flex:1;">' +
    '<label for="pmp-create-author">作者</label>' +
    '<input type="text" id="pmp-create-author" placeholder="Your name" ' +
    'value="' + escapeHtml(createDialogState.author) + '" ' +
    'oninput="PMANAGER.updateField(\'author\', this.value)" />' +
    '</div>' +
    '<div class="pmp-create-field" style="flex:1;">' +
    '<label for="pmp-create-version">版本</label>' +
    '<input type="text" id="pmp-create-version" value="' + escapeHtml(createDialogState.version) + '" ' +
    'oninput="PMANAGER.updateField(\'version\', this.value)" />' +
    '</div>' +
    '</div>' +
    '<label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:6px;">选择功能（可选）</label>' +
    '<div class="pmp-features-grid">' + featuresHtml + '</div>' +
    errorHtml + successHtml +
    '<div class="pmp-create-actions">' +
    '<button class="pmp-create-btn secondary" onclick="PMANAGER.closeCreate()">取消</button>' +
    '<button class="pmp-create-btn primary" id="pmp-create-submit" ' +
    (createDialogState.creating ? 'disabled' : '') + ' ' +
    'onclick="PMANAGER.submitCreate()">' +
    (createDialogState.creating ? '⏳ 创建中...' : '🚀 创建插件') +
    '</button></div>';

  // Focus name input
  const nameInput = document.getElementById('pmp-create-name');
  if (nameInput) setTimeout(function() { nameInput.focus(); }, 100);
}

function updateField(field, value) {
  createDialogState[field] = value;
}

function toggleFeature(featureId) {
  const idx = createDialogState.features.indexOf(featureId);
  if (idx === -1) {
    createDialogState.features.push(featureId);
  } else {
    createDialogState.features.splice(idx, 1);
  }
  renderCreateDialogContent();
}

function submitCreate() {
  const name = createDialogState.name.trim();
  if (!name) {
    createDialogState.error = '请输入插件名称';
    renderCreateDialogContent();
    return;
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    createDialogState.error = '插件名称仅支持小写字母、数字和连字符';
    renderCreateDialogContent();
    return;
  }

  createDialogState.creating = true;
  createDialogState.error = '';
  createDialogState.success = '';
  renderCreateDialogContent();

  const body = {
    name: name,
    description: createDialogState.description.trim(),
    author: createDialogState.author.trim(),
    version: createDialogState.version.trim() || '0.1.0',
    features: createDialogState.features,
  };

  fetch('/api/plugins/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(data => {
      createDialogState.creating = false;
      if (data.success) {
        createDialogState.success = '插件 "' + name + '" 创建成功！' +
          (data.loadResult?.success ? ' 已自动加载。' : ' 但加载失败: ' + (data.loadResult?.error || ''));
        renderCreateDialogContent();
        loadPlugins();
        // Close after 2 seconds
        setTimeout(closeCreateDialog, 2000);
      } else {
        createDialogState.error = data.error || '创建失败';
        renderCreateDialogContent();
      }
    })
    .catch(err => {
      createDialogState.creating = false;
      createDialogState.error = '网络错误: ' + err.message;
      renderCreateDialogContent();
    });
}

// ============================================================
// Plugin Detail View
// ============================================================

function showDetail(pluginName) {
  state.detail = { name: pluginName, loading: true };
  render();

  // Fetch full manifest from installed endpoint
  fetch('/api/plugins/market/installed')
    .then(r => r.json())
    .then(data => {
      const found = (data.plugins || []).find(p =>
        p.name === pluginName || (p.manifest && p.manifest.name === pluginName)
      );
      if (found) {
        state.detail = { name: pluginName, loading: false, plugin: found, manifest: found.manifest };
      } else {
        state.detail = { name: pluginName, loading: false, error: '未找到插件数据' };
      }
      render();
    })
    .catch(err => {
      state.detail = { name: pluginName, loading: false, error: err.message };
      render();
    });
}

function closeDetail() {
  state.detail = null;
  render();
}

function renderDetailView(detail) {
  if (detail.loading) {
    return '<div class="pmp-loading" style="padding:60px 20px"><div class="pmp-spinner"></div><span>加载详情...</span></div>';
  }

  if (detail.error) {
    return '<div class="pmp-container">' +
      '<button class="pmp-detail-back" onclick="PMANAGER.closeDetail()">← 返回列表</button>' +
      '<div class="pmp-empty"><div class="pmp-empty-icon">⚠️</div><p>' + escapeHtml(detail.error) + '</p></div></div>';
  }

  const p = detail.plugin || {};
  const m = detail.manifest || {};
  const icon = getPluginIcon(m);

  // Basic info
  let html = '<div class="pmp-container">';

  // Back button
  html += '<button class="pmp-detail-back" onclick="PMANAGER.closeDetail()">← 返回列表</button>';

  // Header
  const statusClass = p.loaded ? 'loaded' : 'disabled';
  let statusText = p.loaded ? '✅ 已加载' : '❌ 未加载';
  if (!detail.manifest) statusText = '⚠️ 无 manifest';

  html += '<div class="pmp-detail-header">' +
    '<div class="pmp-detail-icon">' + icon + '</div>' +
    '<div style="flex:1;min-width:0;">' +
    '<div class="pmp-detail-title">' + escapeHtml(m.name || p.name || '?') + '</div>' +
    '<div class="pmp-detail-subtitle">' +
    'v' + escapeHtml(m.version || '—') + ' · by ' + escapeHtml(m.author || '—') +
    '</div></div>' +
    '<span class="pmp-detail-status ' + statusClass + '">' + statusText + '</span>' +
    '</div>';

  // ====== Manifest Info Section ======
  if (m && Object.keys(m).length > 0) {
    html += '<div class="pmp-detail-section">' +
      '<div class="pmp-detail-section-title">📋 清单信息</div>';

    const infoFields = [
      { label: '名称', value: m.name },
      { label: '版本', value: m.version },
      { label: '描述', value: m.description },
      { label: '作者', value: m.author },
      { label: '许可', value: m.license },
    ];
    for (let i = 0; i < infoFields.length; i++) {
      const f = infoFields[i];
      html += '<div class="pmp-detail-row">' +
        '<span class="pmp-detail-label">' + f.label + '</span>' +
        '<span class="pmp-detail-value' + (f.value ? '' : ' missing') + '">' +
        (f.value ? escapeHtml(String(f.value)) : '未设置') + '</span></div>';
    }
    html += '</div>';
  }

  // ====== Capabilities Section ======
  const capTypes = [
    { key: 'mcpServers', icon: '🔗', label: 'MCP 服务器' },
    { key: 'aiTools', icon: '🤖', label: 'AI 工具' },
    { key: 'clis', icon: '🔧', label: 'CLI 工具' },
    { key: 'workflows', icon: '⚡', label: '工作流' },
    { key: 'routes', icon: '🌐', label: 'HTTP 路由' },
    { key: 'presets', icon: '🎨', label: '预设' },
  ];

  for (let ci = 0; ci < capTypes.length; ci++) {
    const ct = capTypes[ci];
    const items = m[ct.key];
    if (!items || !Array.isArray(items) || items.length === 0) continue;

    html += '<div class="pmp-detail-section">' +
      '<div class="pmp-detail-section-title">' + ct.icon + ' ' + ct.label +
      ' <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-tertiary);">(' + items.length + ')</span>' +
      '</div>';

    for (let ii = 0; ii < items.length; ii++) {
      var item = items[ii];
      html += '<div class="pmp-detail-cap-item">';

      if (ct.key === 'mcpServers') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml(item.name || 'unnamed') + '</div>';
        html += '<table class="pmp-detail-cap-table">';
        html += '<tr><td>命令</td><td>' + escapeHtml(item.command || '') + ' ' + escapeHtml((item.args || []).join(' ')) + '</td></tr>';
        if (item.env && Object.keys(item.env).length > 0) {
          const envStr = Object.keys(item.env).map(function(k) { return k + '=' + item.env[k]; }).join(' ');
          html += '<tr><td>环境变量</td><td>' + escapeHtml(envStr) + '</td></tr>';
        }
        html += '</table>';
      } else if (ct.key === 'aiTools') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml(item.name || 'unnamed') + '</div>';
        if (item.description) {
          html += '<div class="pmp-detail-cap-desc">' + escapeHtml(item.description) + '</div>';
        }
        if (item.parameters) {
          const paramKeys = item.parameters.properties ? Object.keys(item.parameters.properties) : [];
          if (paramKeys.length > 0) {
            html += '<table class="pmp-detail-cap-table">';
            html += '<tr><td>参数</td><td>' + escapeHtml(paramKeys.join(', ')) + '</td></tr>';
            html += '</table>';
          }
        }
      } else if (ct.key === 'clis') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml(item.name || item.id || 'unnamed') + '</div>';
        html += '<table class="pmp-detail-cap-table">';
        html += '<tr><td>路径</td><td>' + escapeHtml(item.path || '') + '</td></tr>';
        if (item.type) html += '<tr><td>类型</td><td>' + escapeHtml(item.type) + '</td></tr>';
        html += '</table>';
      } else if (ct.key === 'workflows') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml(item.name || item.id || 'unnamed') + '</div>';
        if (item.description) html += '<div class="pmp-detail-cap-desc">' + escapeHtml(item.description) + '</div>';
      } else if (ct.key === 'routes') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml((item.method || 'GET').toUpperCase()) + ' ' + escapeHtml(item.path || '/') + '</div>';
      } else if (ct.key === 'presets') {
        html += '<div class="pmp-detail-cap-name">' + escapeHtml(item.name || 'unnamed') + '</div>';
      }

      html += '</div>';
    }
    html += '</div>';
  }

  // ====== Lifecycle Section ======
  if (m.lifecycle) {
    html += '<div class="pmp-detail-section">' +
      '<div class="pmp-detail-section-title">🔄 生命周期</div>';
    if (m.lifecycle.onLoad) {
      html += '<div class="pmp-detail-row"><span class="pmp-detail-label">onLoad</span>' +
        '<span class="pmp-detail-value">' + escapeHtml(m.lifecycle.onLoad) + '</span></div>';
    }
    if (m.lifecycle.onUnload) {
      html += '<div class="pmp-detail-row"><span class="pmp-detail-label">onUnload</span>' +
        '<span class="pmp-detail-value">' + escapeHtml(m.lifecycle.onUnload) + '</span></div>';
    }
    html += '</div>';
  }

  // ====== Raw Manifest JSON (collapsible) ======
  if (m && Object.keys(m).length > 0) {
    html += '<div class="pmp-detail-section">' +
      '<div class="pmp-detail-section-title">📄 原始 JSON</div>' +
      '<div class="pmp-detail-code">' + escapeHtml(JSON.stringify(m, null, 2)) + '</div>' +
      '</div>';
  }

  // ====== Actions ======
  html += '<div style="display:flex;gap:6px;padding:4px 0 8px;">' +
    '<button class="pmp-action-btn" onclick="PMANAGER.reload(\'' + escapeHtml(p.name || detail.name) + '\')">⟳ 重载</button>' +
    '<button class="pmp-action-btn danger" onclick="PMANAGER.uninstall(\'' + escapeHtml(p.name || detail.name) + '\')">🗑 卸载</button>' +
    '</div>';

  html += '</div>';
  return html;
}

// ============================================================
// Utilities
// ============================================================

function getPluginIcon(p) {
  if (p.icon) return p.icon;
  return '🔌';
}

// ============================================================
// Public API
// ============================================================

const PMANAGER = {
  refresh: loadPlugins,
  load: loadPlugins,

  showDetail: function(name) {
    showDetail(name);
  },

  closeDetail: function() {
    closeDetail();
  },

  toggle: function(name, enabled) {
    togglePlugin(name, enabled);
  },

  uninstall: function(name) {
    uninstallPlugin(name);
  },

  reload: function(name) {
    fetch('/api/plugins/' + encodeURIComponent(name) + '/reload', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          Q.showToast?.('✅ 插件 "' + name + '" 已重载', 'success');
          loadPlugins();
        } else {
          Q.showToast?.('重载失败: ' + (data.error || '未知错误'), 'error');
        }
      })
      .catch(err => {
        Q.showToast?.('重载失败: ' + err.message, 'error');
      });
  },

  openMarket: function() {
    window.open('/plugin-plaza.html', '_blank');
  },

  openCreate: function() {
    openCreateDialog();
  },

  closeCreate: function() {
    closeCreateDialog();
  },

  updateField: function(field, value) {
    updateField(field, value);
  },

  toggleFeature: function(id) {
    toggleFeature(id);
  },

  submitCreate: function() {
    submitCreate();
  },
};

// Expose globally for onclick handlers
window.PMANAGER = PMANAGER;

// ============================================================
// Register as Right Panel Tab
// ============================================================

(function register() {
  const UIR = window.QCLI?.UIRegistry;
  if (!UIR) {
    // Retry on next tick if UIRegistry not ready yet
    setTimeout(register, 100);
    return;
  }

  const registered = UIR.registerTab('plugin-manager', {
    category: "plugin",
    icon: '🔌',
    label: '插件',
    order: 5,
    render: function(container) {
      container.innerHTML = '<div id="rp-plugin-manager" style="height:100%;"></div>';
      // Load plugins after DOM is ready
      setTimeout(loadPlugins, 50);
    },
  });

  if (registered) {
    console.log('[PluginManager] Registered as right panel tab');
  }
})();

export { PMANAGER };
