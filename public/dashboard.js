// @ts-check
// ============================================================
// Dashboard Panel — System Status, CLI Stats, Runtime Overview
// Core orchestrator — imports sub-modules from dash-*.js
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage } from './lib/storage.js';
import { setText, escapeHtml, formatDuration } from './dash-utils.js';
import { McpMonitor, updateMcpMonitor, startMcpStatusPoller } from './dash-mcp.js';
import { _Monitor, setupThroughputTracking, _updateSysResourcesThrottled, _updateSysOverviewThrottled, forceSystemRefresh } from './dash-monitor.js';
import { _AlertManager } from './dash-alert.js';
import { updateProjectAnalysis, loadProjectAnalysis, resetProjectData } from './dash-project.js';
import { toggleProcExpanded, updateCLIProcessMonitor } from './dash-process.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

export const Dashboard = {
  /** @type {number|null} page load timestamp */
  _startTime: Date.now(),
  /** @type {number|null} auto-refresh interval (UI 慢刷新) */
  _refreshTimer: null,
  /** @type {number} refresh interval in ms */
  _REFRESH_MS: 10000,
  /** @type {number|null} background poll interval (实时资源/磁盘/网络，不受面板可见性影响) */
  _pollTimer: null,
  /** @type {number} background poll interval in ms */
  _POLL_MS: 3000,
  /** @type {boolean} guard against double init */
  _initialized: false,
  /** @type {Object.<string,number>} cached previous values for animation detection */
  _prevValues: { clis: 0, agent: 0, directory: 0, tool: 0, tabs: 0, favorites: 0 },
  /** @type {number|null} clock interval */
  _clockTimer: null,
};

// Expose McpMonitor.push for app.js to call from mcp_metric handler
Dashboard.mcpPush = (metric) => McpMonitor.push(metric);

// Expose _Monitor for system-resources.js and other modules via Q namespace
Q._dashboardMonitor = _Monitor;

// ============================================================
// Initialization
// ============================================================
function init() {
  if (Dashboard._initialized) return;
  Dashboard._initialized = true;

  // Start MCP status polling (updates the header badge in the MCP section)
  startMcpStatusPoller();

  // Wire up tab switch listener
  const tabs = document.getElementById('right-panel-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.right-tab');
      if (tab && tab.dataset.panel === 'dashboard') {
        refresh();
      }
    });
  }

  // Watch for right-panel tab switches
  if (Q.RightPanel && Q.RightPanel.on) {
    Q.RightPanel.on('tab:switch', function(tabId) {
      if (tabId === 'dashboard') {
        forceSystemRefresh();
        refresh();
      }
    });
  }

  // Initial render
  render();

  // Start auto-refresh
  startAutoRefresh();

  // 常驻后台轮询：系统资源 / 磁盘 / 网络。即使右侧仪表盘面板未激活、或某条
  // 聊天流长时间占用主线程，这些轻量 /health、/api/system/overview 轮询仍按
  // 固定节奏刷新，避免磁盘/网络/MCP 等指标「看起来不实时」。
  startBackgroundPoll();

  // Start throughput tracking
  setupThroughputTracking();

  // Start latency pings
  _Monitor.startPing();

  // Wire up WS message handling
  const _origOnMsg = Q.onWSMessage;
  Q.onWSMessage = function(msg) {
    _Monitor.onWSMessage(msg);
    if (_origOnMsg) _origOnMsg(msg);
  };

  // Subscribe to tab switch events for activity timeline
  if (Q.RightPanel && Q.RightPanel.on) {
    Q.RightPanel.on('tab:switch', function(tabId) {
      const builtinNames = { dashboard: '仪表盘', media: '多媒体' };
      const displayName = builtinNames[tabId] || tabId;
      recordActivity('tab', '切换到 ' + displayName);
    });
  }

  // Register dashboard tab in UIRegistry (restores tab button in horizontal bar)
  _registerTab();

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  console.log('[Dashboard] Initialized');
}

