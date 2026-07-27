// @ts-check
// ============================================================
// Quant Trading Panel — Simulated AI Quant Strategy Backtester
// Phase 1: frontend-only simulated market data + MA signals
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

export const QuantTrading = {
  _initialized: false,
  _charts: [],
  _timers: [],
  _currentSymbol: 'BTC/USDT',
  _currentTF: '1h',
  _isRunning: false,
  _refreshTimer: null,
  _tradeLog: [],
  _positions: [],
  _portfolio: { totalValue: 10000, cash: 10000 },
  _resizeObserver: null,
  _dataSource: 'simulated',
};

// ── Available trading symbols (crypto + A-shares + HK + US) ──
const SYMBOLS = [
  // Crypto
  { id: 'BTC/USDT', name: 'BTC/USDT', basePrice: 67580, type: 'crypto' },
  { id: 'ETH/USDT', name: 'ETH/USDT', basePrice: 3450, type: 'crypto' },
  { id: 'SOL/USDT', name: 'SOL/USDT', basePrice: 148, type: 'crypto' },
  { id: 'BNB/USDT', name: 'BNB/USDT', basePrice: 595, type: 'crypto' },
  { id: 'DOGE/USDT', name: 'DOGE/USDT', basePrice: 0.12, type: 'crypto' },
  // A-shares (蓝筹)
  { id: '600519', name: '贵州茅台', basePrice: 1480.00, type: 'a-share' },
  { id: '000858', name: '五粮液', basePrice: 135.60, type: 'a-share' },
  { id: '300750', name: '宁德时代', basePrice: 210.50, type: 'a-share' },
  { id: '601318', name: '中国平安', basePrice: 42.80, type: 'a-share' },
  { id: '000333', name: '美的集团', basePrice: 68.90, type: 'a-share' },
  { id: '002415', name: '海康威视', basePrice: 32.50, type: 'a-share' },
  { id: '600036', name: '招商银行', basePrice: 34.50, type: 'a-share' },
  { id: '601166', name: '兴业银行', basePrice: 17.80, type: 'a-share' },
  // HK stocks
  { id: '00700.HK', name: '腾讯控股', basePrice: 388.00, type: 'hk-stock' },
  { id: '09988.HK', name: '阿里巴巴', basePrice: 82.50, type: 'hk-stock' },
  { id: '00941.HK', name: '中国移动', basePrice: 68.50, type: 'hk-stock' },
  { id: '03690.HK', name: '美团-W', basePrice: 118.00, type: 'hk-stock' },
  // US stocks
  { id: 'AAPL', name: 'Apple', basePrice: 198.50, type: 'us-stock' },
  { id: 'MSFT', name: 'Microsoft', basePrice: 425.30, type: 'us-stock' },
  { id: 'TSLA', name: 'Tesla', basePrice: 245.80, type: 'us-stock' },
  { id: 'NVDA', name: 'NVIDIA', basePrice: 880.20, type: 'us-stock' },
  // Index
  { id: '000300', name: '沪深300', basePrice: 3890.50, type: 'index' },
];

// ── Timeframes ──
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

// ── Strategy types ──
const STRATEGIES = [
  { id: 'ma_cross', name: 'MA 金叉/死叉' },
  { id: 'rsi',      name: 'RSI 超买/超卖' },
  { id: 'macd',     name: 'MACD 信号' },
];

// ── Log entries ──
const MAX_LOG = 50;

// ── API base ──
const API_BASE = '/api/quant';

// ============================================================
// Data Fetcher — tries backend API, falls back to simulated
// ============================================================

let _useSimulated = false;

/**
 * Fetch market data from backend, fall back to generateData().
 */
