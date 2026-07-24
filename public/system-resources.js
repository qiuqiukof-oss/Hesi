// @ts-check
// ============================================================
// System Resources Tab — Detailed historical data & charts
//
// Registers itself as a right-panel tab "系统资源" via UIRegistry.
// Uses _Monitor._history data from dashboard.js (RSS, heap,
// latency, disk, rxRate, txRate) and ChartCore.Chart for
// full-size interactive charts.
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ── Colors for each metric (consistent across charts & tables) ──
const METRIC_COLORS = {
  rss:    { line: '#22c55e', area: 'rgba(34,197,94,0.12)', label: '内存 (RSS)',    unit: 'MB', icon: '💾' },
  heap:   { line: '#6366f1', area: 'rgba(99,102,241,0.12)', label: '堆内存',       unit: 'MB', icon: '🧠' },
  latency:{ line: '#f59e0b', area: 'rgba(245,158,11,0.12)', label: '延迟',         unit: 'ms', icon: '⏱' },
  disk:   { line: '#f43f5e', area: 'rgba(244,63,94,0.12)',  label: '磁盘使用率',   unit: '%',  icon: '💾' },
  rxRate: { line: '#06b6d4', area: 'rgba(6,182,212,0.12)',  label: '下载速率',     unit: 'B/s',icon: '📥' },
  txRate: { line: '#8b5cf6', area: 'rgba(139,92,246,0.12)', label: '上传速率',     unit: 'B/s',icon: '📤' },
};

const METRIC_KEYS = ['rss', 'heap', 'latency', 'disk', 'rxRate', 'txRate'];

// ── Chart instances (one per metric) ──
const _charts = {};

/** Get _Monitor history data (with safe fallback) */
function _getHistory(key) {
  return (Q._dashboardMonitor && Q._dashboardMonitor._history && Q._dashboardMonitor._history[key]) || [];
}

/** Get _Monitor sys info */
function _getSys() {
  return (Q._dashboardMonitor && Q._dashboardMonitor.sys) || {};
}

/** Get _Monitor overview */
function _getOverview() {
  return (Q._dashboardMonitor && Q._dashboardMonitor.overview) || {};
}

// ============================================================
// Tab Registration
// ============================================================
function init() {
  if (Q._sysResourcesInited) return;
  Q._sysResourcesInited = true;

  if (!Q.UIRegistry) {
    console.warn('[SysResources] UIRegistry not available — retrying');
    setTimeout(init, 500);
    return;
  }

  const ok = Q.UIRegistry.registerTab('sys-resources', {
    icon: '🖥️',
    label: '系统资源',
    order: 1,
    category: 'monitor',
    render: function(container) {
      renderTab(container);
    },
  });

  if (ok) {
    console.log('[SysResources] Tab registered');
    // Subscribe to tab switch events to refresh charts when visible
    if (Q.RightPanel && Q.RightPanel.on) {
      Q.RightPanel.on('tab:switch', function(tabId) {
        if (tabId === 'sys-resources') {
          refreshCharts();
          refreshTable();
        }
      });
    }
    // Also listen for history updates to auto-refresh
    const checkInterval = setInterval(function() {
      const panel = document.getElementById('rp-sys-resources');
      if (panel && panel.classList.contains('active')) {
        refreshCharts();
        refreshTable();
      }
    }, 4000);
    // Clean up interval if page unloads
    window.addEventListener('beforeunload', function() {
      clearInterval(checkInterval);
    });
  }
}

