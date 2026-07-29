/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Quant — data formatting, simulation & strategy engine
//
// formatOHLCV / generateOHLCV (data prep & fallback simulation),
// plus the indicator math (MA / RSI / EMA), signal generator and
// backtest engine used by the /quant/strategy and /quant/backtest
// endpoints.
// ============================================================
const { TF_CONFIG } = require('./constants');

// ════════════════════════════════════════════════════════════
// 6. Format OHLCV (shared)
// ════════════════════════════════════════════════════════════

/**
 * Format OHLCV quotes into chart-friendly structure.
 * @param {Array<{date:string, open:number, close:number, high:number, low:number, volume:number}>} quotes
 * @param {string} tfKey - Timeframe key (5m, 15m, etc.)
 * @returns {{prices:number[], volumes:number[], labels:string[], ohlc:Array<{open:number, high:number, low:number, close:number}>, currentPrice:number}}
 */
function formatOHLCV(quotes, tfKey) {
  const prices = quotes.map(q => Math.round(q.close * 100) / 100);
  const volumes = quotes.map(q => Math.round(q.volume));
  const labels = quotes.map(q => {
    // Tencent daily: "2025-05-20" → "05/20"
    // Tencent minute: "202505201030" → "10:30"
    // Binance ISO: "2025-05-20T10:30:00.000Z" → "10:30"
    // East Money daily: "2024-01-15"
    // East Money minute: "09:35"

    const d = q.date;
    if (!d) return '';

    // Binance ISO format
    if (d.includes('T')) {
      if (tfKey === '1d') {
        const parts = d.split('T')[0].split('-');
        return `${parts[1]}/${parts[2]}`;
      }
      return d.split('T')[1]?.substring(0, 5) || d;
    }

    // Standard date format YYYY-MM-DD
    if (d.includes('-') && d.length >= 10) {
      if (tfKey === '1d' || tfKey === 'week') {
        const parts = d.split('-');
        return `${parts[1]}/${parts[2]}`;
      }
      // If it also has time: "2024-01-15 09:35"
      if (d.includes(' ')) {
        return d.split(' ')[1].substring(0, 5);
      }
      return d;
    }

    // Tencent minute: "202505201030" → "10:30"
    if (/^\d{12}$/.test(d)) {
      return `${d.substring(8,10)}:${d.substring(10,12)}`;
    }

    // Short time format: "09:35"
    if (d.includes(':')) return d;

    return d;
  });
  const ohlc = quotes.map(q => ({
    open: Math.round(q.open * 100) / 100,
    high: Math.round(q.high * 100) / 100,
    low: Math.round(q.low * 100) / 100,
    close: Math.round(q.close * 100) / 100,
  }));

  const currentPrice = prices[prices.length - 1];

  return { prices, volumes, labels, ohlc, currentPrice };
}

// ════════════════════════════════════════════════════════════
// 7. Simulated Data Generator (fallback)
// ════════════════════════════════════════════════════════════

function generateOHLCV(basePrice, tfKey) {
  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];
  const points = cfg.points;
  let price = basePrice * (1 + (Math.random() - 0.5) * 0.06);
  const prices = [];
  const volumes = [];
  const labels = [];
  const ohlc = [];

  const vol = Math.max(basePrice * 0.015, 0.01);
  const now = Date.now();
  const intervalMs = tfKey === '5m' ? 300000 : tfKey === '15m' ? 900000 : tfKey === '30m' ? 1800000 : tfKey === '1h' ? 3600000 : tfKey === '4h' ? 14400000 : 86400000;

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
    volumes.push(Math.round(basePrice * 5000 + Math.random() * basePrice * 10000));

    const ts = new Date(now - i * intervalMs);
    if (tfKey === '1d') {
      labels.push(`${ts.getMonth() + 1  }/${  ts.getDate()}`);
    } else {
      labels.push(`${ts.getHours().toString().padStart(2, '0')  }:${  ts.getMinutes().toString().padStart(2, '0')}`);
    }
  }

  return { prices, volumes, labels, ohlc, currentPrice: price };
}

// ════════════════════════════════════════════════════════════
// 8. Strategy Engine
// ════════════════════════════════════════════════════════════

/**
 * Compute Simple Moving Average.
 * @param {number[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
function computeMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result.push(Math.round((sum / period) * 100) / 100);
  }
  return result;
}

/**
 * Compute Relative Strength Index.
 * @param {Array<{close:number}>} ohlc
 * @param {number} [period=14]
 * @returns {(number|null)[]}
 */
function computeRSI(ohlc, period) {
  period = period || 14;
  const closes = ohlc.map(o => o.close);
  const result = [];
  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    result.push(avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10);
  }
  return result;
}