async function fetchMarketData(symbol, tf) {
  const sym = SYMBOLS.find(s => s.id === symbol) || SYMBOLS[0];
  try {
    const res = await fetch(`${API_BASE}/market-data?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');

    // Backend returns json.data = { prices, volumes, labels, ohlc, currentPrice }
    if (!json.data || !json.data.prices || json.data.prices.length === 0) {
      throw new Error('Empty data');
    }

    _useSimulated = json.dataSource === 'simulated';

    // Determine display name for data source
    const srcMap = {
      'tencent': '腾讯',
      'sina': '新浪',
      'eastmoney': '东方财富',
      'binance': 'Binance',
      'cached': '缓存',
      'simulated': '模拟',
    };
    QuantTrading._dataSource = srcMap[json.dataSource] || json.dataSource;

    // Store live price if available
    if (json.livePrice) {
      QuantTrading._livePrice = json.livePrice;
    }

    return {
      currentPrice: json.data.currentPrice,
      prices: json.data.prices,
      labels: json.data.labels,
      ohlc: json.data.ohlc,
      volumes: json.data.volumes,
      dataSource: QuantTrading._dataSource,
    };
  } catch (e) {
    _useSimulated = true;
    QuantTrading._dataSource = 'simulated';
    return generateData(sym.basePrice, tf);
  }
}

/**
 * Fetch strategy signals from backend, fall back to local generateSignals().
 */
async function fetchStrategy(prices, ohlc, strategyId) {
  if (_useSimulated) {
    return generateSignals(prices, ohlc, strategyId);
  }
  try {
    const res = await fetch(`${API_BASE}/strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_data: { prices, ohlc },
        strategy: strategyId,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.signals;
  } catch (e) {
    return generateSignals(prices, ohlc, strategyId);
  }
}

// ============================================================
// Simulated Data Generator (fallback — no backend needed)
// ============================================================

/**
 * Generate simulated OHLCV + price data using random walk.
 */
function generateData(basePrice, tf, length) {
  const points = length || 80;
  const vol = basePrice * 0.015;
  let price = basePrice * (1 + (Math.random() - 0.5) * 0.06);
  const now = Date.now();
  const intervalMs = tf === '15m' ? 900000 : tf === '1h' ? 3600000 : tf === '4h' ? 14400000 : 86400000;

  const prices = [];
  const ohlc = [];
  const labels = [];
  const volumes = [];

  for (let i = points - 1; i >= 0; i--) {
    const drift = (basePrice - price) * 0.005;
    const shock = (Math.random() - 0.5) * vol;
    price = Math.max(basePrice * 0.1, price + drift + shock);

    const open = price;
    const close = price + (Math.random() - 0.5) * vol * 0.3;
    const high = Math.max(open, close) + Math.random() * vol * 0.4;
    const low = Math.min(open, close) - Math.random() * vol * 0.4;

    const flooredOpen = Math.round(open * 100) / 100;
    const flooredClose = Math.round(close * 100) / 100;

    prices.push(flooredClose);
    ohlc.push({
      open: flooredOpen,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: flooredClose,
    });

    volumes.push(Math.round((basePrice * 5000 + Math.random() * basePrice * 10000)));

    const ts = new Date(now - i * intervalMs);
    if (tf === '1d') {
      labels.push((ts.getMonth() + 1) + '/' + ts.getDate());
    } else {
      labels.push(ts.getHours().toString().padStart(2, '0') + ':' + ts.getMinutes().toString().padStart(2, '0'));
    }
  }

  return { prices, ohlc, labels, volumes, currentPrice: price };
}

/**
 * Compute simple moving average.
 */
function computeMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      result.push(Math.round((sum / period) * 100) / 100);
    }
  }
  return result;
}

/**
 * Compute RSI (14-period).
 */
function computeRSI(ohlc, period) {
  period = period || 14;
  const closes = ohlc.map(o => o.close);
  const result = [];
  const gains = [], losses = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(null);
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(Math.round((100 - 100 / (1 + rs)) * 10) / 10);
      }
    }
  }
  return result;
}

/**
 * Generate simulated buy/sell signals based on strategy.
 */
