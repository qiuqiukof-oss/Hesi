/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Quant — API router
//
// GET  /api/quant/market-data  — cached OHLCV (+ live price)
// POST /api/quant/strategy     — trading signal generation
// POST /api/quant/backtest     — historical backtest
// GET  /api/quant/price        — live price for a symbol
// GET  /api/quant/symbols      — list available symbols
//
// The page routes (/quant, /media) live in routes/quant.js so the
// entry file's __dirname resolves the project public/ directory.
// ============================================================
const express = require('express');

const { SYMBOLS, TF_CONFIG } = require('./constants');
const { fetchKline, fetchQuote } = require('./sources');
const { generateOHLCV, generateSignals, runBacktest } = require('./indicators');

// ── In-memory cache ──
const cache = new Map();
const CACHE_TTL_MS = 60_000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

/**
 * Create the quant trading router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // ── GET /api/quant/market-data — cached OHLCV ──
  router.get('/quant/market-data', async (req, res) => {
    try {
      const symbol = req.query.symbol || 'BTC/USDT';
      const timeframe = req.query.timeframe || req.query.tf || '1h';

      const sym = SYMBOLS[symbol];
      if (!sym) {
        return res.status(400).json({ success: false, error: `Unknown symbol: ${symbol}` });
      }

      if (!TF_CONFIG[timeframe]) {
        return res.status(400).json({ success: false, error: `Invalid timeframe: ${timeframe}. Use 5m, 15m, 30m, 1h, 4h, 1d` });
      }

      const cacheKey = `market:${symbol}:${timeframe}`;
      let data = cacheGet(cacheKey);
      let dataSource;

      if (!data) {
        // Try real data source based on symbol type
        data = await fetchKline(symbol, sym.type, timeframe);
        if (data) {
          dataSource = (sym.type === 'crypto') ? 'binance' :
                       (sym.type === 'a-share' || sym.type === 'hk-stock' || sym.type === 'index') ? 'tencent' :
                       'eastmoney';
          cacheSet(cacheKey, data);
        }
      } else {
        dataSource = 'cached';
      }

      // Fallback to simulated
      if (!data) {
        data = generateOHLCV(sym.basePrice, timeframe);
        dataSource = 'simulated';
        cacheSet(cacheKey, data);
      }

      // Try to fetch live price
      let livePrice = null;
      try {
        const quote = await fetchQuote(symbol, sym.type);
        if (quote && quote.price != null && quote.price > 0) {
          livePrice = quote;
        }
      } catch (e) { /* best-effort quote fetch */ }

      // Compute basic stats
      const isUp = data.prices.length >= 2 && data.prices[data.prices.length - 1] >= data.prices[0];
      const change = data.prices.length >= 2
        ? Math.round((data.prices[data.prices.length - 1] - data.prices[0]) * 100) / 100
        : 0;
      const changePct = data.prices.length >= 2 && data.prices[0] > 0
        ? Math.round((change / data.prices[0]) * 10000) / 100
        : 0;

      res.json({
        success: true,
        symbol,
        timeframe,
        data: {
          prices: data.prices,
          volumes: data.volumes,
          labels: data.labels,
          ohlc: data.ohlc,
          currentPrice: livePrice?.price || data.currentPrice,
        },
        stats: {
          open: data.ohlc[0]?.open || 0,
          close: livePrice?.price || data.currentPrice,
          high: Math.max(...data.prices),
          low: Math.min(...data.prices),
          change,
          changePct,
          isUp,
        },
        dataSource,
        livePrice: livePrice ? {
          price: livePrice.price,
          change: livePrice.change,
          changePct: livePrice.changePct,
        } : null,
      });
    } catch (err) {
      console.error('[Quant] market-data error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/quant/strategy — generate trading signals ──
  router.post('/quant/strategy', (req, res) => {
    try {
      const { symbol, timeframe, strategy, params, market_data } = req.body;

      if (!market_data || !market_data.ohlc || market_data.ohlc.length === 0) {
        return res.status(400).json({ success: false, error: 'market_data.ohlc is required' });
      }

      const prices = market_data.prices || market_data.ohlc.map(o => o.close);
      const ohlc = market_data.ohlc;
      const strategyId = strategy || 'ma_cross';

      const result = generateSignals(prices, ohlc, strategyId, params || {});

      res.json({
        success: true,
        symbol,
        timeframe,
        strategy: strategyId,
        signals: result.signals,
        indicators: result.indicators,
        metrics: {
          total_signals: result.signals.length,
          buy_signals: result.signals.filter(s => s.type === 'buy').length,
          sell_signals: result.signals.filter(s => s.type === 'sell').length,
          avg_confidence: result.signals.length > 0
            ? Math.round((result.signals.reduce((a, s) => a + s.confidence, 0) / result.signals.length) * 100) / 100
            : 0,
        },
      });
    } catch (err) {
      console.error('[Quant] strategy error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/quant/backtest — run historical backtest ──
  router.post('/quant/backtest', (req, res) => {
    try {
      const { symbol, timeframe, strategy, params, market_data } = req.body;

      if (!market_data || !market_data.ohlc || market_data.ohlc.length === 0) {
        return res.status(400).json({ success: false, error: 'market_data.ohlc is required' });
      }

      const prices = market_data.prices || market_data.ohlc.map(o => o.close);
      const ohlc = market_data.ohlc;
      const strategyId = strategy || 'ma_cross';

      const result = runBacktest(prices, ohlc, strategyId, params || {});

      res.json({
        success: true,
        symbol,
        timeframe,
        strategy: strategyId,
        ...result,
      });
    } catch (err) {
      console.error('[Quant] backtest error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/quant/price — live price for a symbol ──
  router.get('/quant/price', async (req, res) => {
    try {
      const symbol = req.query.symbol || 'BTC/USDT';
      const sym = SYMBOLS[symbol];
      if (!sym) {
        return res.status(400).json({ success: false, error: `Unknown symbol: ${symbol}` });
      }

      const quote = await fetchQuote(symbol, sym.type);
      if (!quote || !quote.price) {
        return res.json({ success: false, error: 'Unable to fetch live price' });
      }

      res.json({
        success: true,
        symbol,
        price: quote.price,
        change: quote.change || 0,
        changePct: quote.changePct || 0,
        isUp: (quote.change || 0) >= 0,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error('[Quant] price error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/quant/symbols — list available trading symbols ──
  router.get('/quant/symbols', (req, res) => {
    const list = Object.entries(SYMBOLS).map(([id, info]) => ({
      id,
      name: info.name,
      basePrice: info.basePrice,
      type: info.type,
    }));
    res.json({ success: true, symbols: list });
  });

  return router;
}

module.exports = { createRouter };
