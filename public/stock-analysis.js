/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

﻿// @ts-check
// ============================================================
// Stock Analysis Panel — Stock/Fund Charts with ChartCore
// Fetches data from server-side API (/api/stocks/:id)
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

export const Stocks = {
  _initialized: false,
  _charts: [],
  _dataTimers: [],
  _mockInterval: null,
  _currentStock: null,
  _currentRange: '1M',
  _autoRefresh: false,
  _refreshTimer: null,
  _resizeObserver: null,
};

// ── Stock list (fetched from server on init) ──
let STOCKS = [];

// ── Cache for server responses ──
const _dataCache = {};

// ============================================================
// Fetch Stock Data from Server
// ============================================================

/**
 * Fetch stock list from server API.
 */
async function fetchStockList() {
  try {
    const resp = await fetch('/api/stocks');
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.stocks.length > 0) {
        STOCKS = data.stocks;
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/**
 * Fetch OHLCV data for a stock and range.
 * @param {string} stockId
 * @param {string} range
 * @returns {Promise<object|null>}
 */
async function fetchStockData(stockId, range) {
  const cacheKey = stockId + '|' + range;
  if (_dataCache[cacheKey]) return _dataCache[cacheKey];

  try {
    const resp = await fetch(`/api/stocks/${encodeURIComponent(stockId)}?range=${range}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success) {
        _dataCache[cacheKey] = data;
        return data;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Fetch updated price for ticker updates.
 */
async function fetchPrice(stockId) {
  try {
    const resp = await fetch(`/api/stocks/${encodeURIComponent(stockId)}/price`);
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ============================================================
// Initialization
// ============================================================

let _initPromise = null;

async function init() {
  if (Stocks._initialized) return Promise.resolve();
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      // Inject own CSS dynamically (shared utility via Q.injectCSS)
      if (Q.injectCSS) Q.injectCSS('/css/stocks.css');

      // Fetch stock list from server
      const loaded = await fetchStockList();
      if (!loaded || STOCKS.length === 0) {
        console.warn('[Stocks] No stocks loaded from server, using fallback list');
        STOCKS = [
          { id: 'AAPL', name: 'Apple Inc.', type: 'stock', price: 198.50, prevClose: 195.30 },
          { id: 'GOOGL', name: 'Alphabet Inc.', type: 'stock', price: 175.20, prevClose: 173.80 },
          { id: 'MSFT', name: 'Microsoft Corp.', type: 'stock', price: 425.30, prevClose: 420.10 },
          { id: 'TSLA', name: 'Tesla Inc.', type: 'stock', price: 245.80, prevClose: 250.20 },
          { id: 'BTC', name: 'Bitcoin', type: 'crypto', price: 67580, prevClose: 66200 },
        ];
      }

      // Set default stock
      Stocks._currentStock = STOCKS[0];
      Stocks._currentRange = '1M';

      console.log('[Stocks] Initialized with ' + STOCKS.length + ' stocks from server');
      console.log('[Stocks] Open /stocks.html for standalone page');
    } finally {
      Stocks._initialized = true;
      _initPromise = null;
    }
  })();

  return _initPromise;
}

// ============================================================
// Cleanup
// ============================================================

function cleanup() {
  destroyCharts();
  if (Stocks._refreshTimer) {
    clearInterval(Stocks._refreshTimer);
    Stocks._refreshTimer = null;
  }
  if (Stocks._resizeObserver) {
    Stocks._resizeObserver.disconnect();
    Stocks._resizeObserver = null;
  }
}

function destroyCharts() {
  Stocks._charts.forEach(ch => {
    try { ch.destroy(); } catch (e) { /* ignore */ }
  });
  Stocks._charts = [];
}

// ============================================================
// Render
// ============================================================

async function render() {
  const panel = document.getElementById('rp-stocks');
  if (!panel) return;

  // Guard: init() may still be in progress (async fetch), retry
  if (!Stocks._initialized || !Stocks._currentStock) {
    setTimeout(() => render(), 200);
    return;
  }

  // Cleanup previous
  cleanup();

  const stock = Stocks._currentStock;
  const range = Stocks._currentRange;

  try {
    // Fetch data from server
    const serverData = await fetchStockData(stock.id, range);
    if (!serverData) {
      panel.innerHTML = '<div class="dash-empty">无法获取股票数据，请检查服务器连接</div>';
      return;
    }

    const data = {
      prices: serverData.data.prices,
      volumes: serverData.data.volumes,
      labels: serverData.data.labels,
      ohlc: serverData.data.ohlc,
      stats: serverData.stats,
    };

    // Build HTML
    panel.innerHTML = buildPanelHTML(stock, data);

    // Set up event listeners
    setupEventListeners(panel);

    // Create charts
    setTimeout(() => createCharts(stock, range, data), 50);
  } catch (err) {
    const div = document.createElement('div');
    div.className = 'dash-empty';
    div.textContent = '加载股票数据出错: ' + err.message;
    panel.innerHTML = '';
    panel.appendChild(div);
  }
}

// ============================================================
// Panel HTML Builder
// ============================================================

function buildPanelHTML(stock, data) {
  const stats = data.stats || {};
  const isUp = stats.isUp !== undefined ? stats.isUp : true;
  const changeClass = isUp ? 'up' : 'down';
  const changeSign = isUp ? '+' : '';
  const lastPrice = data.prices[data.prices.length - 1];
  const changeText = (changeSign + (stats.change || 0).toFixed(2));
  const changePctText = (changeSign + (stats.changePct || 0).toFixed(2) + '%');
  const highVal = stats.high || Math.max(...data.prices);
  const lowVal = stats.low || Math.min(...data.prices);
  const openVal = stats.open || data.prices[0];
  const closeVal = stats.close || lastPrice;
  const volumeVal = stats.volume || data.volumes.reduce((a, b) => a + b, 0);

  const rangeTabs = ['1D', '1W', '1M', '3M', '1Y'].map(r =>
    `<button class="stock-time-btn ${r === Stocks._currentRange ? 'active' : ''}" data-range="${r}">${r}</button>`
  ).join('');

  const stockOptions = STOCKS.map(s =>
    `<option value="${s.id}" ${s.id === stock.id ? 'selected' : ''}>${s.name}</option>`
  ).join('');

  return `
    <div class="stock-content" id="stock-content">
      <div class="stock-section">
        <div class="stock-section-title">选择标的</div>
        <div class="stock-selector">
          <div class="stock-select-row">
            <select class="stock-select" id="stock-select">${stockOptions}</select>
            <button class="stock-auto-refresh-btn ${Stocks._autoRefresh ? 'active' : ''}" id="stock-toggle-refresh" title="自动刷新">
              <span>${Stocks._autoRefresh ? 'u23F8' : 'u25B6'}</span>
              <span>${Stocks._autoRefresh ? '停止' : '实时'}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="stock-price-header">
        <span class="stock-price" id="stock-current-price">${lastPrice.toFixed(2)}</span>
        <span class="stock-change ${changeClass}" id="stock-change">
          ${changeText} (${changePctText})
        </span>
      </div>

      <div class="stock-section">
        <div class="stock-time-ranges" id="stock-time-ranges">${rangeTabs}</div>
      </div>

      <div class="stock-section" style="flex:1;min-height:0;">
        <div class="stock-chart-combo">
          <div class="stock-chart-area" id="stock-chart-area">
            <canvas id="stock-price-canvas"></canvas>
          </div>
          <div class="stock-volume-area" id="stock-volume-area">
            <canvas id="stock-volume-canvas"></canvas>
          </div>
        </div>
      </div>

      <div class="stock-section">
        <div class="stock-section-title">关键指标</div>
        <div class="stock-stats-grid" id="stock-stats-grid">
          <div class="stock-stat-item" data-stat="open">
            <span class="stock-stat-label">开盘</span>
            <span class="stock-stat-value">${openVal.toFixed(2)}</span>
          </div>
          <div class="stock-stat-item" data-stat="high">
            <span class="stock-stat-label">最高</span>
            <span class="stock-stat-value">${highVal.toFixed(2)}</span>
          </div>
          <div class="stock-stat-item" data-stat="low">
            <span class="stock-stat-label">最低</span>
            <span class="stock-stat-value">${lowVal.toFixed(2)}</span>
          </div>
          <div class="stock-stat-item" data-stat="close">
            <span class="stock-stat-label">收盘</span>
            <span class="stock-stat-value">${closeVal.toFixed(2)}</span>
          </div>
          <div class="stock-stat-item" data-stat="change">
            <span class="stock-stat-label">涨跌幅</span>
            <span class="stock-stat-value ${changeClass}" id="stock-stat-change-val">${changePctText}</span>
          </div>
          <div class="stock-stat-item" data-stat="volume">
            <span class="stock-stat-label">成交量</span>
            <span class="stock-stat-value" id="stock-stat-volume-val">${formatVolume(volumeVal)}</span>
          </div>
        </div>
      </div>

      <div class="stock-toolbar">
        <span class="stock-last-update" id="stock-last-update">更新: ${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  `;
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(panel) {
  const select = panel.querySelector('#stock-select');
  if (select) {
    select.addEventListener('change', (e) => {
      const id = e.target.value;
      const stock = STOCKS.find(s => s.id === id);
      if (stock) {
        Stocks._currentStock = stock;
        render();
      }
    });
  }

  const ranges = panel.querySelector('#stock-time-ranges');
  if (ranges) {
    ranges.addEventListener('click', (e) => {
      const btn = e.target.closest('.stock-time-btn');
      if (btn && btn.dataset.range) {
        Stocks._currentRange = btn.dataset.range;
        render();
      }
    });
  }

  const refreshBtn = panel.querySelector('#stock-toggle-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', toggleAutoRefresh);
  }
}

// ============================================================
// Chart Creation
// ============================================================

function createCharts(stock, range, data) {
  const priceCanvas = document.getElementById('stock-price-canvas');
  const volumeCanvas = document.getElementById('stock-volume-canvas');

  if (!priceCanvas || !volumeCanvas) return;

  const upColor = getCSSVar('--success', '#22c55e');
  const downColor = getCSSVar('--danger', '#ef4444');
  const isUp = data.prices[data.prices.length - 1] >= data.prices[0];
  const mainColor = isUp ? upColor : downColor;

  if (Q.ChartCore && Q.ChartCore.Chart) {
    const priceChart = new Q.ChartCore.Chart({
      canvas: priceCanvas,
      type: 'area',
      data: {
        labels: data.labels,
        datasets: [{
          label: stock.name || stock.id,
          data: data.prices,
          color: mainColor,
          fillColor: mainColor,
        }],
      },
      options: {
        animate: true,
        animationDuration: 500,
        showGrid: true,
        showAxis: true,
        showDots: data.prices.length <= 30,
        fillOpacity: 0.12,
        lineWidth: 1.5,
        dotRadius: 2,
        yAxisTicks: 4,
      },
    });

    Stocks._charts.push(priceChart);

    const volumeColor = isUp
      ? 'rgba(34, 197, 94, 0.35)'
      : 'rgba(239, 68, 68, 0.35)';

    const volumeChart = new Q.ChartCore.Chart({
      canvas: volumeCanvas,
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{
          label: '成交量',
          data: data.volumes.map(v => v / 1000000),
          color: volumeColor,
        }],
      },
      options: {
        animate: true,
        animationDuration: 500,
        showGrid: false,
        showAxis: false,
        showDots: false,
        barPadding: 0.1,
        barRadius: 1,
        yAxisFormat: (v) => v.toFixed(1) + 'M',
      },
    });

    Stocks._charts.push(volumeChart);

    const combo = document.querySelector('.stock-chart-combo');
    if (combo && !Stocks._resizeObserver) {
      Stocks._resizeObserver = new ResizeObserver(() => {
        Stocks._charts.forEach(ch => {
          try { ch.resize(); } catch (e) { /* ignore */ }
        });
      });
      Stocks._resizeObserver.observe(combo);
    }
  }

  if (Stocks._autoRefresh) {
    startRefreshTimer();
  }

  if (!Stocks._themeObserver) {
    Stocks._themeObserver = new MutationObserver(() => {
      Stocks._charts.forEach(ch => {
        try { ch.invalidateTheme(); ch.resize(); } catch (e) { /* ignore */ }
      });
    });
    const html = document.documentElement;
    Stocks._themeObserver.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  }
}

// ============================================================
// Auto-Refresh (via server API)
// ============================================================

function toggleAutoRefresh() {
  Stocks._autoRefresh = !Stocks._autoRefresh;
  const btn = document.getElementById('stock-toggle-refresh');
  if (btn) {
    btn.classList.toggle('active', Stocks._autoRefresh);
    btn.innerHTML = Stocks._autoRefresh
      ? '<span>u23F8</span><span>停止</span>'
      : '<span>u25B6</span><span>实时</span>';
  }
  if (Stocks._autoRefresh) {
    startRefreshTimer();
  } else {
    stopRefreshTimer();
  }
}

function startRefreshTimer() {
  stopRefreshTimer();
  Stocks._refreshTimer = setInterval(() => {
    const panel = document.getElementById('rp-stocks');
    if (!panel || !panel.classList.contains('active')) return;
    const rp = document.getElementById('right-panel');
    if (rp && rp.classList.contains('collapsed')) return;

    tickPrices();
  }, 5000);
}

function stopRefreshTimer() {
  if (Stocks._refreshTimer) {
    clearInterval(Stocks._refreshTimer);
    Stocks._refreshTimer = null;
  }
}

/** Fetch updated price from server and update chart */
async function tickPrices() {
  const stock = Stocks._currentStock;
  if (!stock) return;

  try {
    // Fetch updated price from server
    const priceData = await fetchPrice(stock.id);
    if (!priceData) return;

    const newPrice = priceData.price;
    stock.price = newPrice;

    // Update displayed price
    const priceEl = document.getElementById('stock-current-price');
    const changeEl = document.getElementById('stock-change');
    const lastUpdate = document.getElementById('stock-last-update');

    if (priceEl) priceEl.textContent = newPrice.toFixed(2);
    if (lastUpdate) lastUpdate.textContent = '更新: ' + new Date().toLocaleTimeString();

    if (changeEl) {
      const isUp = priceData.isUp;
      changeEl.className = 'stock-change ' + (isUp ? 'up' : 'down');
      changeEl.textContent = (isUp ? '+' : '') + priceData.change.toFixed(2) + ' (' + (isUp ? '+' : '') + priceData.changePct.toFixed(2) + '%)';
    }

    // Re-fetch chart data from server with updated price
    const range = Stocks._currentRange;
    const cacheKey = stock.id + '|' + range;
    delete _dataCache[cacheKey]; // bust cache

    // For real-time ticks, use server data
    const serverData = await fetchStockData(stock.id, range);
    if (!serverData || !serverData.data) return;
    const data = {
      prices: serverData.data.prices,
      volumes: serverData.data.volumes,
      labels: serverData.data.labels,
    };

    // Update chart data
    if (Stocks._charts.length >= 1) {
      const isUp = data.prices[data.prices.length - 1] >= data.prices[0];
      const upColor = getCSSVar('--success', '#22c55e');
      const downColor = getCSSVar('--danger', '#ef4444');
      const mainColor = isUp ? upColor : downColor;

      Stocks._charts[0].setData({
        labels: data.labels,
        datasets: [{
          label: stock.name || stock.id,
          data: data.prices,
          color: mainColor,
          fillColor: mainColor,
        }],
      });

      if (Stocks._charts.length >= 2) {
        const volumeColor = isUp
          ? 'rgba(34, 197, 94, 0.35)'
          : 'rgba(239, 68, 68, 0.35)';
        Stocks._charts[1].setData({
          labels: data.labels,
          datasets: [{
          label: '成交量',
            data: data.volumes.map(v => v / 1000000),
            color: volumeColor,
          }],
        });
      }

      updateStats(data, isUp);
    }
  } catch (err) {
    console.warn('[Stocks] Tick error:', err.message);
  }
}

// ============================================================
// Stats Update
// ============================================================

function updateStats(data, isUp) {
  const prices = data.prices;
  const lastPrice = prices[prices.length - 1];
  const stock = Stocks._currentStock;

  const grid = document.getElementById('stock-stats-grid');
  if (!grid) return;

  const setVal = (stat, val) => {
    const item = grid.querySelector(`[data-stat="${stat}"] .stock-stat-value`);
    if (item) item.textContent = val;
  };

  setVal('open', prices[0].toFixed(2));
  setVal('high', Math.max(...prices).toFixed(2));
  setVal('low', Math.min(...prices).toFixed(2));
  setVal('close', lastPrice.toFixed(2));

  if (stock) {
    const changeVal = stock.price - stock.prevClose;
    const changePct = (changeVal / stock.prevClose) * 100;
    const isChangeUp = changeVal >= 0;
    const changeText = (isChangeUp ? '+' : '') + changePct.toFixed(2) + '%';
    const changeEl = grid.querySelector('[data-stat="change"] .stock-stat-value');
    if (changeEl) {
      changeEl.textContent = changeText;
      changeEl.className = 'stock-stat-value ' + (isChangeUp ? 'up' : 'down');
    }
  }

  const totalVol = data.volumes.reduce((a, b) => a + b, 0);
  setVal('volume', formatVolume(totalVol));
}

// ============================================================
// Helpers
// ============================================================

function getCSSVar(name, fallback) {
  return Q.ChartCore ? Q.ChartCore.getCSSVar(name, fallback) : (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
}

function formatVolume(vol) {
  if (vol >= 1000000000) return (vol / 1000000000).toFixed(2) + 'B';
  if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
  return String(vol);
}

// ============================================================
// Exports
// ============================================================
// Legacy compat
Q.Stocks = Stocks;
Stocks.init = init;
Stocks.render = render;
Stocks.cleanup = cleanup;

// ── Auto-init removed — standalone page (/stocks.html) calls init()+render() explicitly
console.log('[Stocks] Module loaded (waiting for standalone page to call init())');