function generateSignals(prices, ohlc, strategyId) {
  const signals = [];

  if (strategyId === 'ma_cross') {
    const ma7 = computeMA(prices, 7);
    const ma25 = computeMA(prices, 25);
    for (let i = 1; i < prices.length; i++) {
      if (ma7[i] == null || ma25[i] == null || ma7[i - 1] == null || ma25[i - 1] == null) continue;
      // Golden cross: MA7 crosses above MA25
      if (ma7[i - 1] <= ma25[i - 1] && ma7[i] > ma25[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], reason: 'MA7 上穿 MA25', confidence: 0.75 });
      }
      // Death cross: MA7 crosses below MA25
      if (ma7[i - 1] >= ma25[i - 1] && ma7[i] < ma25[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], reason: 'MA7 下穿 MA25', confidence: 0.75 });
      }
    }
  } else if (strategyId === 'rsi') {
    const rsi = computeRSI(ohlc, 14);
    for (let i = 1; i < rsi.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      // RSI crosses below 30 → oversold → buy
      if (rsi[i - 1] >= 30 && rsi[i] < 30) {
        signals.push({ index: i, type: 'buy', price: prices[i], reason: 'RSI 超卖区域', confidence: 0.65 });
      }
      // RSI crosses above 70 → overbought → sell
      if (rsi[i - 1] <= 70 && rsi[i] > 70) {
        signals.push({ index: i, type: 'sell', price: prices[i], reason: 'RSI 超买区域', confidence: 0.65 });
      }
    }
  } else if (strategyId === 'macd') {
    const ema12 = computeMA(prices, 12);
    const ema26 = computeMA(prices, 26);
    const macdLine = [];
    const signalLine = [];
    for (let i = 0; i < prices.length; i++) {
      if (ema12[i] == null || ema26[i] == null) {
        macdLine.push(null);
        signalLine.push(null);
      } else {
        macdLine.push(ema12[i] - ema26[i]);
      }
    }
    // Simple signal line (9-period MA of MACD)
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null) { signalLine.push(null); continue; }
      const start = Math.max(0, i - 8);
      const slice = macdLine.slice(start, i + 1).filter(v => v != null);
      signalLine.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
    for (let i = 1; i < macdLine.length; i++) {
      if (macdLine[i] == null || signalLine[i] == null || macdLine[i - 1] == null || signalLine[i - 1] == null) continue;
      // MACD line crosses above signal → buy
      if (macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], reason: 'MACD 金叉', confidence: 0.70 });
      }
      // MACD line crosses below signal → sell
      if (macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], reason: 'MACD 死叉', confidence: 0.70 });
      }
    }
  }

  return signals;
}

// ============================================================
// Initialization
// ============================================================

function init() {
  if (QuantTrading._initialized) return;
  QuantTrading._initialized = true;

  // Inject own CSS dynamically (shared utility via Q.injectCSS)
  if (Q.injectCSS) Q.injectCSS('/css/quant-trading.css');

  console.log('[QuantTrading] Initialized');
  console.log('[QuantTrading] Open /quant.html for standalone page');
}

// ============================================================
// Cleanup
// ============================================================

function cleanup() {
  QuantTrading._charts.forEach(ch => {
    try { ch.destroy(); } catch (e) { /* ignore */ }
  });
  QuantTrading._charts = [];
  QuantTrading._timers.forEach(t => clearTimeout(t));
  QuantTrading._timers = [];
  if (QuantTrading._refreshTimer) {
    clearInterval(QuantTrading._refreshTimer);
    QuantTrading._refreshTimer = null;
  }
  if (QuantTrading._resizeObserver) {
    QuantTrading._resizeObserver.disconnect();
    QuantTrading._resizeObserver = null;
  }
}

// ============================================================
// Render
// ============================================================

