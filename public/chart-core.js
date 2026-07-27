// @ts-check
// ============================================================
// ChartCore — Lightweight Canvas Chart Engine
// Supports: Line Chart, Bar Chart, Area Chart
// Zero dependencies, auto dark/light theme via CSS variables
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ── Color defaults (read from CSS vars at render time) ──
export function getCSSVar(name, fallback) {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch (e) {
    return fallback;
  }
}

// ── Utility: clamp ──
export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

// ── Utility: lerp ──
export function lerp(a, b, t) { return a + (b - a) * t; }

// ── Utility: hex to rgba ──
export function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b, a: alpha };
}

// ============================================================
// Chart Class
// ============================================================

/**
 * Create a new chart instance.
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas - Target canvas element
 * @param {'line'|'bar'|'area'} opts.type - Chart type
 * @param {Object} opts.data - { labels: string[], datasets: [{ label, data, color, fillColor }] }
 * @param {Object} [opts.options] - Additional options
 */
export function Chart(opts) {
  if (!opts || !opts.canvas) {
    console.error('[ChartCore] Missing canvas element');
    return;
  }

  this.canvas = opts.canvas;
  this.ctx = this.canvas.getContext('2d');
  this.type = opts.type || 'line';
  this.data = opts.data || { labels: [], datasets: [] };
  this.options = Object.assign({}, Chart.defaultOptions, opts.options);

  // Internal state
  this._dpr = window.devicePixelRatio || 1;
  this._width = 0;
  this._height = 0;
  this._padding = null; // computed
  this._chartArea = null; // { x, y, w, h }
  this._tooltip = null;
  this._animationId = null;
  this._animationProgress = 0;
  this._destroyed = false;
  this._boundResize = this._handleResize.bind(this);
  this._boundMouseMove = this._onMouseMove.bind(this);
  this._boundMouseLeave = this._onMouseLeave.bind(this);

  // Init
  this._setupCanvas();
  this._createTooltip();
  this._bindEvents();

  // Initial render (animated)
  this._animationProgress = 0;
  this._animateIn();
}

Chart.defaultOptions = {
  animate: true,
  animationDuration: 600,
  showGrid: true,
  showAxis: true,
  showLegend: false,
  showTooltip: true,
  showDots: true,
  fillOpacity: 0.15,
  gridColor: null,   // resolved from CSS at render
  axisColor: null,
  textColor: null,
  fontFamily: null,
  fontSize: 10,
  lineWidth: 1.5,
  barPadding: 0.2,
  barRadius: 2,
  dotRadius: 2.5,
  yAxisTicks: 5,
  yAxisFormat: null, // function(value) => string
  xAxisLabelRotation: 0,
  maintainAspectRatio: false,
  colors: null, // override dataset colors
};

// ============================================================
// Setup
// ============================================================

Chart.prototype._setupCanvas = function() {
  const rect = this.canvas.getBoundingClientRect();
  this._width = rect.width;
  this._height = rect.height;
  this.canvas.width = rect.width * this._dpr;
  this.canvas.height = rect.height * this._dpr;
  this.ctx.scale(this._dpr, this._dpr);
};

Chart.prototype._resolveThemeColors = function() {
  const o = this.options;
  if (this._cachedTheme && !this._themeDirty) return this._cachedTheme;
  this._cachedTheme = {
    grid: o.gridColor || getCSSVar('--border-subtle', 'rgba(255,255,255,0.06)'),
    axis: o.axisColor || getCSSVar('--border-default', 'rgba(255,255,255,0.1)'),
    text: o.textColor || getCSSVar('--text-tertiary', '#71717a'),
    font: o.fontFamily || getCSSVar('--font-mono', "'JetBrains Mono', monospace"),
  };
  this._themeDirty = false;
  return this._cachedTheme;
};

/** Mark theme as dirty so colors are re-resolved next render */
Chart.prototype.invalidateTheme = function() {
  this._themeDirty = true;
};

// ============================================================
// Layout
// ============================================================

