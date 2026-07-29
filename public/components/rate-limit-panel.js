/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <rate-limit-panel> — 限流状态实时监控面板
//
// 注册到 UIRegistry，在右侧面板显示每个限流器的：
//   - 请求总量 / 429 拦截次数
//   - 当前活跃 IP 数
//   - 最高频 IP 及其请求数
//   - 限流器配置（窗口、阈值）
// - 每 3 秒自动刷新
// ============================================================
// @ts-check
'use strict';

/** @returns {QCLI} */
function Q() {
  return /** @type {import('../types').QCLI} */ (window.QCLI || {});
}

const POLL_INTERVAL = 3000; // 3s auto-refresh

let _el = null;
let _timer = null;
let _prevStats = null; // for delta calculation
let _unsubTabSwitch = null; // cleanup subscription

/**
 * 获取限流统计数据的快照（含变化量）。
 */
async function fetchStats() {
  try {
    const resp = await fetch('/api/rate-limit-stats');
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * 格式化时间窗口为可读字符串。
 */
function formatWindow(ms) {
  if (ms >= 60000) return `${ms / 60000} min`;
  if (ms >= 1000) return `${ms / 1000} s`;
  return `${ms} ms`;
}

/**
 * 格式化大数字。
 */
function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/**
 * 渲染限流器卡片。
 */
function renderLimiterCard(stat, delta) {
  const usagePct = stat.max > 0 ? Math.min(100, Math.round((stat.activeIPs / stat.max) * 100)) : 0;
  const blockPct = stat.totalRequests > 0 ? Math.round((stat.blocked / stat.totalRequests) * 100) : 0;

  let severity = 'ok';
  if (blockPct > 20) severity = 'danger';
  else if (blockPct > 5) severity = 'warn';

  return `
    <div class="rl-limiter-card" data-severity="${severity}">
      <div class="rl-limiter-header">
        <span class="rl-limiter-name">${stat.name}</span>
        <span class="rl-limiter-budget">${stat.max} req/${formatWindow(stat.windowMs)}</span>
      </div>

      <div class="rl-limiter-body">
        <div class="rl-metric">
          <span class="rl-metric-value">${formatNum(stat.totalRequests)}</span>
          <span class="rl-metric-label">总请求</span>
          ${delta ? `<span class="rl-delta">+${delta.totalRequests}</span>` : ''}
        </div>
        <div class="rl-metric rl-metric-blocked">
          <span class="rl-metric-value ${blockPct > 5 ? 'text-danger' : ''}">${formatNum(stat.blocked)}</span>
          <span class="rl-metric-label">已拦截 (${blockPct}%)</span>
          ${delta ? `<span class="rl-delta rl-delta-danger">+${delta.blocked}</span>` : ''}
        </div>
        <div class="rl-metric">
          <span class="rl-metric-value">${stat.activeIPs}</span>
          <span class="rl-metric-label">活跃 IP</span>
        </div>
      </div>

      <div class="rl-bar">
        <div class="rl-bar-fill" style="width:${usagePct}%"></div>
      </div>

      ${stat.topIP ? `
        <div class="rl-topip">
          <span class="rl-topip-label">最高频</span>
          <code class="rl-topip-ip">${stat.topIP.ip}</code>
          <span class="rl-topip-count">${stat.topIP.count} 次</span>
        </div>
      ` : `
        <div class="rl-topip rl-topip-empty">暂无流量</div>
      `}
    </div>
  `;
}

/**
 * 渲染面板内容。
 */
async function render(container) {
  _el = container;

  // 首次渲染骨架
  container.innerHTML = `
    <div class="rl-panel">
      <div class="rl-header">
        <h3 class="rl-title">🚦 限流状态</h3>
        <div class="rl-controls">
          <button class="rl-refresh-btn" title="立即刷新">⟳</button>
          <span class="rl-status-dot" title="自动刷新中"></span>
        </div>
      </div>
      <div class="rl-limiters" id="rl-limiters">
        <div class="rl-loading">加载中...</div>
      </div>
      <div class="rl-footer">
        <span class="rl-update-time" id="rl-update-time"></span>
      </div>
    </div>
  `;

  // 绑定刷新按钮
  const refreshBtn = container.querySelector('.rl-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spinning');
      doRefresh().finally(() => {
        setTimeout(() => refreshBtn.classList.remove('spinning'), 300);
      });
    });
  }

  // 首次加载
  await doRefresh();

  // 启动定时器
  clearInterval(_timer);
  _timer = setInterval(doRefresh, POLL_INTERVAL);

  // 清理旧订阅，监听标签页切换以停止定时器
  if (_unsubTabSwitch) _unsubTabSwitch();
  const rp = Q().RightPanel;
  if (rp && rp.on) {
    _unsubTabSwitch = rp.on('tab:switch', (newTabId) => {
      if (newTabId !== 'rate-limit') {
        clearInterval(_timer);
        _timer = null;
      } else if (!_timer) {
        // Re-start timer when switching back
        _timer = setInterval(doRefresh, POLL_INTERVAL);
        doRefresh();
      }
    });
  }
}

/**
 * 执行刷新。
 */