async function render() {
  const panel = document.getElementById('rp-quant');
  if (!panel) return;

  cleanup();

  const symbol = QuantTrading._currentSymbol;
  const tf = QuantTrading._currentTF;
  const sym = SYMBOLS.find(s => s.id === symbol) || SYMBOLS[0];

  try {
    // Fetch market data (backend → simulated fallback)
    const data = await fetchMarketData(symbol, tf);
    const signals = await fetchStrategy(data.prices, data.ohlc, 'ma_cross');
    const ma7 = computeMA(data.prices, 7);
    const ma25 = computeMA(data.prices, 25);

    // Update portfolio with current price
    updatePortfolio(sym, data.currentPrice);

    // Build HTML
    panel.innerHTML = buildPanelHTML(sym, data, signals);
    setupEventListeners(panel, sym, data, signals, ma7, ma25);
    setTimeout(() => createCharts(sym, data, signals, ma7, ma25), 50);
  } catch (err) {
    const div = document.createElement('div');
    div.className = 'dash-empty';
    div.textContent = '加载失败: ' + err.message;
    panel.innerHTML = '';
    panel.appendChild(div);
  }
}

// ============================================================
// Portfolio Management
// ============================================================

function updatePortfolio(sym, currentPrice) {
  const p = QuantTrading._portfolio;
  // Simulate small PnL change
  const totalChange = (Math.random() - 0.48) * 0.02;
  p.totalValue = Math.round(p.totalValue * (1 + totalChange) * 100) / 100;
  p.cash = Math.round((p.totalValue * (0.3 + Math.random() * 0.4)) * 100) / 100;

  // Simulate positions
  if (QuantTrading._positions.length === 0) {
    QuantTrading._positions = [
      { symbol: 'BTC/USDT', amount: 0.05, entryPrice: sym.basePrice * 0.98, currentPrice: currentPrice },
      { symbol: 'ETH/USDT', amount: 1.2, entryPrice: sym.basePrice * 0.95, currentPrice: currentPrice * 0.45 },
    ];
  } else {
    QuantTrading._positions.forEach(pos => {
      if (pos.symbol === sym.id) {
        pos.currentPrice = currentPrice;
      } else {
        pos.currentPrice = pos.currentPrice * (1 + (Math.random() - 0.48) * 0.01);
      }
    });
  }

  QuantTrading._tradeLog = QuantTrading._tradeLog.slice(-MAX_LOG);
}

function addLog(type, msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  QuantTrading._tradeLog.push({ time, type, msg });
  if (QuantTrading._tradeLog.length > MAX_LOG) {
    QuantTrading._tradeLog = QuantTrading._tradeLog.slice(-MAX_LOG);
  }
}

// ============================================================
// Panel HTML Builder
// ============================================================

