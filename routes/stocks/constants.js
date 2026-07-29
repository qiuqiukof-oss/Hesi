/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Stock & Fund Data — constants & shared cache
//
// Module-level cache, symbol mapping, headers, and the static
// stock list. Extracted from routes/stocks.js so the data-source
// layer (./sources) and the router (./routes) can share a single
// in-memory cache without duplicating state.
// ============================================================

// ── In-memory cache ──
const cache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

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

// ── Symbol mapping: internal ID → East Money secid format ──
// A股指数/SH: market=1  (e.g. 1.600519)
// 深证/SZ:    market=0  (e.g. 0.000001)
// 港股:       market=128 (e.g. 128.00700)
// 美股:       market=105 (e.g. 105.AAPL)
// 基金:       use 天天基金 fundgz API
function toSecId(id) {
  // A-shares (6-digit codes)
  if (/^\d{6}$/.test(id)) {
    const market = id.startsWith('6') ? 1 : 0; // 6xxxxx → SH(1), others → SZ(0)
    return `${market}.${id}`;
  }
  // HK stocks: 00700.HK → 128.00700
  if (id.endsWith('.HK')) {
    const code = id.replace('.HK', '');
    return `128.${code}`;
  }
  // CSI 300 index
  if (id === '000300') return '1.000300';
  // US stocks / ETFs (AAPL, SPY, QQQ, NVDA, etc.)
  return `105.${id}`;
}

// ── Browser-like headers for East Money API ──
const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

// ── Stock list ──
const STOCKS = [
  // US stocks
  { id: 'AAPL',     name: 'Apple Inc.',                     type: 'stock',    price: 198.50,  prevClose: 195.30 },
  { id: 'GOOGL',    name: 'Alphabet Inc.',                  type: 'stock',    price: 175.20,  prevClose: 173.80 },
  { id: 'MSFT',     name: 'Microsoft Corp.',                type: 'stock',    price: 425.30,  prevClose: 420.10 },
  { id: 'TSLA',     name: 'Tesla Inc.',                     type: 'stock',    price: 245.80,  prevClose: 250.20 },
  { id: 'AMZN',     name: 'Amazon.com Inc.',                type: 'stock',    price: 178.90,  prevClose: 176.50 },
  { id: 'NVDA',     name: 'NVIDIA Corp.',                   type: 'stock',    price: 880.20,  prevClose: 865.10 },
  { id: 'BABA',     name: 'Alibaba Group',                  type: 'stock',    price: 78.40,   prevClose: 79.90 },
  { id: 'TSM',      name: 'Taiwan Semiconductor',           type: 'stock',    price: 145.60,  prevClose: 143.20 },
  // Hong Kong stocks
  { id: '00700.HK', name: '腾讯控股 (Tencent)',              type: 'hk-stock', price: 388.00,  prevClose: 382.00 },
  { id: '9988.HK',  name: '阿里巴巴 (Alibaba)',              type: 'hk-stock', price: 82.50,   prevClose: 84.20 },
  // A-shares
  { id: '600519',   name: '贵州茅台',                        type: 'a-share',  price: 1480.00, prevClose: 1475.00 },
  { id: '000858',   name: '五粮液',                          type: 'a-share',  price: 135.60,  prevClose: 134.20 },
  { id: '300750',   name: '宁德时代',                        type: 'a-share',  price: 210.50,  prevClose: 208.30 },
  { id: '601318',   name: '中国平安',                        type: 'a-share',  price: 42.80,   prevClose: 43.10 },
  { id: '000333',   name: '美的集团',                        type: 'a-share',  price: 68.90,   prevClose: 69.50 },
  // Index
  { id: '000300',   name: '沪深300',                         type: 'index',    price: 3890.50, prevClose: 3870.20 },
  // ETFs
  { id: 'SPY',      name: 'SPDR S&P 500 ETF',               type: 'etf',      price: 518.30,  prevClose: 515.70 },
  { id: 'QQQ',      name: 'Invesco QQQ ETF',                type: 'etf',      price: 442.10,  prevClose: 438.50 },
  { id: '510050',   name: '上证50ETF',                      type: 'a-share',  price: 2.58,    prevClose: 2.56 },
  // Crypto
  { id: 'BTC',      name: 'Bitcoin',                        type: 'crypto',   price: 67580,   prevClose: 66200 },
  { id: 'ETH',      name: 'Ethereum',                       type: 'crypto',   price: 3450,    prevClose: 3520 },
  // Chinese Funds (公募基金)
  { id: 'FUND_110011', name: '易方达中小盘混合',            type: 'fund',     price: 5.23,    prevClose: 5.18 },
  { id: 'FUND_001632', name: '招商丰盛混合',               type: 'fund',     price: 2.15,    prevClose: 2.12 },
];

const RANGES = {
  '1D': { days: 1, interval: '5m',  points: 78,  klt: 5   },  // 5-min K-line
  '1W': { days: 5, interval: '30m', points: 65,  klt: 30  },  // 30-min K-line
  '1M': { days: 22, interval: '1d', points: 22,  klt: 101 },  // daily
  '3M': { days: 66, interval: '1d', points: 66,  klt: 101 },  // daily
  '1Y': { days: 252, interval: '1d', points: 252, klt: 101 }, // daily
};

module.exports = {
  cache,
  CACHE_TTL_MS,
  cacheGet,
  cacheSet,
  toSecId,
  EM_HEADERS,
  STOCKS,
  RANGES,
};