Chart.prototype._computePadding = function() {
  const o = this.options;
  const theme = this._resolveThemeColors();
  const ctx = this.ctx;
  const w = this._width;
  const h = this._height;

  // Measure y-axis label width (supports both 'data' and 'ohlc')
  let maxYLabelWidth = 0;
  if (o.showAxis) {
    const allValues = [];
    const allLows = [];
    const allHighs = [];
    this.data.datasets.forEach(ds => {
      if (ds.hidden) return;
      if (ds.data) allValues.push(...ds.data);
      if (ds.ohlc) {
        ds.ohlc.forEach(o => {
          allLows.push(o.low);
          allHighs.push(o.high);
        });
      }
    });

    let min, max;
    if (allLows.length > 0 && allHighs.length > 0 && allValues.length === 0) {
      min = Math.min(...allLows);
      max = Math.max(...allHighs);
    } else if (allValues.length > 0) {
      min = Math.min(...allValues);
      max = Math.max(...allValues);
    } else {
      min = 0; max = 100;
    }
    const range = max - min || 1;
    for (let i = 0; i <= o.yAxisTicks; i++) {
      const val = min + (range * i) / o.yAxisTicks;
      const label = o.yAxisFormat ? o.yAxisFormat(val) : this._formatValue(val);
      ctx.font = `${o.fontSize}px ${theme.font}`;
      const m = ctx.measureText(label);
      if (m.width > maxYLabelWidth) maxYLabelWidth = m.width;
    }
  }

  const padLeft = 8 + (o.showAxis ? maxYLabelWidth + 8 : 0);
  const padRight = 8;
  const padTop = 8;
  const padBottom = 8 + (o.showAxis ? o.fontSize + 6 : 0);

  this._padding = { top: padTop, bottom: padBottom, left: padLeft, right: padRight };
  this._chartArea = {
    x: padLeft,
    y: padTop,
    w: Math.max(10, w - padLeft - padRight),
    h: Math.max(10, h - padTop - padBottom),
  };
};

// ============================================================
// Data Mapping
// ============================================================

Chart.prototype._mapDataToPixels = function() {
  const area = this._chartArea;
  if (!area || area.w <= 0 || area.h <= 0) return null;

  // Collect all values (supports both 'data' and 'ohlc' arrays)
  const allValues = [];
  const allLows = [];
  const allHighs = [];
  this.data.datasets.forEach(ds => {
    if (ds.hidden) return;
    if (ds.data) allValues.push(...ds.data);
    if (ds.ohlc) {
      ds.ohlc.forEach(o => {
        allLows.push(o.low);
        allHighs.push(o.high);
      });
    }
  });

  let min, max, range;
  if (allLows.length > 0 && allHighs.length > 0 && allValues.length === 0) {
    min = Math.min(...allLows);
    max = Math.max(...allHighs);
  } else if (allValues.length > 0) {
    min = Math.min(...allValues);
    max = Math.max(...allValues);
  } else {
    return null;
  }
  range = max - min || 1;
  const count = this.data.labels.length || 1;

  return { min, max, range, count };
};

Chart.prototype._xToPixel = function(index) {
  const area = this._chartArea;
  if (!area || area.w <= 0) return area.x;
  const count = this.data.labels.length || 1;
  const step = count > 1 ? area.w / (count - 1) : area.w / 2;
  if (this.type === 'bar' || this.type === 'candlestick') {
    return area.x + (index + 0.5) * (area.w / count);
  }
  return area.x + index * step;
};

Chart.prototype._yToPixel = function(value, dataMeta) {
  const area = this._chartArea;
  if (!area) return area.y;
  const { min, range } = dataMeta;
  return area.y + area.h - ((value - min) / range) * area.h;
};

// ============================================================
// Rendering
// ============================================================