/**
 * Compute Exponential Moving Average.
 * @param {(number|null)[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
function computeEMA(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let ema = null;

  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - period + 1); j <= i; j++) {
        if (data[j] != null) { sum += data[j]; count++; }
      }
      ema = sum / count;
    } else {
      ema = (data[i] - ema) * multiplier + ema;
    }
    result.push(Math.round(ema * 100) / 100);
  }
  return result;
}

function generateSignals(prices, ohlc, strategyId, params) {
  params = params || {};
  const signals = [];

  if (strategyId === 'ma_cross') {
    const fastPeriod = params.fast_ma || 7;
    const slowPeriod = params.slow_ma || 25;
    const maFast = computeMA(prices, fastPeriod);
    const maSlow = computeMA(prices, slowPeriod);

    for (let i = 1; i < prices.length; i++) {
      if (maFast[i] == null || maSlow[i] == null || maFast[i - 1] == null || maSlow[i - 1] == null) continue;
      if (maFast[i - 1] <= maSlow[i - 1] && maFast[i] > maSlow[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.75, reason: `MA${fastPeriod} 上穿 MA${slowPeriod}` });
      }
      if (maFast[i - 1] >= maSlow[i - 1] && maFast[i] < maSlow[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.75, reason: `MA${fastPeriod} 下穿 MA${slowPeriod}` });
      }
    }
    return { signals, indicators: { maFast, maSlow } };
  }

  if (strategyId === 'rsi') {
    const period = params.rsi_period || 14;
    const oversold = params.oversold || 30;
    const overbought = params.overbought || 70;
    const rsi = computeRSI(ohlc, period);

    for (let i = 1; i < rsi.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      if (rsi[i - 1] >= oversold && rsi[i] < oversold) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.65, reason: `RSI 超卖 (${rsi[i]})` });
      }
      if (rsi[i - 1] <= overbought && rsi[i] > overbought) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.65, reason: `RSI 超买 (${rsi[i]})` });
      }
    }
    return { signals, indicators: { rsi } };
  }

  if (strategyId === 'macd') {
    const fastPeriod = params.macd_fast || 12;
    const slowPeriod = params.macd_slow || 26;
    const signalPeriod = params.macd_signal || 9;
    const emaFast = computeEMA(prices, fastPeriod);
    const emaSlow = computeEMA(prices, slowPeriod);
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
      macdLine.push(emaFast[i] != null && emaSlow[i] != null
        ? Math.round((emaFast[i] - emaSlow[i]) * 100) / 100
        : null);
    }
    const signalLine = computeEMA(macdLine.map(v => v != null ? v : 0), signalPeriod);
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null) signalLine[i] = null;
    }

    for (let i = 1; i < macdLine.length; i++) {
      if (macdLine[i] == null || signalLine[i] == null || macdLine[i - 1] == null || signalLine[i - 1] == null) continue;
      if (macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.70, reason: 'MACD 金叉' });
      }
      if (macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.70, reason: 'MACD 死叉' });
      }
    }
    return { signals, indicators: { macd: macdLine, signal: signalLine } };
  }

  return { signals: [], indicators: {} };
}

// ════════════════════════════════════════════════════════════
// 9. Backtest Engine
// ════════════════════════════════════════════════════════════

function runBacktest(prices, ohlc, strategyId, params) {
  const { signals } = generateSignals(prices, ohlc, strategyId, params);
  let wins = 0, losses = 0;
  let totalReturn = 0;
  let maxDrawdown = 0;
  let peak = 1;
  let inPosition = false;
  let entryPrice = 0;
  const trades = [];

  for (const sig of signals) {
    if (sig.type === 'buy' && !inPosition) {
      inPosition = true;
      entryPrice = sig.price;
    } else if (sig.type === 'sell' && inPosition) {
      inPosition = false;
      const pnl = ((sig.price - entryPrice) / entryPrice) * 100;
      totalReturn += pnl;
      if (pnl > 0) wins++; else losses++;
      trades.push({ time: sig.index, type: 'sell', entry: entryPrice, exit: sig.price, pnl: Math.round(pnl * 100) / 100 });
      const equity = 1 + totalReturn / 100;
      if (equity > peak) peak = equity;
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  if (inPosition) {
    const lastPrice = prices[prices.length - 1];
    const pnl = ((lastPrice - entryPrice) / entryPrice) * 100;
    totalReturn += pnl;
    if (pnl > 0) wins++; else losses++;
    trades.push({ time: prices.length - 1, type: 'close', entry: entryPrice, exit: lastPrice, pnl: Math.round(pnl * 100) / 100 });
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;
  const sharpe = totalTrades > 0 && totalReturn !== 0
    ? Math.round((totalReturn / totalTrades) * 100) / 100
    : 0;

  return {
    total_trades: totalTrades,
    win_rate: winRate,
    total_return: Math.round(totalReturn * 100) / 100,
    max_drawdown: Math.round(maxDrawdown * 100) / 100,
    sharpe_ratio: sharpe,
    trades,
  };
}

module.exports = {
  formatOHLCV,
  generateOHLCV,
  computeMA,
  computeRSI,
  computeEMA,
  generateSignals,
  runBacktest,
};
