// ============================================================
// MCP Monitor — METRIC event tracking & visualization
// ============================================================

import { setText, escapeHtml } from './dash-utils.js';

/** @typedef {import('./types').QCLI} QCLI */
/** @type {QCLI} */
const Q = window.QCLI || {};

// ── MCP Monitor ──
// Tracks METRIC events from MCP server for the dashboard.

/**
 * Poll /api/mcp/status and reflect the runtime state in the header badge.
 * The MCP sub-process only runs when started with --with-mcp; this gives the
 * panel real feedback instead of an always-empty metrics view.
 */
let _mcpStatusStarted = false;
function fmtUptime(ms) {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  return h + 'h' + (m % 60) + 'm';
}
export function startMcpStatusPoller() {
  if (_mcpStatusStarted) return;
  _mcpStatusStarted = true;
  const tick = async () => {
    const badge = document.getElementById('mcp-status-badge');
    if (!badge) return;
    try {
      const resp = await fetch('/api/mcp/status');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const s = await resp.json();
      badge.classList.remove('is-running', 'is-enabled', 'is-off', 'is-error');
      if (s.running) {
        badge.classList.add('is-running');
        badge.textContent = `运行中 · ${fmtUptime(s.uptimeMs)} · 重启${s.restartCount}`;
        badge.title = `PID ${s.pid} · 指标 ${s.metricCount} · 出 ${s.stdoutBytes}B / 错 ${s.stderrBytes}B`;
      } else if (s.enabled) {
        badge.classList.add('is-enabled');
        badge.textContent = '已启用 · 未运行';
        badge.title = 'MCP 管理器已创建但子进程未运行';
      } else {
        badge.classList.add('is-off');
        badge.textContent = '未启用';
        badge.title = s.message || '使用 --with-mcp 启动以启用 MCP';
      }
    } catch (e) {
      const badge = document.getElementById('mcp-status-badge');
      if (badge) {
        badge.classList.remove('is-running', 'is-enabled', 'is-off');
        badge.classList.add('is-error');
        badge.textContent = '状态获取失败';
        badge.title = String(e?.message || e);
      }
    }
  };
  tick();
  setInterval(tick, 5000);
}export const McpMonitor = {
  /** @type {Array} recent metric events (max 200) */
  events: [],
  /** @type {number} */
  cacheHits: 0,
  /** @type {number} */
  cacheMisses: 0,
  /** @type {number} */
  tokenSaved: 0,
  /** @type {Object.<string,number>} */
  callsByTool: {},

  // ── Real-time frequency tracking (for sparkline) ──
  /** @type {Array<{t:number,ev:string}>} event timestamps for frequency hist (last 60s) */
  _timeline: [],
  /** @type {boolean} pulse state for visual indicator */
  _pulse: false,

  push(metric) {
    const now = Date.now();

    // Track event in timeline (for sparkline frequency)
    this._timeline.push({ t: now, ev: metric.ev || 'unknown' });
    // Prune events older than 60 seconds
    const cutoff = now - 60000;
    while (this._timeline.length > 0 && this._timeline[0].t < cutoff) {
      this._timeline.shift();
    }

    this.events.push(metric);
    if (this.events.length > 200) this.events.shift();

    if (metric.cached === true) this.cacheHits++;
    else if (metric.ev === 'tool_call' || metric.ev === 'resource_read') this.cacheMisses++;

    if (metric.tokenSaved) this.tokenSaved += metric.tokenSaved;
    if (metric.tool) {
      this.callsByTool[metric.tool] = (this.callsByTool[metric.tool] || 0) + 1;
    }

    // Trigger pulse animation
    this._pulse = true;
    setTimeout(() => { this._pulse = false; }, 600);

    // Redraw visualizations on next animation frame if dashboard is visible
    if (document.getElementById('rp-dashboard')?.classList.contains('active')) {
      requestAnimationFrame(() => {
        drawSparkline();
        drawToolBars();
      });
    }
  },

  get hitRate() {
    const total = this.cacheHits + this.cacheMisses;
    return total === 0 ? 0 : this.cacheHits / total;
  },

  /** Get events per second rate over the last 60s window */
  get eventsPerSecond() {
    const windowSec = Math.min(this._timeline.length, 60);
    if (windowSec === 0) return 0;
    return (this._timeline.length / 60).toFixed(1);
  },

  reset() {
    this.events = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.tokenSaved = 0;
    this.callsByTool = {};
    this._timeline = [];
    this._pulse = false;
  },
};

/** MCP event type → Chinese label mapping */
const MCP_EV_LABELS = {
  tool_call: '工具调用',
  resource_read: '资源读取',
  cache_summary: '缓存汇总',
};

/**
 * Update MCP Monitor UI */
