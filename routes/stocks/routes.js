/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Stock & Fund Data — API router
//
// GET /api/stocks         — list all available stocks
// GET /api/stocks/hot     — hot leaders from East Money
// GET /api/stocks/:id     — detail + chart data for a range
// GET /api/stocks/:id/price — current price only (ticker updates)
//
// Shared state (cache, constants) lives in ./constants; data
// fetchers/simulation in ./sources.
// ============================================================
const express = require('express');

const { STOCKS, RANGES, EM_HEADERS, cacheGet, cacheSet } = require('./constants');
const { isFund, fetchEMChart, fetchFundChart, generateOHLCV, fetchFundNAV, fetchEMQuote } = require('./sources');

/**
 * Create the stocks router.
 * @returns {express.Router}
 */
function createRouter() {
  const router = express.Router();

  // GET /api/stocks — list all available stocks
  router.get('/stocks', (req, res) => {
    res.json({
      success: true,
      stocks: STOCKS,
    });
  });

  // GET /api/stocks/hot — 热门股票（必须放在 :id 前）
  router.get('/stocks/hot', async (req, res) => {
    try {
      const url = 'https://push2.eastmoney.com/api/qt/clist/get' +
        '?np=1&pn=1&pz=15&po=1' +
        '&fs=m:0+t:6,m:1+t:2,m:0+t:7,m:0+t:8' +
        '&fields=f12,f14,f2,f3,f4,f5,f6,f7,f8,f15,f16,f17,f18' +
        '&fid=f6';

      const resp = await fetch(url, { headers: EM_HEADERS });
      if (!resp.ok) {
        return res.json({ success: false, error: 'East Money API error' });
      }
      const json = await resp.json();
      const raw = json?.data?.diff || [];

      const leaders = raw
        .filter(s => s.f14 && !s.f14.includes('退') && (s.f2 || 0) > 0)
        .slice(0, 10)
        .map(s => ({
          code: s.f12,
          name: s.f14,
          price: Math.round((s.f2 || 0) / 100 * 100) / 100,
          changePct: Math.round((s.f3 || 0) / 100 * 100) / 100,
          change: Math.round((s.f4 || 0) / 100 * 100) / 100,
          volume: s.f5 || 0,
          amount: s.f6 || 0,
          high: Math.round((s.f15 || 0) / 100 * 100) / 100,
          low: Math.round((s.f16 || 0) / 100 * 100) / 100,
          amplitude: Math.round((s.f7 || 0) / 100 * 100) / 100,
          turnover: Math.round((s.f8 || 0) / 100 * 100) / 100,
        }));

      res.json({ success: true, leaders });
    } catch (err) {
      console.warn(`[Stocks] Hot stocks fetch failed: ${err.message}`);
      res.json({ success: false, error: err.message });
    }
  });

  // GET /api/stocks/:id — get stock detail + chart data for given range
  // Query: range=1D|1W|1M|3M|1Y (default: 1M)
  router.get('/stocks/:id', async (req, res) => {
    const stock = STOCKS.find(s => s.id === req.params.id);
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    const range = (req.query.range || '1M').toUpperCase();
    if (!RANGES[range]) {
      return res.status(400).json({ success: false, error: `Invalid range: ${range}. Use 1D, 1W, 1M, 3M, or 1Y` });
    }

    // Try cache first
    const cacheKey = `${stock.id}:${range}`;
    let data = cacheGet(cacheKey);
    let dataSource;

    if (!data) {
      if (isFund(stock.id)) {
        // Funds: real NAV history from 天天基金, simulated fallback
        data = await fetchFundChart(stock.id, range);
        if (data) {
          cacheSet(cacheKey, data);
          dataSource = 'eastmoney';
        } else {
          data = generateOHLCV(stock.price, range);
          dataSource = 'simulated';
        }
      } else {
        // Try East Money
        data = await fetchEMChart(stock.id, range);
        if (data) {
          cacheSet(cacheKey, data);
          dataSource = 'eastmoney';
        } else {
          // Last resort: simulated
          data = generateOHLCV(stock.price, range);
          dataSource = 'simulated';
        }
      }
    } else {
      dataSource = 'eastmoney';
    }

    // Fetch current price
    let currentPrice = stock.price;
    let currentPrevClose = stock.prevClose;

    if (isFund(stock.id)) {
      const nav = await fetchFundNAV(stock.id);
      if (nav && nav.price != null) {
        currentPrice = Math.round(nav.price * 100) / 100;
        currentPrevClose = currentPrice - (nav.change || 0);
        currentPrevClose = Math.round(currentPrevClose * 100) / 100;
      }
    } else {
      const quote = await fetchEMQuote(stock.id, stock.type);
      if (quote && quote.price != null) {
        currentPrice = Math.round(quote.price * 100) / 100;
        currentPrevClose = currentPrice - (quote.change || 0);
        currentPrevClose = Math.round(currentPrevClose * 100) / 100;
      }
    }

    // Calculate stats from data
    const firstPrice = data.prices[0];
    const lastPrice = data.prices[data.prices.length - 1];
    const change = lastPrice - firstPrice;
    const changePct = (change / firstPrice) * 100;

    res.json({
      success: true,
      stock: {
        id: stock.id,
        name: stock.name,
        type: stock.type,
        price: currentPrice,
        prevClose: currentPrevClose,
      },
      range,
      data: {
        prices: data.prices,
        volumes: data.volumes,
        labels: data.labels,
        ohlc: data.ohlc,
      },
      stats: {
        open: firstPrice,
        close: lastPrice,
        high: Math.max(...data.prices),
        low: Math.min(...data.prices),
        change,
        changePct,
        isUp: change >= 0,
        volume: data.volumes.reduce((a, b) => a + b, 0),
        points: data.prices.length,
      },
      dataSource,
    });
  });

  // GET /api/stocks/:id/price — get current price only (for ticker updates)
  router.get('/stocks/:id/price', async (req, res) => {
    const stock = STOCKS.find(s => s.id === req.params.id);
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    let newPrice = stock.price;
    let changeAmount = 0;
    let changePercent = 0;

    if (isFund(stock.id)) {
      const nav = await fetchFundNAV(stock.id);
      if (nav && nav.price != null) {
        newPrice = Math.round(nav.price * 100) / 100;
        changeAmount = Math.round((nav.change || 0) * 100) / 100;
        changePercent = Math.round((nav.changePct || 0) * 100) / 100;
      } else {
        // Simulate small movement
        const volatility = stock.price * 0.002;
        changeAmount = Math.round(((Math.random() - 0.5) * volatility) * 100) / 100;
        newPrice = Math.round((stock.price + changeAmount) * 100) / 100;
        changePercent = Math.round((changeAmount / stock.price) * 10000) / 100;
      }
    } else {
      const quote = await fetchEMQuote(stock.id, stock.type);
      if (quote && quote.price != null) {
        newPrice = Math.round(quote.price * 100) / 100;
        changeAmount = Math.round((quote.change || 0) * 100) / 100;
        changePercent = Math.round((quote.changePct || 0) * 100) / 100;
      } else {
        // Simulate small movement
        const volatility = stock.price * 0.002;
        changeAmount = Math.round(((Math.random() - 0.5) * volatility) * 100) / 100;
        newPrice = Math.round((stock.price + changeAmount) * 100) / 100;
        changePercent = Math.round((changeAmount / stock.price) * 10000) / 100;
      }
    }

    res.json({
      success: true,
      price: newPrice,
      change: changeAmount,
      changePct: changePercent,
      isUp: changeAmount >= 0,
      updatedAt: Date.now(),
    });
  });

  return router;
}

module.exports = { createRouter };