Chart.prototype.render = function() {
  if (this._destroyed) return;

  const ctx = this.ctx;
  const w = this._width;
  const h = this._height;

  if (w <= 0 || h <= 0) return;

  // Clear
  ctx.clearRect(0, 0, w, h);

  this._computePadding();
  const dataMeta = this._mapDataToPixels();
  if (!dataMeta) return;

  const theme = this._resolveThemeColors();
  const progress = this._animationProgress;

  // Draw grid
  if (this.options.showGrid) {
    this._drawGrid(dataMeta, theme);
  }

  // Draw axes
  if (this.options.showAxis) {
    this._drawAxes(dataMeta, theme);
  }

  // Draw datasets
  this.data.datasets.forEach((ds, di) => {
    if (ds.hidden) return;
    const color = ds.color || (this.options.colors ? this.options.colors[di % this.options.colors.length] : null) || this._getDefaultColor(di);
    const fillColor = ds.fillColor || color;

    switch (this.type) {
      case 'line':
      case 'area':
        this._drawLineOrArea(ds, dataMeta, color, fillColor, progress, theme);
        break;
      case 'bar':
        this._drawBars(ds, dataMeta, color, progress, theme);
        break;
      case 'candlestick':
        this._drawCandlesticks(ds, dataMeta, theme);
        break;
    }
  });
};

// ============================================================
// Grid & Axes
// ============================================================

Chart.prototype._drawGrid = function(dataMeta, theme) {
  const ctx = this.ctx;
  const area = this._chartArea;
  const { min, range } = dataMeta;

  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;

  // Horizontal grid lines
  for (let i = 0; i <= this.options.yAxisTicks; i++) {
    const val = min + (range * i) / this.options.yAxisTicks;
    const y = this._yToPixel(val, dataMeta);
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
  }

  ctx.restore();
};

