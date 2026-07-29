/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Quant — shared constants
//
// Trading symbol table, timeframe configuration and common HTTP
// headers used by the data-source fetchers. Shared by routes/quant/*.
// ============================================================

// ── Trading symbols (crypto + A-shares + HK + US) ──
const SYMBOLS = {
  // ── Crypto (via Binance) ──
  'BTC/USDT': { name: 'Bitcoin',        basePrice: 67580,  type: 'crypto',  emId: 'BTC' },
  'ETH/USDT': { name: 'Ethereum',       basePrice: 3450,   type: 'crypto',  emId: 'ETH' },
  'SOL/USDT': { name: 'Solana',         basePrice: 148,    type: 'crypto',  emId: 'SOL' },
  'BNB/USDT': { name: 'BNB',            basePrice: 595,    type: 'crypto',  emId: 'BNB' },
  'DOGE/USDT':{ name: 'Dogecoin',       basePrice: 0.12,   type: 'crypto',  emId: 'DOGE' },
  'XRP/USDT': { name: 'Ripple',         basePrice: 0.55,   type: 'crypto',  emId: 'XRP' },
  'ADA/USDT': { name: 'Cardano',        basePrice: 0.48,   type: 'crypto',  emId: 'ADA' },

  // ── A-shares 蓝筹 (via Tencent/Sina) ──
  '600519':   { name: '贵州茅台',        basePrice: 1480.00, type: 'a-share' },
  '000858':   { name: '五粮液',          basePrice: 135.60,  type: 'a-share' },
  '300750':   { name: '宁德时代',        basePrice: 210.50,  type: 'a-share' },
  '601318':   { name: '中国平安',        basePrice: 42.80,   type: 'a-share' },
  '000333':   { name: '美的集团',        basePrice: 68.90,   type: 'a-share' },
  '002415':   { name: '海康威视',        basePrice: 32.50,   type: 'a-share' },
  '600036':   { name: '招商银行',        basePrice: 34.50,   type: 'a-share' },
  '601166':   { name: '兴业银行',        basePrice: 17.80,   type: 'a-share' },

  // ── HK stocks (via Tencent/Sina) ──
  '00700.HK': { name: '腾讯控股',        basePrice: 388.00,  type: 'hk-stock' },
  '09988.HK': { name: '阿里巴巴',        basePrice: 82.50,   type: 'hk-stock' },
  '00941.HK': { name: '中国移动',        basePrice: 68.50,   type: 'hk-stock' },
  '03690.HK': { name: '美团-W',          basePrice: 118.00,  type: 'hk-stock' },

  // ── US stocks (via East Money) ──
  'AAPL':     { name: 'Apple',           basePrice: 198.50,  type: 'us-stock', emId: 'AAPL' },
  'MSFT':     { name: 'Microsoft',       basePrice: 425.30,  type: 'us-stock', emId: 'MSFT' },
  'TSLA':     { name: 'Tesla',           basePrice: 245.80,  type: 'us-stock', emId: 'TSLA' },
  'NVDA':     { name: 'NVIDIA',          basePrice: 880.20,  type: 'us-stock', emId: 'NVDA' },

  // ── Index ──
  '000300':   { name: '沪深300',          basePrice: 3890.50, type: 'index' },
};

// ── Timeframe configuration ──
const TF_CONFIG = {
  '5m':  { points: 78,  label: '5分钟' },
  '15m': { points: 80,  label: '15分钟' },
  '30m': { points: 80,  label: '30分钟' },
  '1h':  { points: 80,  label: '1小时' },
  '4h':  { points: 320, label: '4小时' },
  '1d':  { points: 120, label: '1天' },
};

// ── Browser-like headers (East Money) ──
const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

module.exports = { SYMBOLS, TF_CONFIG, EM_HEADERS };