// ============================================================
// Render
// ============================================================
function renderTab(container) {
  container.innerHTML =
    '<div class="sr-content" id="sr-content">' +

      // ── Summary Cards ──
      '<div class="dash-section">' +
        '<div class="dash-section-title">📊 运行摘要</div>' +
        '<div class="sr-summary-grid" id="sr-summary-grid">' +
          METRIC_KEYS.map(function(key) {
            const m = METRIC_COLORS[key];
            return '<div class="sr-summary-card" style="border-left:3px solid ' + m.line + '">' +
              '<div class="sr-summary-icon">' + m.icon + '</div>' +
              '<div class="sr-summary-body">' +
                '<div class="sr-summary-label">' + m.label + '</div>' +
                '<div class="sr-summary-current" id="sr-cur-' + key + '">—</div>' +
                '<div class="sr-summary-stats" id="sr-stats-' + key + '"></div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +

      // ── Charts Section ──
      '<div class="dash-section">' +
        '<div class="dash-section-title">📈 趋势图表</div>' +
        '<div class="sr-charts-grid" id="sr-charts-grid">' +
          METRIC_KEYS.map(function(key) {
            const m = METRIC_COLORS[key];
            return '<div class="dash-card sr-chart-card">' +
              '<div class="dash-card-header">' +
                '<span class="dash-card-icon">' + m.icon + '</span>' +
                '<span class="dash-card-title">' + m.label + '</span>' +
                '<span class="dash-card-badge" id="sr-chart-badge-' + key + '">—</span>' +
              '</div>' +
              '<div class="dash-card-body sr-chart-body">' +
                '<div class="sr-chart-wrap">' +
                  '<canvas id="sr-chart-' + key + '" class="sr-chart-canvas"></canvas>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>' +

      // ── History Data Table ──
      '<div class="dash-section">' +
        '<div class="dash-section-title">📋 历史数据</div>' +
        '<div class="dash-card">' +
          '<div class="dash-card-header">' +
            '<span class="dash-card-icon">📊</span>' +
            '<span class="dash-card-title">数据点记录 (最近 60 个)</span>' +
            '<span class="dash-card-badge" id="sr-table-count">0</span>' +
            '<button class="dash-chip-btn" id="sr-export-csv" title="导出 CSV">📥 CSV</button>' +
          '</div>' +
          '<div class="dash-card-body" style="padding:0;">' +
            '<div class="sr-table-wrap" id="sr-table-wrap">' +
              '<table class="sr-table" id="sr-table">' +
                '<thead><tr>' +
                  '<th>时间</th>' +
                  '<th>RSS (MB)</th>' +
                  '<th>堆内存 (MB)</th>' +
                  '<th>延迟 (ms)</th>' +
                  '<th>磁盘 (%)</th>' +
                  '<th>下载 (B/s)</th>' +
                  '<th>上传 (B/s)</th>' +
                '</tr></thead>' +
                '<tbody id="sr-table-body"></tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>';

  // Initial render
  refreshSummary();
  refreshCharts();
  refreshTable();

  // Wire up CSV export
  const exportBtn = container.querySelector('#sr-export-csv');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCSV);
  }
}

// ============================================================
// Summary Cards
// ============================================================
function refreshSummary() {
  const now = Date.now();

  METRIC_KEYS.forEach(function(key) {
    const data = _getHistory(key);
    const curEl = document.getElementById('sr-cur-' + key);
    const statsEl = document.getElementById('sr-stats-' + key);
    if (!curEl || !statsEl) return;

    if (data.length === 0) {
      curEl.textContent = '—';
      statsEl.textContent = '';
      return;
    }

    const values = data.map(function(d) { return d.v; });
    const current = values[values.length - 1];
    const minVal = Math.min.apply(null, values);
    const maxVal = Math.max.apply(null, values);
    const avgVal = values.reduce(function(s, v) { return s + v; }, 0) / values.length;

    const m = METRIC_COLORS[key];
    curEl.textContent = formatMetricValue(current, key) + ' ' + m.unit;

    // Also update chart badge
    const badge = document.getElementById('sr-chart-badge-' + key);
    if (badge) {
      badge.textContent = formatMetricValue(current, key) + ' ' + m.unit;
    }

    statsEl.innerHTML =
      '<span class="sr-stat-item"><span class="sr-stat-label">最低</span><span class="sr-stat-val">' + formatMetricValue(minVal, key) + '</span></span>' +
      '<span class="sr-stat-item"><span class="sr-stat-label">最高</span><span class="sr-stat-val">' + formatMetricValue(maxVal, key) + '</span></span>' +
      '<span class="sr-stat-item"><span class="sr-stat-label">平均</span><span class="sr-stat-val">' + formatMetricValue(avgVal, key) + '</span></span>';
  });
}

// ============================================================
// Charts — Full-size interactive charts using ChartCore.Chart
// ============================================================
function refreshCharts() {
  METRIC_KEYS.forEach(function(key) {
    const canvas = document.getElementById('sr-chart-' + key);
    if (!canvas) return;

    const data = _getHistory(key);
    if (data.length < 2) {
      // Show empty state on canvas
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Resize canvas to container
    const wrap = canvas.parentElement;
    if (wrap && wrap.clientWidth > 0 && canvas.clientWidth !== wrap.clientWidth) {
      canvas.style.width = wrap.clientWidth + 'px';
      canvas.style.height = '120px';
    }

    const values = data.map(function(d) { return d.v; });
    const labels = data.map(function(d) {
      const secs = Math.round((Date.now() - d.t) / 1000);
      if (secs < 60) return secs + 's前';
      return Math.floor(secs / 60) + 'm前';
    });

    const m = METRIC_COLORS[key];

    // Use ChartCore.Chart if available
    if (Q.ChartCore && Q.ChartCore.Chart) {
      // Destroy previous chart instance
      if (_charts[key]) {
        try { _charts[key].destroy(); } catch (e) {
          console.warn('[SysResources] Chart destroy error:', e?.message);
        }
        _charts[key] = null;
      }

      const chart = new Q.ChartCore.Chart({
        canvas: canvas,
        type: 'area',
        data: {
          labels: labels,
          datasets: [{
            label: m.label,
            data: values,
            color: m.line,
            fillColor: m.line,
          }],
        },
        options: {
          animate: false,
          showGrid: true,
          showAxis: true,
          showLegend: false,
          showTooltip: true,
          showDots: false,
          fillOpacity: 0.15,
          lineWidth: 1.5,
          fontSize: 9,
          yAxisTicks: 3,
          yAxisFormat: function(v) { return formatMetricValue(v, key); },
        },
      });

      _charts[key] = chart;
    } else {
      // Fallback: simple canvas drawing
      drawSimpleChart(canvas, data, m.line, key);
    }
  });
}

/** Fallback simple chart when ChartCore.Chart is not available */
function drawSimpleChart(canvas, data, lineColor, key) {
  canvas.width = canvas.parentElement.clientWidth || 300;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const values = data.map(function(d) { return d.v; });
  const minVal = Math.min.apply(null, values);
  const maxVal = Math.max.apply(null, values);
  const range = maxVal - minVal || 1;
  const padX = 4, padY = 4;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;
  function yPos(v) { return padY + (1 - (v - minVal) / range) * chartH; }

  const points = data.slice(-60);
  const stepX = points.length > 1 ? chartW / (points.length - 1) : chartW;

  // Area fill
  ctx.beginPath();
  ctx.moveTo(padX, chartH + padY);
  for (var i = 0; i < points.length; i++) {
    ctx.lineTo(padX + i * stepX, yPos(points[i].v));
  }
  ctx.lineTo(padX + (points.length - 1) * stepX, chartH + padY);
  ctx.closePath();
  const rgba = Q.ChartCore && Q.ChartCore.parseHexToRgba ? Q.ChartCore.parseHexToRgba(lineColor, 0.1) : null;
  ctx.fillStyle = rgba || (lineColor + '1A');
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  for (var i = 0; i < points.length; i++) {
    const x = padX + i * stepX;
    const y = yPos(points[i].v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Latest value dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(padX + (points.length - 1) * stepX, yPos(last.v), 3, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
}

// ============================================================
// History Data Table
// ============================================================
function refreshTable() {
  const tbody = document.getElementById('sr-table-body');
  const countEl = document.getElementById('sr-table-count');
  if (!tbody) return;

  // Collect all timestamps from all metrics (union)
  const timestamps = {};
  METRIC_KEYS.forEach(function(key) {
    const data = _getHistory(key);
    data.forEach(function(d) {
      timestamps[d.t] = timestamps[d.t] || {};
      timestamps[d.t][key] = d.v;
    });
  });

  const sortedTs = Object.keys(timestamps).map(Number).sort(function(a, b) { return b - a; }); // newest first
  if (sortedTs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="sr-empty">暂无数据</td></tr>';
    if (countEl) countEl.textContent = '0';
    return;
  }

  if (countEl) countEl.textContent = String(sortedTs.length);

  let html = '';
  const maxRows = 60;
  for (let i = 0; i < Math.min(sortedTs.length, maxRows); i++) {
    const ts = sortedTs[i];
    const pt = timestamps[ts];
    const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    html += '<tr>' +
      '<td class="sr-td-time">' + time + '</td>' +
      '<td>' + formatMaybe(pt.rss) + '</td>' +
      '<td>' + formatMaybe(pt.heap) + '</td>' +
      '<td>' + formatMaybe(pt.latency) + '</td>' +
      '<td>' + formatMaybe(pt.disk) + '</td>' +
      '<td>' + formatMaybe(pt.rxRate) + '</td>' +
      '<td>' + formatMaybe(pt.txRate) + '</td>' +
    '</tr>';
  }
  tbody.innerHTML = html;
}

// ============================================================
// CSV Export
// ============================================================
function exportCSV() {
  // Collect all data points into a unified timeline
  const timestamps = {};
  METRIC_KEYS.forEach(function(key) {
    const data = _getHistory(key);
    data.forEach(function(d) {
      timestamps[d.t] = timestamps[d.t] || {};
      timestamps[d.t][key] = d.v;
    });
  });

  const sortedTs = Object.keys(timestamps).map(Number).sort(function(a, b) { return a - b; });
  if (sortedTs.length === 0) {
    if (Q.showToast) Q.showToast('暂无数据可导出', 'info');
    return;
  }

  let csv = '时间,RSS (MB),堆内存 (MB),延迟 (ms),磁盘 (%),下载 (B/s),上传 (B/s)\n';
  sortedTs.forEach(function(ts) {
    const pt = timestamps[ts];
    const time = new Date(ts).toLocaleString();
    csv += time + ',' +
      (pt.rss !== undefined ? pt.rss : '') + ',' +
      (pt.heap !== undefined ? pt.heap : '') + ',' +
      (pt.latency !== undefined ? pt.latency : '') + ',' +
      (pt.disk !== undefined ? pt.disk : '') + ',' +
      (pt.rxRate !== undefined ? pt.rxRate : '') + ',' +
      (pt.txRate !== undefined ? pt.txRate : '') + '\n';
  });

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'system-resources-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
  if (Q.showToast) Q.showToast('✅ CSV 已导出', 'success');
}

// ============================================================
// Helpers
// ============================================================
function formatMetricValue(val, key) {
  if (val === undefined || val === null) return '—';
  if (typeof val !== 'number') return String(val);
  if (key === 'rxRate' || key === 'txRate') {
    // Format bytes
    if (val >= 1048576) return (val / 1048576).toFixed(1);
    if (val >= 1024) return (val / 1024).toFixed(1);
    return val.toFixed(0);
  }
  if (val >= 1000) return val.toFixed(0);
  if (val >= 100) return val.toFixed(0);
  if (val >= 10) return val.toFixed(1);
  return val.toFixed(1);
}

function formatMaybe(val) {
  if (val === undefined || val === null) return '—';
  if (typeof val === 'number') {
    if (val >= 1000) return val.toFixed(0);
    if (val >= 100) return val.toFixed(0);
    return val.toFixed(1);
  }
  return String(val);
}

// ============================================================
// Auto-init
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 200);
}