function buildPanelHTML(sym, data, signals) {
  const currentPrice = data.currentPrice;
  const isUp = data.prices[data.prices.length - 1] >= data.prices[0];
  const changeClass = isUp ? 'up' : 'down';
  const changePct = ((data.prices[data.prices.length - 1] / data.prices[0] - 1) * 100).toFixed(2);
  const changeSign = isUp ? '+' : '';

  const p = QuantTrading._portfolio;
  const pnlPct = ((p.totalValue / 10000 - 1) * 100).toFixed(2);
  const pnlClass = pnlPct >= 0 ? 'up' : 'down';
  const pnlSign = pnlPct >= 0 ? '+' : '';

  // Symbol options
  const symOpts = SYMBOLS.map(s =>
    `<option value="${s.id}" ${s.id === sym.id ? 'selected' : ''}>${s.name}</option>`
  ).join('');

  // Timeframe buttons
  const tfBtns = TIMEFRAMES.map(tf =>
    `<button class="quant-tf-btn ${tf === QuantTrading._currentTF ? 'active' : ''}" data-tf="${tf}">${tf}</button>`
  ).join('');

  // Strategy select
  const stratOpts = STRATEGIES.map(s =>
    `<option value="${s.id}" ${s.id === 'ma_cross' ? 'selected' : ''}>${s.name}</option>`
  ).join('');

  // Trade log entries
  const logEntries = QuantTrading._tradeLog.slice(-20).map(e =>
    `<div class="quant-log-entry">
      <span class="qle-time">${e.time}</span>
      <span class="qle-type ${e.type}">${e.type === 'buy' ? '买入' : e.type === 'sell' ? '卖出' : e.type === 'signal' ? '信号' : '信息'}</span>
      <span class="qle-msg">${e.msg}</span>
    </div>`
  ).join('') || '<div class="quant-log-entry"><span class="qle-msg" style="color:var(--text-tertiary)">暂无交易记录</span></div>';

  // Positions table
  const posRows = QuantTrading._positions.map(pos => {
    const pnl = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2);
    const pClass = pnl >= 0 ? 'up' : 'down';
    const pSign = pnl >= 0 ? '+' : '';
    return `<tr><td>${pos.symbol}</td><td>${pos.amount.toFixed(pos.amount < 1 ? 4 : 2)}</td><td>${pos.entryPrice.toFixed(2)}</td><td>${pos.currentPrice.toFixed(2)}</td><td class="${pClass}">${pSign}${pnl}%</td></tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);font-size:9px">无持仓</td></tr>';

  return `
    <div class="quant-content" id="quant-content">
      <!-- Top Bar -->
      <div class="quant-topbar">
        <select class="quant-symbol-select" id="quant-symbol-select">${symOpts}</select>
        <div class="quant-price-display">
          <div class="quant-price-value ${changeClass}">${currentPrice.toFixed(2)}</div>
          <div class="quant-price-change ${changeClass}">${changeSign}${changePct}%</div>
        </div>
        <div class="quant-badge-group">
          <span class="quant-badge ${QuantTrading._dataSource === 'simulated' ? 'badge-warn' : 'badge-ok'}">${QuantTrading._dataSource || 'simulated'}</span>
        </div>
        <div style="flex:1"></div>
        <a href="/quant" class="quant-standalone-btn" title="新窗口打开独立页面" target="_blank">↗</a>
      </div>

      <!-- Timeframes -->
      <div class="quant-tf-row" id="quant-tf-row">${tfBtns}</div>

      <!-- Strategy Config -->
      <div class="quant-config">
        <div class="quant-config-row">
          <label>策略</label>
          <select id="quant-strategy-select">${stratOpts}</select>
        </div>
        <div class="quant-config-row">
          <label>资金</label>
          <input type="number" id="quant-capital" value="${p.totalValue.toFixed(0)}" step="1000" min="100" />
        </div>
        <div class="quant-actions">
          <button class="quant-btn quant-btn-run" id="quant-btn-run">
            <span class="quant-indicator ${QuantTrading._isRunning ? 'running' : 'stopped'}"></span>
            ${QuantTrading._isRunning ? '运行中...' : '运行策略'}
          </button>
          <button class="quant-btn quant-btn-secondary" id="quant-btn-backtest">回测</button>
        </div>
      </div>

      <!-- Portfolio Cards -->
      <div class="quant-portfolio">
        <div class="quant-portfolio-card">
          <div class="qpc-label">总资产</div>
          <div class="qpc-value ${pnlClass}">$${p.totalValue.toFixed(2)}</div>
        </div>
        <div class="quant-portfolio-card">
          <div class="qpc-label">现金</div>
          <div class="qpc-value">$${p.cash.toFixed(2)}</div>
        </div>
        <div class="quant-portfolio-card">
          <div class="qpc-label">收益率</div>
          <div class="qpc-value ${pnlClass}">${pnlSign}${pnlPct}%</div>
        </div>
      </div>

      <!-- K-line Chart -->
      <div class="quant-chart-wrap" id="quant-chart-wrap">
        <canvas id="quant-price-canvas"></canvas>
      </div>

      <!-- Positions -->
      <div class="quant-positions">
        <div class="quant-positions-header">当前持仓 (${QuantTrading._positions.length})</div>
        <table class="quant-positions-table">
          <thead><tr><th>标的</th><th>数量</th><th>开仓价</th><th>现价</th><th>盈亏</th></tr></thead>
          <tbody>${posRows}</tbody>
        </table>
      </div>

      <!-- Trade Log -->
      <div class="quant-log-section">
        <div class="quant-log-header">
          <span>交易日志</span>
          <button class="quant-log-clear" id="quant-log-clear">清空</button>
        </div>
        <div class="quant-log-list" id="quant-log-list">${logEntries}</div>
      </div>

      <!-- AI Analysis (collapsible placeholder) -->
      <div class="quant-ai-section">
        <div class="quant-ai-toggle" id="quant-ai-toggle">
          <span>🤖 AI 市场分析</span>
          <span class="toggle-arrow">▶</span>
        </div>
        <div class="quant-ai-body" id="quant-ai-body">
          <div class="quant-ai-prompt">
            <input type="text" id="quant-ai-input" placeholder="输入问题，如：当前趋势如何？" />
            <button id="quant-ai-send">发送</button>
          </div>
          <div class="quant-ai-response" id="quant-ai-response">
            AI 分析功能需配置 API Key（设置页 → AI 配置）
          </div>
        </div>
      </div>

      <!-- Disclaimer -->
      <div class="quant-disclaimer">
        ⚠️ 数据仅供参考，不构成投资建议。实盘风险自负。
      </div>
    </div>
  `;
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(panel, sym, data, signals, ma7, ma25) {
  // Symbol change
  const symSelect = panel.querySelector('#quant-symbol-select');
  if (symSelect) {
    symSelect.addEventListener('change', () => {
      QuantTrading._currentSymbol = symSelect.value;
      render();
    });
  }

  // Timeframe buttons
  panel.querySelectorAll('.quant-tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      QuantTrading._currentTF = btn.dataset.tf;
      render();
    });
  });

  // Strategy change
  const stratSelect = panel.querySelector('#quant-strategy-select');
  if (stratSelect) {
    stratSelect.addEventListener('change', () => {
      // Re-render with new strategy signals
      const newSignals = generateSignals(data.prices, data.ohlc, stratSelect.value);
      renderWithSignals(sym, data, newSignals);
    });
  }

  // Run button
  const runBtn = panel.querySelector('#quant-btn-run');
  if (runBtn) {
    runBtn.addEventListener('click', () => toggleRun(sym));
  }

  // Backtest button
  const btBtn = panel.querySelector('#quant-btn-backtest');
  if (btBtn) {
    btBtn.addEventListener('click', () => runBacktest(sym));
  }

  // Clear log
  const clearBtn = panel.querySelector('#quant-log-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      QuantTrading._tradeLog = [];
      const logEl = panel.querySelector('#quant-log-list');
      if (logEl) logEl.innerHTML = '<div class="quant-log-entry"><span class="qle-msg" style="color:var(--text-tertiary)">暂无交易记录</span></div>';
    });
  }

  // AI toggle
  const aiToggle = panel.querySelector('#quant-ai-toggle');
  if (aiToggle) {
    aiToggle.addEventListener('click', () => {
      const body = panel.querySelector('#quant-ai-body');
      const isOpen = body.classList.toggle('open');
      aiToggle.classList.toggle('open', isOpen);
    });
  }

  // AI send
  const aiSend = panel.querySelector('#quant-ai-send');
  const aiInput = panel.querySelector('#quant-ai-input');
  if (aiSend && aiInput) {
    const doAIChat = () => {
      const text = aiInput.value.trim();
      if (!text) return;
      const responseEl = panel.querySelector('#quant-ai-response');
      if (responseEl) responseEl.textContent = '正在思考...';
      aiInput.value = '';

      // Reuse chat-api.js if available
      if (Q.ChatAPI && Q.ChatAPI.sendMessage) {
        Q.ChatAPI.sendMessage({
          messages: [
            { role: 'system', content: '你是一个专业的量化交易分析师。用中文简洁回答，只说分析，不要免责声明。' },
            { role: 'user', content: `当前${sym.id}价格${data.currentPrice.toFixed(2)}，策略信号${signals.length}个。${text}` },
          ],
          onToken: (token) => {
            if (responseEl) responseEl.textContent += token;
          },
          onError: (err) => {
            if (responseEl) responseEl.textContent = 'AI 分析出错: ' + err.message;
          },
        });
        if (responseEl) responseEl.textContent = '';
      } else {
        if (responseEl) responseEl.textContent = '请先在设置页配置 AI API Key';
      }
    };
    aiSend.addEventListener('click', doAIChat);
    aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAIChat(); });
  }
}

/**
 * Re-render with different signals (preserves chart + price state).
 */
function renderWithSignals(sym, data, signals) {
  const panel = document.getElementById('rp-quant');
  if (!panel) return;
  const ma7 = computeMA(data.prices, 7);
  const ma25 = computeMA(data.prices, 25);

  cleanup();
  panel.innerHTML = buildPanelHTML(sym, data, signals);
  setupEventListeners(panel, sym, data, signals, ma7, ma25);
  setTimeout(() => createCharts(sym, data, signals, ma7, ma25), 50);
}

// ============================================================
// Run / Stop Strategy
// ============================================================

function toggleRun(sym) {
  QuantTrading._isRunning = !QuantTrading._isRunning;

  const panel = document.getElementById('rp-quant');
  if (!panel) return;

  const runBtn = panel.querySelector('#quant-btn-run');
  if (runBtn) {
    const indicator = runBtn.querySelector('.quant-indicator');
    if (QuantTrading._isRunning) {
      runBtn.innerHTML = '<span class="quant-indicator running"></span>运行中...';
      addLog('info', '策略启动，开始监控...');
      startAutoRefresh(sym);
    } else {
      runBtn.innerHTML = '<span class="quant-indicator stopped"></span>运行策略';
      if (QuantTrading._refreshTimer) {
        clearInterval(QuantTrading._refreshTimer);
        QuantTrading._refreshTimer = null;
      }
      addLog('info', '策略已停止');
    }
  }
}

async function startAutoRefresh(sym) {
  if (QuantTrading._refreshTimer) clearInterval(QuantTrading._refreshTimer);
  QuantTrading._refreshTimer = setInterval(async () => {
    if (!QuantTrading._isRunning) return;
    const data = await fetchMarketData(sym.id, QuantTrading._currentTF);
    const signals = await fetchStrategy(data.prices, data.ohlc, 'ma_cross');
    const ma7 = computeMA(data.prices, 7);
    const ma25 = computeMA(data.prices, 25);

    // Simulate a trade signal if present
    if (signals.length > 0) {
      const lastSig = signals[signals.length - 1];
      addLog(lastSig.type, lastSig.reason + ' @ ' + lastSig.price.toFixed(2));
    }

    updatePortfolio(sym, data.currentPrice);
    renderWithSignals(sym, data, signals);
  }, 5000);
}

// ============================================================
// Backtest Simulation
// ============================================================

async function runBacktest(sym) {
  const panel = document.getElementById('rp-quant');
  if (!panel) return;

  let data, signals;
  try {
    // Try backend first
    const res = await fetch(`${API_BASE}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sym.id,
        timeframe: '1d',
        strategy: 'ma_cross',
      }),
    });
    if (res.ok) {
      const json = await res.json();
      data = {
        currentPrice: json.results.totalPnl,
        prices: json.backtest.signals.map(s => s.price),
        labels: [],
        ohlc: [],
        volumes: [],
      };
      signals = json.backtest.signals;
      addLog('info', `回测完成: 胜率 ${(json.results.winRate * 100).toFixed(1)}%, 总收益 ${json.results.totalPnl.toFixed(2)}%`);
    } else {
      throw new Error('server error');
    }
  } catch (e) {
    // Fallback to local
    data = generateData(sym.basePrice, '1d', 200);
    signals = generateSignals(data.prices, data.ohlc, 'ma_cross');

    let wins = 0, losses = 0, totalPnl = 0;
    let lastTradeType = null, lastEntryPrice = null;

    signals.forEach(s => {
      if (s.type === 'buy') {
        lastTradeType = 'buy';
        lastEntryPrice = s.price;
      } else if (s.type === 'sell' && lastTradeType === 'buy' && lastEntryPrice) {
        const pnl = ((s.price - lastEntryPrice) / lastEntryPrice) * 100;
        totalPnl += pnl;
        if (pnl > 0) wins++; else losses++;
        lastTradeType = null;
        lastEntryPrice = null;
      }
    });

    const winRate = wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(1) : 'N/A';
    addLog('info', `回测完成(本地): 胜率 ${winRate}%, 总收益 ${totalPnl.toFixed(2)}%, 交易 ${wins + losses} 笔`);

    // Update portfolio card with backtest PnL
    const cards = panel.querySelectorAll('.quant-portfolio-card');
    if (cards.length >= 3) {
      const pnlEl = cards[2].querySelector('.qpc-value');
      if (pnlEl) {
        const pnlClass = totalPnl >= 0 ? 'up' : 'down';
        pnlEl.className = 'qpc-value ' + pnlClass;
        pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2) + '%';
      }
    }
  }

  // Force re-render to show log
  renderWithSignals(sym, data, signals);
}

