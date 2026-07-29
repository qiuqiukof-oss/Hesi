/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Stock & Fund Data — data sources
//
// East Money (东方财富) + 天天基金 fetchers, plus the simulated
// random-walk fallback. All pure logic extracted from routes/stocks.js.
// Shared constants/cache come from ./constants.
// ============================================================
const { RANGES, EM_HEADERS, toSecId } = require('./constants');

/**
 * Determine if the stock id is a fund (starts with FUND_).
 */
function isFund(id) {
  return id.startsWith('FUND_');
}

/**
 * Strip FUND_ prefix to get the raw fund code.
 */
function fundCode(id) {
  return id.replace('FUND_', '');
}

/**
 * Fetch daily K-line (OHLCV) from East Money.
 * Returns null on failure.
 */
async function fetchEMChart(id, rangeKey) {
  const cfg = RANGES[rangeKey] || RANGES['1M'];
  const secid = toSecId(id);
  const klt = cfg.klt;
  const lmt = cfg.points;

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=${klt}&fqt=1` +
    `&end=20500101&lmt=${lmt}`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.data || !json.data.klines || json.data.klines.length === 0) {
      return null;
    }

    // Each kline: "date,open,close,high,low,volume,amount,amplitude,changePct,changeAmt,turnover"
    let quotes;
    try {
      quotes = json.data.klines.map(line => {
        const parts = line.split(',');
        return {
          date: parts[0],       // f51: "2024-01-15" or "09:35"
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseFloat(parts[5]) || 0,
          amount: parseFloat(parts[6]) || 0,
        };
      }).filter(q => !isNaN(q.open) && !isNaN(q.close));
    } catch (e) {
      console.warn(`[Stocks] Failed to parse kline data for ${id}: ${e.message}`);
      return null;
    }

    if (quotes.length === 0) return null;

    // For minute-level K-lines (1D, 1W), East Money returns "09:35" format dates
    // For daily K-lines (1M, 3M, 1Y), it returns "2024-01-15" format
    return {
      prices: quotes.map(q => Math.round(q.close * 100) / 100),
      volumes: quotes.map(q => Math.round(q.volume)),
      labels: quotes.map(q => {
        if (rangeKey === '1D') {
          // Intraday: time part only (e.g. "09:35")
          return q.date.includes('-') ? q.date.split(' ')[1] || q.date : q.date;
        }
        // Daily: MM/DD format for consistency with frontend
        if (q.date.includes('-')) {
          const parts = q.date.split('-');
          return `${parts[1]}/${parts[2]}`;
        }
        return q.date;
      }),
      ohlc: quotes.map(q => ({
        open: Math.round(q.open * 100) / 100,
        high: Math.round(q.high * 100) / 100,
        low: Math.round(q.low * 100) / 100,
        close: Math.round(q.close * 100) / 100,
      })),
    };
  } catch (err) {
    console.warn(`[Stocks] East Money fetch failed for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Price factor: East Money quote API returns prices multiplied by a factor.
 * A-shares/indices: 100 (分/元)
 * US/HK/others: 1000 (thousandths)
 */
function priceFactor(type) {
  if (type === 'a-share' || type === 'index') return 100;
  return 1000;
}

/**
 * Fetch real-time quote from East Money.
 * Returns { price, change, changePct } or null.
 */
async function fetchEMQuote(id, type) {
  const secid = toSecId(id);
  const factor = priceFactor(type);
  const url = `https://push2.eastmoney.com/api/qt/stock/get` +
    `?secid=${secid}` +
    `&fields=f43,f168,f169,f170,f57,f58`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.data || json.data.f43 == null) return null;

    const rawPrice = json.data.f43;
    const rawChange = json.data.f168 || 0;
    const price = rawPrice / factor;
    const change = rawChange / factor;
    const prevClose = price - change;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      price,
      change,
      changePct,
    };
  } catch (err) {
    console.warn(`[Stocks] East Money quote failed for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch real-time fund NAV from 天天基金.
 * Returns { price, change, changePct } or null.
 */
async function fetchFundNAV(id) {
  const code = fundCode(id);
  const url = `https://fundgz.1234567.com.cn/js/${code}.js`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': EM_HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/',
      },
    });
    if (!resp.ok) return null;
    const text = await resp.text();

    // Response: jsonpgz({...});
    const match = text.match(/\{.*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]);

    // gsz = estimated NAV (估算净值), dwjz = last confirmed NAV
    if (data.gsz != null) {
      return {
        price: parseFloat(data.gsz),
        change: data.gszzl != null ? parseFloat(data.gszzl) : 0,
        changePct: data.gszzl != null ? parseFloat(data.gszzl) : 0,
      };
    }
    return null;
  } catch (err) {
    console.warn(`[Stocks] Fund NAV fetch failed for ${code}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch fund historical NAV (daily) from 天天基金.
 * Returns chart format { prices, volumes, labels, ohlc } or null.
 */
async function fetchFundChart(id, rangeKey) {
  const code = fundCode(id);
  // 天天基金历史净值 API: returns JSON wrapped in jQuery(...)
  const url = `https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=1&pageSize=200&startDate=&endDate=`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': EM_HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/',
      },
    });
    if (!resp.ok) return null;
    const text = await resp.text();

    // Extract JSON from JSONP wrapper: jQuery({...});
    const match = text.match(/jQuery\((.*)\)/);
    if (!match) return null;
    let json;
    try {
      json = JSON.parse(match[1]);
    } catch (e) {
      console.warn(`[Stocks] Failed to parse fund JSONP for ${code}: ${e.message}`);
      return null;
    }
    const list = json?.Data?.LSJZList;
    if (!list || list.length === 0) return null;

    // LSJZList is in descending order (newest first).
    // Chart expects ascending (oldest first). Reverse to get ascending.
    const cfg = RANGES[rangeKey] || RANGES['1M'];
    const points = cfg.points;
    // Take the newest `points` entries, then reverse to ascending
    const rows = list.slice(0, points).reverse();

    const prices = [];
    const labels = [];
    const ohlc = [];
    const volumes = [];

    for (const row of rows) {
      const nav = parseFloat(row.DWJZ);
      if (isNaN(nav)) continue;

      prices.push(Math.round(nav * 100) / 100);
      ohlc.push({
        open: Math.round(nav * 100) / 100,
        high: Math.round(nav * 100) / 100,
        low: Math.round(nav * 100) / 100,
        close: Math.round(nav * 100) / 100,
      });
      volumes.push(0); // NAV changes don't have volume

      // Format date as MM/DD
      if (row.FSRQ) {
        const parts = row.FSRQ.split('-');
        labels.push(`${parts[1]}/${parts[2]}`);
      } else {
        labels.push('');
      }
    }

    if (prices.length === 0) return null;

    return { prices, volumes, labels, ohlc };
  } catch (err) {
    console.warn(`[Stocks] Fund history fetch failed for ${code}: ${err.message}`);
    return null;
  }
}

/**
 * Simulated data — fallback when API unavailable.
 */
function generateOHLCV(basePrice, rangeKey) {
  const config = RANGES[rangeKey] || RANGES['1M'];
  const points = config.points;

  let price = basePrice * (1 + (Math.random() - 0.5) * 0.04);
  const prices = [];
  const volumes = [];
  const labels = [];
  const ohlc = [];

  const vol = Math.max(basePrice * 0.015, 0.01);
  const now = Date.now();
  const isIntraday = rangeKey === '1D';

  for (let i = points - 1; i >= 0; i--) {
    const drift = (basePrice - price) * 0.008;
    const shock = (Math.random() - 0.5) * vol;
    price = Math.max(basePrice * 0.1, price + drift + shock);

    const open = price;
    const close = price + (Math.random() - 0.5) * vol * 0.3;
    const high = Math.max(open, close) + Math.random() * vol * 0.5;
    const low = Math.min(open, close) - Math.random() * vol * 0.5;
    const roundedClose = Math.round(close * 100) / 100;

    prices.push(roundedClose);
    ohlc.push({
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: roundedClose,
    });

    const baseVol = basePrice * 100000;
    const volFactor = 0.5 + Math.abs(shock / vol);
    volumes.push(Math.round(baseVol * volFactor * (0.5 + Math.random())));

    const d = new Date(now - i * (isIntraday ? 300000 : 86400000));
    if (isIntraday) {
      labels.push(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
    } else {
      labels.push(d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }));
    }
  }

  return { prices, volumes, labels, ohlc };
}

module.exports = {
  isFund,
  fundCode,
  fetchEMChart,
  priceFactor,
  fetchEMQuote,
  fetchFundNAV,
  fetchFundChart,
  generateOHLCV,
};