Chart.prototype._drawAxes = function(dataMeta, theme) {
  const ctx = this.ctx;
  const area = this._chartArea;
  const { min, range, count } = dataMeta;
  const o = this.options;

  ctx.save();
  ctx.fillStyle = theme.text;
  ctx.font = `${o.fontSize}px ${theme.font}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  // Y-axis labels
  for (let i = 0; i <= o.yAxisTicks; i++) {
    const val = min + (range * i) / o.yAxisTicks;
    const y = this._yToPixel(val, dataMeta);
    const label = o.yAxisFormat ? o.yAxisFormat(val) : this._formatValue(val);
    ctx.fillText(label, area.x - 6, y);
  }

  // X-axis labels (show a subset to avoid overlap)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labels = this.data.labels;
  const maxLabels = Math.max(1, Math.floor(area.w / 30));
  const step = Math.max(1, Math.ceil(count / maxLabels));

  for (let i = 0; i < count; i += step) {
    const x = this._xToPixel(i);
    ctx.fillText(labels[i] || '', x, area.y + area.h + 4);
  }

  // Bottom axis line
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(area.x, area.y + area.h);
  ctx.lineTo(area.x + area.w, area.y + area.h);
  ctx.stroke();

  ctx.restore();
};

// ============================================================
// Line / Area Chart
// ============================================================

Chart.prototype._drawLineOrArea = function(ds, dataMeta, color, fillColor, progress, theme) {
  const ctx = this.ctx;
  const area = this._chartArea;
  const data = ds.data || [];
  const count = data.length;
  const o = this.options;

  if (count === 0) return;

  // Resolve colors
  const lineColor = color;
  const areaColor = fillColor || color;

  // Animation: reveal data points based on progress
  const visibleCount = Math.max(1, Math.floor(count * progress));

  // Build path
  ctx.save();

  // Clip to chart area
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();

  // Draw area fill
  if (this.type === 'area') {
    ctx.beginPath();
    ctx.moveTo(this._xToPixel(0), area.y + area.h);
    for (let i = 0; i < visibleCount; i++) {
      const x = this._xToPixel(i);
      const y = this._yToPixel(data[i], dataMeta);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(this._xToPixel(visibleCount - 1), area.y + area.h);
    ctx.closePath();

    const rgba = hexToRgba(areaColor, o.fillOpacity);

    const gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
    gradient.addColorStop(0, `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a})`);
    gradient.addColorStop(1, `rgba(${rgba.r},${rgba.g},${rgba.b},0)`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // Draw line
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = o.lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let i = 0; i < visibleCount; i++) {
    const x = this._xToPixel(i);
    const y = this._yToPixel(data[i], dataMeta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw dots
  if (o.showDots && visibleCount <= 60) {
    const every = Math.max(1, Math.floor(count / 40));
    for (let i = 0; i < visibleCount; i += every) {
      const x = this._xToPixel(i);
      const y = this._yToPixel(data[i], dataMeta);
      ctx.beginPath();
      ctx.arc(x, y, o.dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.strokeStyle = getCSSVar('--bg-surface', '#121214');
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  ctx.restore();
};

// ============================================================
// Bar Chart
// ============================================================

Chart.prototype._drawBars = function(ds, dataMeta, color, progress, theme) {
  const ctx = this.ctx;
  const area = this._chartArea;
  const data = ds.data || [];
  const count = data.length;
  const o = this.options;

  if (count === 0) return;

  const barWidth = (area.w / count) * (1 - o.barPadding);
  const visibleCount = Math.max(1, Math.floor(count * progress));
  const zeroY = area.y + area.h; // bars grow from bottom

  ctx.save();

  // Clip to chart area
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();

  for (let i = 0; i < visibleCount; i++) {
    const x = this._xToPixel(i) - barWidth / 2;
    const y = this._yToPixel(data[i], dataMeta);
    const barH = Math.max(1, zeroY - y);

    // Animated height
    const animH = barH * progress;

    ctx.fillStyle = color;

    if (o.barRadius > 0) {
      // Rounded rect
      const radius = Math.min(o.barRadius, animH / 2, barWidth / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, zeroY);
      ctx.lineTo(x + radius, zeroY - animH + radius);
      ctx.quadraticCurveTo(x + radius, zeroY - animH, x + radius * 2, zeroY - animH);
      ctx.lineTo(x + barWidth - radius * 2, zeroY - animH);
      ctx.quadraticCurveTo(x + barWidth - radius, zeroY - animH, x + barWidth - radius, zeroY - animH + radius);
      ctx.lineTo(x + barWidth - radius, zeroY);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, zeroY - animH, barWidth, animH);
    }
  }

  ctx.restore();
};

// ============================================================
// Candlestick Chart
// ============================================================

Chart.prototype._drawCandlesticks = function(ds, dataMeta, theme) {
  const ctx = this.ctx;
  const area = this._chartArea;
  const ohlc = ds.ohlc || [];
  const count = ohlc.length;
  const o = this.options;

  if (count === 0) return;

  const candleWidth = Math.max(1, (area.w / count) * 0.6);
  const wickWidth = Math.max(1, candleWidth * 0.15);

  // Resolve colors
  const upColor = ds.upColor || '#22c55e';    // green
  const downColor = ds.downColor || '#ef4444'; // red

  ctx.save();

  // Clip to chart area
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();

  for (let i = 0; i < count; i++) {
    const entry = ohlc[i];
    if (!entry || entry.open == null || entry.close == null) continue;

    const { open, high, low, close } = entry;
    const isUp = close >= open;

    const x = this._xToPixel(i);
    const yOpen = this._yToPixel(open, dataMeta);
    const yClose = this._yToPixel(close, dataMeta);
    const yHigh = this._yToPixel(high, dataMeta);
    const yLow = this._yToPixel(low, dataMeta);

    const bodyTop = Math.min(yOpen, yClose);
    const bodyBottom = Math.max(yOpen, yClose);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);
    const halfWick = Math.max(1, wickWidth / 2);
    const halfBody = candleWidth / 2;

    const color = isUp ? upColor : downColor;

    // ── Draw wick (high → low vertical line) ──
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = wickWidth;
    ctx.lineCap = 'round';
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    // ── Draw body (rectangle from open to close) ──
    ctx.fillStyle = color;
    ctx.globalAlpha = isUp ? 0.8 : 0.8;
    ctx.fillRect(x - halfBody, bodyTop, candleWidth, bodyHeight);

    // Reset alpha
    ctx.globalAlpha = 1;
  }

  ctx.restore();
};

// ============================================================
// Tooltip
// ============================================================

Chart.prototype._createTooltip = function() {
  if (this.options.showTooltip) {
    this._tooltip = document.createElement('div');
    this._tooltip.className = 'chart-tooltip';
    this._tooltip.innerHTML = '<div class="chart-tooltip-title"></div><div class="chart-tooltip-body"></div>';
    this.canvas.parentNode.appendChild(this._tooltip);
  }
};

Chart.prototype._bindEvents = function() {
  if (this.options.showTooltip) {
    this.canvas.addEventListener('mousemove', this._boundMouseMove);
    this.canvas.addEventListener('mouseleave', this._boundMouseLeave);
  }
  window.addEventListener('resize', this._boundResize);
};

Chart.prototype._unbindEvents = function() {
  if (this.canvas) {
    this.canvas.removeEventListener('mousemove', this._boundMouseMove);
    this.canvas.removeEventListener('mouseleave', this._boundMouseLeave);
  }
  window.removeEventListener('resize', this._boundResize);
};

Chart.prototype._onMouseMove = function(e) {
  if (!this._tooltip || this._destroyed) return;

  const rect = this.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const area = this._chartArea;
  if (!area || mx < area.x || mx > area.x + area.w || my < area.y || my > area.y + area.h) {
    this._tooltip.classList.remove('visible');
    return;
  }

  // Find closest data point
  const count = this.data.labels.length;
  if (count === 0) return;

  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < count; i++) {
    const x = this._xToPixel(i);
    const dist = Math.abs(mx - x);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }

  // Only show if close enough
  if (minDist > 30) {
    this._tooltip.classList.remove('visible');
    return;
  }

  // Build tooltip content
  const label = this.data.labels[closestIdx] || '';
  const titleEl = this._tooltip.querySelector('.chart-tooltip-title');
  if (titleEl) titleEl.textContent = label;

  const bodyEl = this._tooltip.querySelector('.chart-tooltip-body');
  if (bodyEl) {
    bodyEl.innerHTML = this.data.datasets.map((ds, di) => {
      if (ds.hidden) return '';
      const val = (ds.data && ds.data[closestIdx] !== undefined) ? ds.data[closestIdx] : '—';
      const color = ds.color || this._getDefaultColor(di);
      return `<div class="chart-tooltip-row">
        <span class="chart-tooltip-dot" style="background:${color}"></span>
        <span>${ds.label || ''}:</span>
        <span class="chart-tooltip-value">${this._formatValue(val)}</span>
      </div>`;
    }).join('');
  }

  // Position tooltip
  let tx = mx + 12;
  let ty = my - 10;

  // Keep within viewport
  const tw = this._tooltip.offsetWidth || 120;
  const th = this._tooltip.offsetHeight || 60;
  if (tx + tw > this._width - 8) tx = mx - tw - 12;
  if (ty + th > this._height - 8) ty = this._height - th - 8;
  if (ty < 8) ty = 8;

  this._tooltip.style.left = tx + 'px';
  this._tooltip.style.top = ty + 'px';
  this._tooltip.classList.add('visible');
};

Chart.prototype._onMouseLeave = function() {
  if (this._tooltip) {
    this._tooltip.classList.remove('visible');
  }
};

// ============================================================
// Animation
// ============================================================

Chart.prototype._animateIn = function() {
  if (!this.options.animate) {
    this._animationProgress = 1;
    this.render();
    return;
  }

  const duration = this.options.animationDuration;
  const start = performance.now();

  const animate = (now) => {
    if (this._destroyed) return;
    const elapsed = now - start;
    this._animationProgress = Math.min(1, elapsed / duration);
    // Ease-out cubic
    this._animationProgress = 1 - Math.pow(1 - this._animationProgress, 3);
    this.render();
    if (this._animationProgress < 1) {
      this._animationId = requestAnimationFrame(animate);
    }
  };

  this._animationId = requestAnimationFrame(animate);
};

// ============================================================
// Resize
// ============================================================

Chart.prototype._handleResize = function() {
  if (this._destroyed) return;
  if (this._resizeTimer) clearTimeout(this._resizeTimer);
  this._resizeTimer = setTimeout(() => {
    this.resize();
  }, 150);
};

Chart.prototype.resize = function() {
  if (this._destroyed) return;
  this._setupCanvas();
  this._animationProgress = 1; // Skip re-animation on resize
  this.render();
};

// ============================================================
// Public Methods
// ============================================================

/** Update chart data (clear and re-render) */
Chart.prototype.setData = function(data) {
  this.data = data;
  this._animationProgress = 0;
  this._animateIn();
};

/** Update chart type */
Chart.prototype.setType = function(type) {
  this.type = type;
  this._animationProgress = 0;
  this._animateIn();
};

/** Update options and re-render */
Chart.prototype.setOptions = function(opts) {
  Object.assign(this.options, opts);
  this.render();
};

/** Toggle dataset visibility */
Chart.prototype.toggleDataset = function(index) {
  if (this.data.datasets[index]) {
    this.data.datasets[index].hidden = !this.data.datasets[index].hidden;
    this.render();
  }
};

/** Destroy chart (cleanup) */
Chart.prototype.destroy = function() {
  this._destroyed = true;
  if (this._animationId) {
    cancelAnimationFrame(this._animationId);
  }
  if (this._resizeTimer) {
    clearTimeout(this._resizeTimer);
  }
  this._unbindEvents();
  if (this._tooltip && this._tooltip.parentNode) {
    this._tooltip.parentNode.removeChild(this._tooltip);
  }
};

// ============================================================
// Helpers
// ============================================================

Chart.prototype._getDefaultColor = function(index) {
  const palette = [
    '#6366f1', '#06b6d4', '#22c55e', '#f59e0b',
    '#ef4444', '#a855f7', '#ec4899', '#14b8a6',
  ];
  return palette[index % palette.length];
};

Chart.prototype._formatValue = function(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + 'K';
    return value.toFixed(2);
  }
  return String(value);
};

// ============================================================
// Mini Chart Helpers — lightweight trend lines & sparklines
// Used by dashboard.js for system resource & process trend charts
// ============================================================

// Ensure Q.ChartCore namespace exists BEFORE assigning helpers
Q.ChartCore = Q.ChartCore || {};

/**
 * Parse a CSS hex color to rgba string.
 * @param {string} colorStr — e.g. "#6366f1"
 * @param {number} alpha — 0..1
 * @returns {string|null} e.g. "rgba(99,102,241,0.2)"
 */
Q.ChartCore.parseHexToRgba = function parseHexToRgba(colorStr, alpha) {
  if (!colorStr) return null;
  const s = colorStr.trim();
  if (s.startsWith('#')) {
    const hex = s.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
  return null;
};

/**
 * Draw a mini trend line chart on a canvas (60s rolling window).
 * Note: callers should resize canvas.width to clientWidth before calling.
 *
 * @param {HTMLCanvasElement} canvas — canvas element
 * @param {Array<{t:number, v:number}>} data — data points
 * @param {string} lineColor — CSS color for line & fill
 * @param {string} emptyLabel — text shown when no data
 * @param {string} unit — value unit for Y-axis label
 */
Q.ChartCore.drawMiniTrend = function drawMiniTrend(canvas, data, lineColor, emptyLabel, unit) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (data.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#71717a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(emptyLabel || '等待数据...', w / 2, h / 2 + 3);
    return;
  }

  // Compute min/max with padding
  const values = data.map(function(d) { return d.v; });
  let minVal = Math.min.apply(null, values);
  let maxVal = Math.max.apply(null, values);
  const range = maxVal - minVal;
  const padding = range === 0 ? (maxVal * 0.5 || 10) : range * 0.15;
  minVal = Math.max(0, minVal - padding);
  maxVal = maxVal + padding;
  const valRange = maxVal - minVal;

  // Time window: last 60 seconds (or span of data if less)
  const now = Date.now();
  const timeWindow = Math.min(60000, data[data.length - 1].t - data[0].t + 1000);
  const tStart = now - timeWindow;

  // Filter visible points
  const visible = data.filter(function(d) { return d.t >= tStart; });
  if (visible.length < 2) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#71717a';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('等待数据...', w / 2, h / 2 + 3);
    return;
  }

  const padX = 2, padY = 2;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;

  function xPos(t) { return padX + ((t - tStart) / timeWindow) * chartW; }
  function yPos(v) { return padY + (1 - (v - minVal) / valRange) * chartH; }

  // Area fill
  ctx.beginPath();
  ctx.moveTo(xPos(visible[0].t), chartH + padY);
  for (var i = 0; i < visible.length; i++) {
    ctx.lineTo(xPos(visible[i].t), yPos(visible[i].v));
  }
  ctx.lineTo(xPos(visible[visible.length - 1].t), chartH + padY);
  ctx.closePath();

  const rgba0 = Q.ChartCore.parseHexToRgba(lineColor, 0.2);
  const rgba1 = Q.ChartCore.parseHexToRgba(lineColor, 0.02);
  const grd = ctx.createLinearGradient(0, padY, 0, chartH + padY);
  grd.addColorStop(0, rgba0 || (lineColor + '33'));
  grd.addColorStop(1, rgba1 || (lineColor + '05'));
  ctx.fillStyle = grd;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (var i = 0; i < visible.length; i++) {
    const x = xPos(visible[i].t);
    const y = yPos(visible[i].v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Latest dot
  const last = visible[visible.length - 1];
  ctx.beginPath();
  ctx.arc(xPos(last.t), yPos(last.v), 2.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();

  // Labels
  ctx.fillStyle = lineColor;
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(last.v.toFixed(1) + ' ' + (unit || ''), w - padX, padY);

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#71717a';
  ctx.font = '7px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(Math.min.apply(null, visible.map(function(d) { return d.v; })).toFixed(1), padX + 1, chartH + padY - 1);
  ctx.textAlign = 'right';
  ctx.fillText(Math.max.apply(null, visible.map(function(d) { return d.v; })).toFixed(1), w - padX, padY + 9);
};

/**
 * Draw a mini evenly-spaced sparkline (no time axis, just trend shape).
 * Used for per-process CPU/MEM history.
 *
 * @param {HTMLCanvasElement} canvas — canvas element (width must be set by caller)
 * @param {Array<{t:number, v:number}>} data — data points
 * @param {string} lineColor — CSS color
 */
Q.ChartCore.drawSparkLine = function drawSparkLine(canvas, data, lineColor) {
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const values = data.map(function(d) { return d.v; });
  let minVal = Math.min.apply(null, values);
  let maxVal = Math.max.apply(null, values);
  let range = maxVal - minVal;
  if (range === 0) { range = maxVal * 0.5 || 10; minVal = Math.max(0, minVal - range * 0.5); maxVal = maxVal + range * 0.5; }
  const valRange = range;

  const padX = 1, padY = 1;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;

  function yPos(v) { return padY + (1 - (v - minVal) / valRange) * chartH; }

  const points = data.slice(-30);
  if (points.length < 2) return;
  const stepX = chartW / (points.length - 1);

  // Area fill
  const rgba = Q.ChartCore.parseHexToRgba(lineColor, 0.15);
  if (rgba) {
    ctx.beginPath();
    ctx.moveTo(padX, chartH + padY);
    for (var i = 0; i < points.length; i++) {
      ctx.lineTo(padX + i * stepX, yPos(points[i].v));
    }
    ctx.lineTo(padX + (points.length - 1) * stepX, chartH + padY);
    ctx.closePath();
    ctx.fillStyle = rgba;
    ctx.fill();
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (var i = 0; i < points.length; i++) {
    const x = padX + i * stepX;
    const y = yPos(points[i].v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Latest dot
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(padX + (points.length - 1) * stepX, yPos(last.v), 1.5, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
};

// ============================================================
// Expose on QCLI
// ============================================================

Q.ChartCore.Chart = Chart;
Q.ChartCore.getCSSVar = getCSSVar;
Q.ChartCore.formatValue = Chart.prototype._formatValue;

console.log('[ChartCore] Loaded');