/** Register dashboard as a proper tab in UIRegistry for the horizontal tab bar */
function _registerTab() {
  if (typeof Q.UIRegistry?.registerTab === 'function') {
    Q.UIRegistry.registerTab('dashboard', {
      icon: '📊',
      label: '仪表盘',
      category: 'monitor',
      order: 0,
      render: (container) => {
        // Dashboard content is already in the built-in HTML panel,
        // ensure it stays visible (right-panel will activate this container)
        if (container) {
          container.style.display = '';
        }
      },
    });
  }
}

function cleanup() {
  stopAutoRefresh();
  stopBackgroundPoll();
  _Monitor.stopPing();
  if (Dashboard._clockTimer) {
    clearInterval(Dashboard._clockTimer);
    Dashboard._clockTimer = null;
  }
}

// ============================================================
// Auto-Refresh
// ============================================================
function startAutoRefresh() {
  if (Dashboard._refreshTimer) return;
  Dashboard._refreshTimer = setInterval(() => {
    const rpContent = document.getElementById('right-panel-content');
    if (!rpContent) return;
    const dashPanel = document.getElementById('rp-dashboard');
    if (!dashPanel || !dashPanel.classList.contains('active')) return;
    const rp = document.getElementById('right-panel');
    if (rp && rp.classList.contains('collapsed')) return;
    refresh();
  }, Dashboard._REFRESH_MS);
}

function stopAutoRefresh() {
  if (Dashboard._refreshTimer) {
    clearInterval(Dashboard._refreshTimer);
    Dashboard._refreshTimer = null;
  }
}

// ============================================================
// Background Poll — 实时系统资源 / 磁盘 / 网络
// 与 UI 慢刷新解耦：常驻、不受面板可见性影响，保证指标近实时。
// ============================================================
function startBackgroundPoll() {
  if (Dashboard._pollTimer) return;
  Dashboard._pollTimer = setInterval(() => {
    // 这些内部函数自带节流（系统资源 5s、overview 10s），多次调用不会打爆后端
    try {
      _updateSysResourcesThrottled();
      _updateSysOverviewThrottled();
    } catch (e) { /* ignore */ }
  }, Dashboard._POLL_MS);
}

function stopBackgroundPoll() {
  if (Dashboard._pollTimer) {
    clearInterval(Dashboard._pollTimer);
    Dashboard._pollTimer = null;
  }
}

// ============================================================
// Refresh — update values without full re-render
// ============================================================
function refresh() {
  updateStats();
  updateConnectionStatus();
  updateSessionList();
  updateProjectAnalysis();
  updateMcpMonitor();
  updateCLIProcessMonitor();
  updateLatency();
  updateActivityTimeline();
  _updateSysResourcesThrottled();
  _updateSysOverviewThrottled();
  drawTrendCharts();
  if (_Monitor.sys.rss > 0 || _Monitor.latency > 0) {
    _AlertManager.checkThresholds(
      _Monitor.sys.rss,
      _Monitor.sys.heap,
      _Monitor.latency
    );
  }
}