export function updateMcpMonitor() {
  const mcp = McpMonitor;
  const count = mcp.events.length;

  setText('dash-mcp-count', count);
  setText('dash-mcp-hitrate', (mcp.hitRate * 100).toFixed(1) + '%');
  setText('dash-mcp-hits', mcp.cacheHits);
  setText('dash-mcp-misses', mcp.cacheMisses);

  // Format token saved
  const saved = mcp.tokenSaved;
  const savedStr = saved === 0 ? '0 B'
    : saved < 1024 ? saved + ' B'
    : saved < 1048576 ? (saved / 1024).toFixed(1) + ' KB'
    : (saved / 1048576).toFixed(1) + ' MB';
  setText('dash-mcp-saved', savedStr);

  // Update pulse indicator and rate badge
  const pulseDot = document.getElementById('mcp-pulse-dot');
  if (pulseDot) {
    pulseDot.classList.toggle('active', mcp._pulse);
    if (mcp._pulse) {
      void pulseDot.offsetWidth; // reflow to restart CSS animation
    }
  }
  setText('mcp-rate-badge', mcp.eventsPerSecond + ' eps');

  // Show/hide empty state
  const emptyEl = document.getElementById('dash-mcp-empty');
  if (emptyEl) emptyEl.style.display = count === 0 ? '' : 'none';

  // Update log (last 15 events, only if visible and changed)
  const logEl = document.getElementById('dash-mcp-log');
  if (!logEl || count === 0) return;
  const lastSerial = count + '|' + (mcp.events[count - 1]?.ev || '');
  if (logEl.dataset.lastSerial === lastSerial) return;
  logEl.dataset.lastSerial = lastSerial;

  const recent = mcp.events.slice(-15).reverse();
  logEl.innerHTML = recent.map((e, i) => {
    const icon = e.cached ? '✅' : (e.ev === 'tool_call' ? '🔧' : (e.ev === 'resource_read' ? '📄' : '⚡'));
    const name = e.tool || e.resource || MCP_EV_LABELS[e.ev] || '未知事件';
    const tokens = e.tokens ? ` (${e.tokens} tok)` : '';
    const savedTag = e.tokenSaved ? ` <span class=\"mcp-saved\">-${e.tokenSaved}tok</span>` : '';
    const animClass = i === 0 && count > 0 ? ' mcp-entry-new' : '';
    return `<div class=\"mcp-log-entry${animClass}\">${icon} <span class=\"mcp-entry-name\">${escapeHtml(name)}</span>${tokens}${savedTag}</div>`;
  }).join('');
}

/** Draw MCP event frequency sparkline on canvas */
export function drawSparkline() {
  const canvas = document.getElementById('mcp-sparkline');
  if (!canvas) return;

  if (canvas.clientWidth > 0 && canvas.clientWidth !== canvas.width) {
    canvas.width = canvas.clientWidth;
  }
  if (canvas.clientHeight > 0 && canvas.clientHeight !== canvas.height) {
    canvas.height = canvas.clientHeight;
  }

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const timeline = McpMonitor._timeline;
  if (timeline.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#71717a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('等待事件...', w / 2, h / 2 + 3);
    return;
  }

  const now = Date.now();
  const buckets = new Array(60).fill(0);
  const cutoff = now - 60000;
  for (const evt of timeline) {
    if (evt.t < cutoff) continue;
    const idx = Math.min(59, Math.floor((evt.t - cutoff) / 1000));
    buckets[idx]++;
  }

  const maxVal = Math.max(1, ...buckets);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6366f1';
  const barW = w / 60;

  // Draw area fill
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < 60; i++) {
    const x = i * barW + barW / 2;
    const barH = (buckets[i] / maxVal) * (h - 4);
    const y = h - 2 - barH;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();

  /** @type {QCLI} */
    const _ph2r = Q.ChartCore && Q.ChartCore.parseHexToRgba ? Q.ChartCore.parseHexToRgba : function() { return null; };
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  const color0 = _ph2r(accent, 0.25);
  const color1 = _ph2r(accent, 0.02);
  if (color0 && color1) {
    grd.addColorStop(0, color0);
    grd.addColorStop(1, color1);
  } else {
    grd.addColorStop(0, 'rgba(99,102,241,0.25)');
    grd.addColorStop(1, 'rgba(99,102,241,0.02)');
  }
  ctx.fillStyle = grd;
  ctx.fill();

  // Draw line on top
  ctx.beginPath();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) {
    const x = i * barW + barW / 2;
    const barH = (buckets[i] / maxVal) * (h - 4);
    const y = h - 2 - barH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw the latest bar highlight
  if (buckets[59] > 0) {
    const lastX = 59 * barW + barW / 2;
    const lastH = (buckets[59] / maxVal) * (h - 4);
    const lastY = h - 2 - lastH;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
  }
}

/** Draw tool call distribution as horizontal bars */
export function drawToolBars() {
  const container = document.getElementById('mcp-tool-bars');
  if (!container) return;
  const emptyEl = document.getElementById('mcp-tools-empty');
  const callsByTool = McpMonitor.callsByTool;
  const entries = Object.entries(callsByTool);

  if (entries.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const total = entries.reduce((s, [, c]) => s + c, 0);
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCount = top[0][1];

  container.innerHTML = top.map(([tool, count]) => {
    const pct = Math.round((count / total) * 100);
    const widthPct = (count / maxCount) * 100;
    return `<div class=\"mcp-tool-bar-row\">
      <span class=\"mcp-tool-bar-label\" title=\"${escapeHtml(tool)}\">${escapeHtml(tool)}</span>
      <div class=\"mcp-tool-bar-track\">
        <div class=\"mcp-tool-bar-fill\" style=\"width:${widthPct}%\"></div>
      </div>
      <span class=\"mcp-tool-bar-count\">${count}</span>
      <span class=\"mcp-tool-bar-pct\">${pct}%</span>
    </div>`;
  }).join('');
}