// ============================================================
// Charts
// ============================================================

function createCharts(sym, data, signals, ma7, ma25) {
  const canvas = document.getElementById('quant-price-canvas');
  if (!canvas) return;

  if (Q.ChartCore && Q.ChartCore.Chart) {
    const upColor = '#22c55e';
    const downColor = '#ef4444';
    const maColor7 = '#6366f1';
    const maColor25 = '#f59e0b';

    // ── Price dataset: candlestick ──
    const datasets = [{
      label: sym.id,
      ohlc: data.ohlc,
      upColor,
      downColor,
    }];

    // ── MA overlay datasets ──
    datasets.push({
      label: 'MA7',
      data: ma7,
      color: maColor7,
      fillColor: 'transparent',
    });
    datasets.push({
      label: 'MA25',
      data: ma25,
      color: maColor25,
      fillColor: 'transparent',
    });

    const chart = new Q.ChartCore.Chart({
      canvas,
      type: 'candlestick',
      data: {
        labels: data.labels,
        datasets,
      },
      options: {
        animate: true,
        animationDuration: 500,
        showGrid: true,
        showAxis: true,
        showDots: false,
        showLegend: false,
        lineWidth: 1.2,
        yAxisTicks: 4,
        yAxisFormat: (v) => v.toFixed(0),
      },
    });

    QuantTrading._charts.push(chart);

    // Resize observer
    const wrap = document.getElementById('quant-chart-wrap');
    if (wrap && !QuantTrading._resizeObserver) {
      QuantTrading._resizeObserver = new ResizeObserver(() => {
        QuantTrading._charts.forEach(ch => {
          try { ch.resize(); } catch (e) { /* ignore */ }
        });
      });
      QuantTrading._resizeObserver.observe(wrap);
    }
  }
}

// ============================================================
// Module Registration — follow ESM pattern used in codebase
// ============================================================

// Expose on QCLI for debugging
Q.QuantTrading = QuantTrading;
Q.QuantTrading.init = init;
Q.QuantTrading.cleanup = cleanup;
Q.QuantTrading.render = render;

// Auto-init removed — standalone page (/quant.html) calls init()+render() explicitly
console.log('[QuantTrading] Module loaded (waiting for standalone page to call init())');

// Export for ESM import in main.js
export default QuantTrading;