// ============================================================
// Full Render
// ============================================================
function render() {
  const panel = document.getElementById('rp-dashboard');
  if (!panel) return;

  // Load project data lazily
  loadProjectAnalysis();

  // Build dashboard HTML (template kept here for centralized DOM ID management)
  panel.innerHTML = `
    <div class="dash-content" id="dash-content">
      <!-- Active Sessions -->
      <div class="dash-section">
        <div class="dash-section-title">活动会话</div>
        <div class="dash-card" id="dash-session-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📋</span>
            <span class="dash-card-title">终端标签</span>
            <span class="dash-card-badge" id="dash-tab-count">0</span>
          </div>
          <div class="dash-card-body">
            <div id="dash-tab-list" class="dash-tab-list">
              <div class="dash-empty">暂无活动会话</div>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Monitor -->
      <div class="dash-section" id="dash-section-mcp" data-collapse="1" data-collapse-icon="⚡">
        <div class="dash-section-title">
          <span class="mcp-section-title-row">
            <span>MCP Monitor</span>
            <span class="mcp-pulse-dot" id="mcp-pulse-dot"></span>
            <span class="mcp-rate-badge" id="mcp-rate-badge">0 eps</span>
            <span class="mcp-status-badge" id="mcp-status-badge">检测中…</span>
          </span>
        </div>
        <div class="dash-card" id="dash-mcp-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">⚡</span>
            <span class="dash-card-title">MCP 工具调用</span>
            <span class="dash-card-badge" id="dash-mcp-count">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group">
              <span class="dash-chip">命中率 <span class="dash-chip-value" id="dash-mcp-hitrate">0%</span></span>
              <span class="dash-chip">已节省 <span class="dash-chip-value" id="dash-mcp-saved">0 B</span></span>
              <span class="dash-chip">命中 <span class="dash-chip-value" id="dash-mcp-hits">0</span></span>
              <span class="dash-chip">未命中 <span class="dash-chip-value" id="dash-mcp-misses">0</span></span>
              <button class="dash-chip-btn" id="dash-mcp-reset" title="重置">重置</button>
            </div>
            <div class="mcp-sparkline-wrap">
              <canvas id="mcp-sparkline" class="mcp-sparkline" width="240" height="36"></canvas>
            </div>
            <div class="mcp-tool-bars" id="mcp-tool-bars">
              <div class="dash-empty" id="mcp-tools-empty">等待工具调用...</div>
            </div>
            <div class="dash-mcp-log" id="dash-mcp-log">
              <div class="dash-empty" id="dash-mcp-empty">等待 MCP 事件...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Connection Status -->
      <div class="dash-section">
        <div class="dash-section-title">连接状态</div>
        <div class="dash-card" id="dash-connection-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🔌</span>
            <span class="dash-card-title">WebSocket</span>
            <span class="dash-card-badge" id="dash-conn-badge">检查中</span>
          </div>
          <div class="dash-card-body" id="dash-conn-body">
            <div class="dash-chip-group">
              <span class="dash-chip" id="dash-conn-chip">
                <span class="dash-status-dot offline" id="dash-conn-dot"></span>
                <span id="dash-conn-text">未连接</span>
              </span>
              <span class="dash-chip">🔄 <span id="dash-reconn-count">0</span></span>
              <span class="dash-chip">⏱ <span id="dash-uptime">0s</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- CLI Statistics -->
      <div class="dash-section">
        <div class="dash-section-title">CLI 统计</div>
        <div class="dash-card" id="dash-cli-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🚀</span>
            <span class="dash-card-title">已注册 CLI</span>
            <span class="dash-card-badge" id="dash-total-clis">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group" id="dash-cli-chip-group">
              <span class="dash-chip">🤖 <span class="dash-chip-value" id="dash-count-agent">0</span><span class="dash-chip-label">Agent</span></span>
              <span class="dash-chip">📂 <span class="dash-chip-value" id="dash-count-dir">0</span><span class="dash-chip-label">Env</span></span>
              <span class="dash-chip">🔧 <span class="dash-chip-value" id="dash-count-tool">0</span><span class="dash-chip-label">Tool</span></span>
              <span class="dash-chip">⭐ <span class="dash-chip-value" id="dash-count-fav">0</span><span class="dash-chip-label">收藏</span></span>
              <span class="dash-chip">总计 <span class="dash-chip-value" id="dash-total-clis">0</span></span>
            </div>
            <div class="dash-progress" id="dash-cli-progress">
              <div class="dash-progress-bar" id="dash-cli-progress-bar" style="width:0%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Project Analysis -->
      <div class="dash-section" id="dash-section-project" data-collapse="1" data-collapse-icon="📁">
        <div class="dash-section-title">项目分析</div>
        <div class="dash-card" id="dash-project-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📁</span>
            <span class="dash-card-title">工作区文件</span>
            <span class="dash-card-badge" id="dash-project-badge">扫描中</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-stat"><span class="dash-stat-icon">📜</span><span class="dash-stat-label">主要语言</span><span class="dash-stat-value" id="dash-project-lang">—</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">📫</span><span class="dash-stat-label">文件总数</span><span class="dash-stat-value" id="dash-project-files">—</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">📹</span><span class="dash-stat-label">源代码行数</span><span class="dash-stat-value" id="dash-project-loc">—</span></div>
            <div class="dash-project-type-grid" id="dash-project-types"></div>
            <div class="dash-project-keyfiles" id="dash-project-keyfiles"></div>
            <button class="dash-project-refresh-btn" id="dash-project-refresh" title="重新扫描项目">🔄 重新扫描</button>
          </div>
        </div>
      </div>

      <!-- CLI Process Monitor -->
      <div class="dash-section" id="dash-section-process" data-collapse="1" data-collapse-icon="🖥️">
        <div class="dash-section-title">CLI 进程监控</div>
        <div class="dash-card" id="dash-process-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🖥️</span>
            <span class="dash-card-title">运行中的进程</span>
            <span class="dash-card-badge" id="dash-process-count">0</span>
            <button class="dash-proc-toggle" id="dash-proc-toggle" title="展开/收起趋势图">📊 展开趋势</button>
          </div>
          <div class="dash-card-body">
            <div class="dash-process-list" id="dash-process-list">
              <div class="dash-empty">暂无运行中的 CLI 进程</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity Timeline -->
      <div class="dash-section" id="dash-section-timeline" data-collapse="1" data-collapse-icon="📜">
        <div class="dash-section-title">活动时间线</div>
        <div class="dash-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📜</span>
            <span class="dash-card-title">最近操作</span>
            <span class="dash-card-badge" id="dash-timeline-count">0</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-timeline" id="dash-timeline">
              <div class="dash-empty">暂无活动记录</div>
            </div>
          </div>
        </div>
      </div>

      <!-- System Resources (摘要 + 跳转 sys-resources tab；趋势/磁盘图表移出，避免与 sys-resources 重复) -->
      <div class="dash-section">
        <div class="dash-section-title">系统资源 <a class="dash-detail-link" id="dash-sys-detail-btn" title="查看完整系统资源">查看详情 ↗</a></div>
        <div class="dash-card" id="dash-sys-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">🌡️</span>
            <span class="dash-card-title">运行环境</span>
            <span class="dash-card-badge" id="dash-sys-uptime">0s</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-sys-gauge">
              <div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">内存 (RSS)</span><span class="dash-sys-gauge-value" id="dash-sys-mem">—</span></div>
              <div class="dash-progress"><div class="dash-progress-bar gauge-bar" id="dash-sys-mem-bar" style="width:0%"></div></div>
            </div>
            <div class="dash-sys-gauge">
              <div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">堆内存</span><span class="dash-sys-gauge-value" id="dash-sys-heap">—</span></div>
              <div class="dash-progress"><div class="dash-progress-bar gauge-bar-heap" id="dash-sys-heap-bar" style="width:0%"></div></div>
            </div>
            <div class="dash-sys-meta">
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">平台</span><span class="dash-sys-meta-value" id="dash-sys-platform">—</span></div>
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">Node</span><span class="dash-sys-meta-value" id="dash-sys-node">—</span></div>
              <div class="dash-sys-meta-item"><span class="dash-sys-meta-label">WS 会话</span><span class="dash-sys-meta-value" id="dash-sys-sessions">0</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Network Info (摘要 + 跳转 network-monitor tab；IO 表/趋势移出，避免重复) -->
      <div class="dash-section">
        <div class="dash-section-title">网络状态 <a class="dash-detail-link" id="dash-net-detail-btn" title="查看完整网络监控">查看详情 ↗</a></div>
        <div class="dash-card" id="dash-network-card">
          <div class="dash-card-header">
            <span class="dash-card-icon">📡</span>
            <span class="dash-card-title">延迟 & 吞吐</span>
            <span class="dash-card-badge" id="dash-latency-badge">等待中</span>
          </div>
          <div class="dash-card-body">
            <div class="dash-chip-group">
              <span class="dash-chip">⏱ 延迟 <span class="dash-chip-value" id="dash-latency-val">—</span></span>
              <span class="dash-chip">📤 <span class="dash-chip-value" id="dash-bytes-sent">0 B</span></span>
              <span class="dash-chip">📥 <span class="dash-chip-value" id="dash-bytes-recv">0 B</span></span>
              <span class="dash-chip">⚡ <span class="dash-chip-value" id="dash-throughput">0 B/s</span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Minimal System Info -->
      <div class="dash-section" id="dash-section-uiinfo" data-collapse="1" data-collapse-icon="🛠️">
        <div class="dash-section-title">界面信息</div>
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="dash-stat"><span class="dash-stat-icon">🛠️</span><span class="dash-stat-label">主题</span><span class="dash-stat-value" id="dash-theme">深色</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">⏱</span><span class="dash-stat-label">当前时间</span><span class="dash-stat-value" id="dash-clock" style="font-size:10px;">—</span></div>
            <div class="dash-stat"><span class="dash-stat-icon">📫</span><span class="dash-stat-label">页面大小</span><span class="dash-stat-value" id="dash-memory">—</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Initial update
  refresh();
  updateMcpMonitor();

  // Start clock
  startClock();

  // Wire up process sparkline toggle
  const toggleProc = document.getElementById('dash-proc-toggle');
  if (toggleProc) {
    toggleProc.addEventListener('click', function() {
      toggleProcExpanded();
      const list = document.getElementById('dash-process-list');
      if (list) list.dataset.serialized = '';
      updateCLIProcessMonitor();
    });
  }

  // Wire up project refresh button
  const refreshBtn = document.getElementById('dash-project-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      resetProjectData();
      updateProjectAnalysis();
    });
  }

  // ── A1: 非核心 section 默认折叠 + 详情跳转 ──
  setupDashboardCollapsibles(panel);
  bindDetailButtons();

  console.log('[Dashboard] Rendered');
}

// ============================================================
// A1 — Collapsible sections & detail navigation (dashboard only)
// ============================================================
function setupDashboardCollapsibles(panel) {
  const targets = [
    'dash-section-mcp', 'dash-section-project',
    'dash-section-process', 'dash-section-timeline', 'dash-section-uiinfo'
  ];
  targets.forEach((id) => {
    const sec = document.getElementById(id);
    if (!sec) return;
    const icon = sec.dataset.collapseIcon || '📋';
    wrapSectionCollapsible(sec, icon, false);
  });
  panel.querySelectorAll('.rp-collapsible-header').forEach((h) => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
  });
}

/** 将 .dash-section 转换为默认折叠的 .rp-collapsible（移动真实子节点，保留已有事件绑定） */
function wrapSectionCollapsible(section, icon, defaultOpen) {
  const titleEl = section.querySelector(':scope > .dash-section-title');
  const titleHTML = titleEl ? titleEl.innerHTML : '';
  const frag = document.createDocumentFragment();
  Array.from(section.children).forEach((child) => {
    if (child === titleEl) return;
    frag.appendChild(child);
  });
  const wrap = document.createElement('div');
  wrap.className = 'rp-collapsible' + (defaultOpen ? ' open' : '');
  wrap.innerHTML =
    '<div class="rp-collapsible-header">' +
      '<span class="rpc-icon">' + icon + '</span>' +
      '<span class="rpc-collapsible-title">' + titleHTML + '</span>' +
      '<span class="rpc-arrow">▸</span>' +
    '</div>' +
    '<div class="rp-collapsible-body"><div class="rp-collapsible-body-inner"></div></div>';
  wrap.querySelector('.rp-collapsible-body-inner').appendChild(frag);
  section.replaceWith(wrap);
}

/** 系统资源/网络状态摘要卡的「查看详情 ↗」跳转到对应完整 tab */
function bindDetailButtons() {
  const sysBtn = document.getElementById('dash-sys-detail-btn');
  if (sysBtn) sysBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (Q.RightPanel && Q.RightPanel.switchTab) Q.RightPanel.switchTab('sys-resources');
  });
  const netBtn = document.getElementById('dash-net-detail-btn');
  if (netBtn) netBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (Q.RightPanel && Q.RightPanel.switchTab) Q.RightPanel.switchTab('network-monitor');
  });
}

// ============================================================
// Update Methods (called on each refresh)
// ============================================================

/** Update CLI statistics counters */
function updateStats() {
  const clis = Q.state?.clis || [];
  const total = clis.length;

  let agent = 0, directory = 0, tool = 0;
  for (const cli of clis) {
    const cat = cli.category || 'tool';
    if (cat === 'agent') agent++;
    else if (cat === 'directory') directory++;
    else tool++;
  }

  let favorites = 0;
  try {
    const favs = safeStorage.getJSON('qcli-favorites', []);
    favorites = favs.length;
  } catch (e) { /* ignore */ }

  animateIfChanged('dash-total-clis', total);
  animateIfChanged('dash-count-agent', agent);
  animateIfChanged('dash-count-dir', directory);
  animateIfChanged('dash-count-tool', tool);
  animateIfChanged('dash-count-fav', favorites);

  setText('dash-total-clis', total);
  setText('dash-count-agent', agent);
  setText('dash-count-dir', directory);
  setText('dash-count-tool', tool);
  setText('dash-count-fav', favorites);

  const maxScale = Math.max(total, 10);
  const pct = Math.min(100, (total / maxScale) * 100);
  const bar = document.getElementById('dash-cli-progress-bar');
  if (bar) bar.style.width = pct + '%';

  Dashboard._prevValues.clis = total;
  Dashboard._prevValues.agent = agent;
  Dashboard._prevValues.directory = directory;
  Dashboard._prevValues.tool = tool;
  Dashboard._prevValues.favorites = favorites;
}

/** Update connection status display */
function updateConnectionStatus() {
  const state = Q.state || {};
  const connected = !!state.connected;
  const launched = !!state.launched;

  const dot = document.getElementById('dash-conn-dot');
  if (dot) dot.className = 'dash-status-dot ' + (connected ? 'online' : 'offline');

  const badge = document.getElementById('dash-conn-badge');
  if (badge) {
    badge.textContent = connected ? (launched ? '运行中' : '已连接') : '断开';
    badge.style.color = connected ? 'var(--success)' : 'var(--text-tertiary)';
    badge.style.background = connected
      ? 'var(--success-bg, rgba(34,197,94,0.1))'
      : 'var(--bg-hover)';
  }

  setText('dash-conn-text', connected ? (launched ? 'CLI 运行中' : 'WebSocket 已连接') : '未连接');
  setText('dash-reconn-count', state.reconnectAttempts || 0);

  const elapsed = Math.floor((Date.now() - Dashboard._startTime) / 1000);
  setText('dash-uptime', formatDuration(elapsed));
}

/** Update active session / tab list */
function updateSessionList() {
  const tabs = Q.Tabs?.tabs || [];
  const activeId = Q.Tabs?.activeTabId;

  setText('dash-tab-count', tabs.length);

  const list = document.getElementById('dash-tab-list');
  if (!list) return;

  if (tabs.length === 0) {
    list.innerHTML = '<div class="dash-empty">暂无活动会话</div>';
    return;
  }

  const serialized = tabs.map(t => t.tabId + '|' + (t.tabId === activeId ? '1' : '0')).join(',');
  if (list.dataset.serialized === serialized) return;
  list.dataset.serialized = serialized;

  const html = tabs.map(tab => {
    const isActive = tab.tabId === activeId;
    return `<div class="dash-tab-item" data-tab-id="${tab.tabId}">
      <span class="dash-tab-dot" style="background:${isActive ? 'var(--success)' : 'var(--text-tertiary)'}"></span>
      <span class="dash-tab-name">${escapeHtml(tab.name || tab.cliId || 'Terminal')}</span>
      <span class="dash-tab-status">${isActive ? '当前' : ''}</span>
    </div>`;
  }).join('');

  if (list.innerHTML !== html) list.innerHTML = html;
}

// Handle tab item clicks via event delegation
document.addEventListener('click', (e) => {
  const item = e.target.closest('.dash-tab-item');
  if (!item) return;
  const tabId = item.dataset.tabId;
  if (tabId && Q.Tabs?.switch) {
    Q.Tabs.switch(tabId);
    const welcome = document.getElementById('welcome-overlay');
    if (welcome) welcome.classList.add('hidden');
  }
});

// ============================================================
// History Trend Charts — Mini line charts for mem & latency
// ============================================================

/** Draw a mini trend line chart on a canvas */
function drawTrendChart(canvasId, data, lineColor, emptyLabel, unit) {
  const canvas = document.getElementById(canvasId);
  if (canvas && Q.ChartCore && Q.ChartCore.drawMiniTrend) {
    Q.ChartCore.drawMiniTrend(canvas, data, lineColor, emptyLabel, unit);
  }
}

/** Draw all trend charts — resize canvases first */
function drawTrendCharts() {
  const cssVars = getComputedStyle(document.documentElement);
  const accent = cssVars.getPropertyValue('--accent').trim() || '#6366f1';
  const success = cssVars.getPropertyValue('--success').trim() || '#22c55e';
  const warning = cssVars.getPropertyValue('--warning').trim() || '#eab308';

  // 趋势图已从仪表盘摘要卡移除（完整图表见 sys-resources / network-monitor tab），此处不再绘制。
  const trendIds = [];
  for (let i = 0; i < trendIds.length; i++) {
    const c = document.getElementById(trendIds[i]);
    if (c && c.clientWidth > 0 && c.clientWidth !== c.width) {
      c.width = c.clientWidth;
    }
  }

  drawTrendChart('dash-trend-rss', _Monitor._history.rss, success, '等待内存数据...', 'MB');
  drawTrendChart('dash-trend-heap', _Monitor._history.heap, accent, '等待堆内存数据...', 'MB');
  drawTrendChart('dash-trend-latency', _Monitor._history.latency, warning || '#eab308', '等待延迟数据...', 'ms');
  drawTrendChart('dash-trend-disk', _Monitor._history.disk, '#f43f5e', '等待磁盘数据...', '%');
  drawTrendChart('dash-trend-rxrate', _Monitor._history.rxRate, '#06b6d4', '等待网络数据...', 'B/s');
}

// Wire MCP reset button
document.addEventListener('click', (e) => {
  if (e.target.id === 'dash-mcp-reset') {
    McpMonitor.reset();
    updateMcpMonitor();
  }
});

// ============================================================
// Clock
// ============================================================
function startClock() {
  updateClock();
  Dashboard._clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  setText('dash-clock', timeStr);

  setText('dash-theme', (Q.state?.theme || 'dark') === 'dark' ? '深色' : '亮色');

  const memEl = document.getElementById('dash-memory');
  if (memEl && performance?.memory) {
    const mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
    memEl.textContent = mb + ' MB';
  } else if (memEl) {
    memEl.textContent = '—';
  }
}

// ============================================================
// Helpers
// ============================================================

/** Add count-up animation class if value changed */
function animateIfChanged(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  const KEY_MAP = {
    'dash-total-clis': 'clis',
    'dash-count-agent': 'agent',
    'dash-count-dir': 'directory',
    'dash-count-tool': 'tool',
    'dash-count-fav': 'favorites',
  };
  const prevKey = KEY_MAP[id];
  if (!prevKey) return;
  const prev = Dashboard._prevValues[prevKey];
  if (prev !== undefined && prev !== newVal) {
    el.classList.remove('dash-countup');
    void el.offsetWidth;
    el.classList.add('dash-countup');
    setTimeout(() => el.classList.remove('dash-countup'), 350);
  }
}

// ============================================================
// Latency, Throughput & Network
// ============================================================

/** Update latency and throughput display */
function updateLatency() {
  const lat = _Monitor.latency;

  setText('dash-latency-val', lat === 0 ? '—' : lat + ' ms');
  setText('dash-bytes-sent', _formatBytes(_Monitor.bytesSent));
  setText('dash-bytes-recv', _formatBytes(_Monitor.bytesReceived));

  const now = Date.now();
  const elapsed = Math.max(1, now - (Dashboard._startTime));
  const bps = (_Monitor.bytesSent + _Monitor.bytesReceived) / (elapsed / 1000);
  setText('dash-throughput', _formatBytes(bps) + '/s');

  const badge = document.getElementById('dash-latency-badge');
  if (badge) {
    if (lat === 0) {
      badge.textContent = '等待中';
      badge.style.background = 'var(--bg-hover)';
    } else if (lat < 100) {
      badge.textContent = lat + ' ms ✓';
      badge.style.color = 'var(--success)';
      badge.style.background = 'rgba(34,197,94,0.1)';
    } else if (lat < 500) {
      badge.textContent = lat + ' ms';
      badge.style.color = 'var(--warning, #eab308)';
      badge.style.background = 'rgba(234,179,8,0.1)';
    } else {
      badge.textContent = lat + ' ms ⚠';
      badge.style.color = 'var(--danger)';
      badge.style.background = 'rgba(239,68,68,0.1)';
    }
  }
}

/** Format bytes (local helper, not exported) */
function _formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return (i === 0 ? bytes : val.toFixed(1)) + ' ' + units[i];
}

// ============================================================
// Activity Timeline
// ============================================================

/** Record an activity event */
function recordActivity(type, detail) {
  _Monitor.addEvent(type, detail);
  if (document.getElementById('rp-dashboard')?.classList.contains('active')) {
    updateActivityTimeline();
  }
}

/** Update activity timeline UI */
function updateActivityTimeline() {
  const entries = _Monitor.timeline;
  setText('dash-timeline-count', entries.length);

  const el = document.getElementById('dash-timeline');
  if (!el) return;

  if (entries.length === 0) {
    el.innerHTML = '<div class="dash-empty">暂无活动记录</div>';
    return;
  }

  const serial = entries.length + '|' + (entries[entries.length - 1]?.type || '');
  if (el.dataset.serial === serial) return;
  el.dataset.serial = serial;

  const TYPE_ICONS = {
    system: '⚙️',
    tab: '📋',
    cli: '🚀',
    connection: '🔌',
    error: '❌',
  };

  el.innerHTML = entries.slice(-20).reverse().map(e => {
    const icon = TYPE_ICONS[e.type] || '📌';
    const time = new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="dash-timeline-item">
      <span class="dash-timeline-icon">${icon}</span>
      <span class="dash-timeline-time">${time}</span>
      <span class="dash-timeline-text">${escapeHtml(e.detail || '')}</span>
    </div>`;
  }).join('');
}

// ============================================================
// Exports
// ============================================================
Dashboard.init = init;
Dashboard.refresh = refresh;
Dashboard.render = render;

// ============================================================
// Auto-init — register dashboard tab in UIRegistry
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