async function doRefresh() {
  if (!_el) return;
  const data = await fetchStats();
  if (!data) return;

  const limitersEl = _el.querySelector('#rl-limiters');
  const updateTimeEl = _el.querySelector('#rl-update-time');
  if (!limitersEl) return;

  const stats = data.limiters || [];

  if (stats.length === 0) {
    limitersEl.innerHTML = '<div class="rl-empty">暂无限流器数据</div>';
    return;
  }

  // 计算变化量
  let deltas = null;
  if (_prevStats) {
    deltas = {};
    for (const stat of stats) {
      const prev = _prevStats.find(s => s.name === stat.name);
      if (prev) {
        deltas[stat.name] = {
          totalRequests: stat.totalRequests - prev.totalRequests,
          blocked: stat.blocked - prev.blocked,
        };
      }
    }
  }
  _prevStats = stats;

  // 排序：拦截率最高的排前面
  const sorted = [...stats].sort((a, b) => {
    const aPct = a.totalRequests > 0 ? a.blocked / a.totalRequests : 0;
    const bPct = b.totalRequests > 0 ? b.blocked / b.totalRequests : 0;
    return bPct - aPct;
  });

  limitersEl.innerHTML = sorted.map(s => renderLimiterCard(s, deltas?.[s.name])).join('');

  if (updateTimeEl) {
    updateTimeEl.textContent = '更新: ' + new Date(data.ts).toLocaleTimeString();
  }
}

// ──────────────────────────────────────────────
// UIRegistry Registration
// ──────────────────────────────────────────────
(function register() {
  const UIR = Q().UIRegistry;
  if (!UIR) {
    console.warn('[RateLimitPanel] UIRegistry not available, will retry');
    setTimeout(register, 200);
    return;
  }

  const ok = UIR.registerTab('rate-limit', {
    category: "plugin",
    icon: '🚦',
    label: '限流',
    order: 31,
    render: function(container) {
      render(container);
    },
  });

  if (ok) {
    console.log('[RateLimitPanel] Registered rate-limit tab in right panel');
  }
})();

// ════════════════════════════════════════════
// CSS-inject
// ════════════════════════════════════════════
(function injectCSS() {
  const id = 'rl-panel-css';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .rl-panel {
      padding: 12px;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
    }
    .rl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color, #2a2a2e);
    }
    .rl-title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
    }
    .rl-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .rl-refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: var(--text-secondary, #a1a1aa);
      padding: 2px 6px;
      border-radius: 4px;
      transition: transform 0.3s ease, color 0.2s;
    }
    .rl-refresh-btn:hover { color: var(--text-primary, #e4e4e7); background: rgba(255,255,255,0.05); }
    .rl-refresh-btn.spinning { animation: rl-spin 0.6s linear; }
    @keyframes rl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .rl-status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      animation: rl-pulse 2s infinite;
    }
    @keyframes rl-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .rl-limiters {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .rl-loading, .rl-empty {
      color: var(--text-tertiary, #71717a);
      font-size: 13px;
      text-align: center;
      padding: 24px 0;
    }
    .rl-limiter-card {
      background: var(--bg-card, #18181b);
      border: 1px solid var(--border-color, #2a2a2e);
      border-radius: 8px;
      padding: 10px 12px;
      transition: border-color 0.3s;
    }
    .rl-limiter-card[data-severity="danger"] { border-color: #ef4444; }
    .rl-limiter-card[data-severity="warn"]   { border-color: #eab308; }
    .rl-limiter-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .rl-limiter-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      text-transform: capitalize;
    }
    .rl-limiter-budget {
      font-size: 11px;
      color: var(--text-tertiary, #71717a);
      background: rgba(255,255,255,0.05);
      padding: 2px 8px;
      border-radius: 10px;
    }
    .rl-limiter-body {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
    }
    .rl-metric {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .rl-metric-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary, #e4e4e7);
      font-variant-numeric: tabular-nums;
    }
    .rl-metric-blocked .rl-metric-value { color: #ef4444; }
    .rl-metric-label {
      font-size: 10px;
      color: var(--text-tertiary, #71717a);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .rl-delta {
      font-size: 10px;
      color: #22c55e;
      font-weight: 500;
    }
    .rl-delta-danger { color: #ef4444; }
    .rl-bar {
      height: 3px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .rl-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #22d3ee);
      border-radius: 2px;
      transition: width 0.5s ease;
    }
    .rl-topip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }
    .rl-topip-label {
      color: var(--text-tertiary, #71717a);
    }
    .rl-topip-ip {
      font-family: monospace;
      color: var(--text-secondary, #a1a1aa);
      background: rgba(255,255,255,0.04);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
    }
    .rl-topip-count {
      color: var(--text-tertiary, #71717a);
    }
    .rl-topip-empty {
      color: var(--text-tertiary, #71717a);
      font-style: italic;
    }
    .rl-footer {
      padding-top: 6px;
      border-top: 1px solid var(--border-color, #2a2a2e);
    }
    .rl-update-time {
      font-size: 10px;
      color: var(--text-tertiary, #71717a);
    }
    .text-danger { color: #ef4444 !important; }
  `;
  document.head.appendChild(style);
})();

export { render };
