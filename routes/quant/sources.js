// @ts-check
// ============================================================
// Quant — real data sources
//
// Fetchers for Tencent / Sina / East Money / Binance plus the
// per-type data-source router (fetchKline / fetchQuote). All I/O
// is best-effort: on any failure they return null and the caller
// falls back to simulated data.
// ============================================================
const { EM_HEADERS, TF_CONFIG } = require('./constants');
const { formatOHLCV } = require('./indicators');

// ════════════════════════════════════════════════════════════
// 1. 腾讯财经 — K线数据（A股/港股）
// ════════════════════════════════════════════════════════════

/**
 * Convert internal symbol ID to Tencent finance code.
 * 600519 → sh600519, 000001 → sz000001, 00700.HK → hk00700
 */
function toTencentCode(symbolId) {
  if (/^\d{6}$/.test(symbolId)) {
    return (symbolId.startsWith('6') ? 'sh' : 'sz') + symbolId;
  }
  if (symbolId.endsWith('.HK')) {
    return `hk${  symbolId.replace('.HK', '')}`;
  }
  return null;
}

/**
 * Fetch K-line from Tencent Finance API.
 * Daily: web.ifzq.gtimg.cn/appstock/app/fqkline/get
 * Minute: ifzq.gtimg.cn/appstock/app/kline/mkline
 */
async function fetchTencentKline(symbolId, tfKey) {
  const tencentCode = toTencentCode(symbolId);
  if (!tencentCode) return null;

  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];
  const points = cfg.points;

  const TENCENT_MINUTE = { '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'm60', '4h': 'm60' };

  try {
    let url;
    if (tfKey === '1d') {
      // Daily K-line (前复权)
      url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,${Math.min(points, 640)},qfq`;
    } else {
      // Minute K-line
      const minInterval = TENCENT_MINUTE[tfKey] || 'm60';
      url = `http://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${tencentCode},${minInterval},,${Math.min(points, 640)}`;
    }

    const resp = await fetch(url, {
      headers: { 'Referer': 'http://finance.qq.com/' },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;

    const text = await resp.text();

    // Extract JSON from JSONP (wrapped in _var=... or just {...})
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let json;
    try {
      json = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn(`[Quant] Failed to parse Tencent JSONP for ${symbolId}: ${e.message}`);
      return null;
    }

    if (!json.data || !json.data[tencentCode]) return null;
    const stockData = json.data[tencentCode];

    // Get K-line array
    let klines;
    if (tfKey === '1d') {
      // Daily data lives under qfqday key
      klines = stockData.qfqday || stockData.day;
    } else {
      // Minute data — find the m-key
      const minuteKey = Object.keys(stockData).find(k => k.startsWith('m'));
      klines = minuteKey ? stockData[minuteKey] : null;
    }

    if (!klines || !Array.isArray(klines) || klines.length === 0) return null;

    // Tencent K-line format: [date, open, close, high, low, volume]
    // Daily: ["2025-05-20", open, close, high, low, volume]
    // Minute: ["202505201030", open, close, high, low, volume]
    const raw = klines.map(k => {
      const date = String(k[0]);
      const open = parseFloat(k[1]);
      const close = parseFloat(k[2]);
      const high = parseFloat(k[3]);
      const low = parseFloat(k[4]);
      const volume = parseFloat(k[5]) || 0;
      return { date, open, close, high, low, volume };
    }).filter(q => !isNaN(q.open) && !isNaN(q.close));

    if (raw.length === 0) return null;

    // Reverse to ascending order (Tencent returns newest first)
    raw.reverse();

    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] Tencent K-line failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch real-time quote from Tencent Finance.
 * Returns { price, change, changePct } or null.
 */
async function fetchTencentQuote(symbolId) {
  const tencentCode = toTencentCode(symbolId);
  if (!tencentCode) return null;

  try {
    const resp = await fetch(`http://qt.gtimg.cn/q=${tencentCode}`, {
      headers: { 'Referer': 'http://finance.qq.com/' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    const text = await resp.text();

    // Format: v_sh600519="fields~separated~by~tilde~...";
    const match = text.match(/"([\s\S]*?)"/);
    if (!match) return null;

    const fields = match[1].split('~');
    // Fields: 0=market, 1=name, 2=code, 3=current, 4=prevClose, 5=open, 6=volume,
    //         7=buy_vol, 8=sell_vol, 30=update_time, 32=change%
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);

    if (isNaN(price) || isNaN(prevClose)) return null;

    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, change, changePct };
  } catch (err) {
    console.warn(`[Quant] Tencent quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 2. 新浪财经 — 实时行情（A股/港股备用）
// ════════════════════════════════════════════════════════════

/**
 * Convert internal symbol ID to Sina finance code.
 * 600519 → sh600519, 000001 → sz000001, 00700.HK → hk00700, AAPL → gb_aapl
 */
function toSinaCode(symbolId, type) {
  if (/^\d{6}$/.test(symbolId)) {
    return (symbolId.startsWith('6') ? 'sh' : 'sz') + symbolId;
  }
  if (symbolId.endsWith('.HK')) {
    return `hk${  symbolId.replace('.HK', '')}`;
  }
  if (type === 'us-stock') {
    return `gb_${  symbolId.toLowerCase()}`;
  }
  return null;
}

/**
 * Fetch real-time quote from Sina Finance.
 * Returns { price, prevClose, change, changePct } or null.
 */
async function fetchSinaQuote(symbolId, type) {
  const sinaCode = toSinaCode(symbolId, type);
  if (!sinaCode) return null;

  try {
    const resp = await fetch(`http://hq.sinajs.cn/list=${sinaCode}`, {
      headers: {
        'Referer': 'http://finance.sina.com.cn/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    // Sina returns GBK encoded text. For price data, we can still extract numbers.
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);

    // Format: var hq_str_sh600519="name,open,prevClose,current,high,low,...";
    const match = text.match(/"([\s\S]*?)"/);
    if (!match) return null;

    const fields = match[1].split(',');
    // Fields: 0=name, 1=open, 2=prevClose, 3=current price, 4=high, 5=low,
    //         6=buy, 7=sell, 8=volume, 9=amount

    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[2]);

    if (isNaN(price) || isNaN(prevClose)) return null;

    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, prevClose, change, changePct };
  } catch (err) {
    console.warn(`[Quant] Sina quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 3. 东方财富 — K线数据（美股/基金备用）
// ════════════════════════════════════════════════════════════

const EM_MARKET = {
  'a-share':  (id) => id.startsWith('6') ? `1.${id}` : `0.${id}`,
  'hk-stock': (id) => `128.${id.replace('.HK', '')}`,
  'us-stock': (id) => `105.${id}`,
  'index':    (id) => id === '000300' ? '1.000300' : `1.${id}`,
};

function toEMSecId(symbolId, type) {
  const mapper = EM_MARKET[type];
  return mapper ? mapper(symbolId) : `105.${symbolId}`;
}

async function fetchEMKline(symbolId, type, tfKey) {
  const secid = toEMSecId(symbolId, type || 'us-stock');
  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];

  // Map internal timeframe to East Money klt
  const KLT_MAP = {
    '5m':  5,
    '15m': 15,
    '30m': 30,
    '1h':  60,
    '4h':  60,
    '1d':  101,
  };
  const klt = KLT_MAP[tfKey] || 60;
  const lmt = cfg.points;

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=${klt}&fqt=1` +
    `&end=20500101&lmt=${lmt}`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.data?.klines?.length) return null;

    // East Money price factor:
    // A-shares/index: ×100 (fen)
    // US/crypto/HK: ×1000 (thousandths)
    const priceDiv = (type === 'a-share' || type === 'index') ? 100 :
                     (type === 'us-stock' || type === 'crypto' || type === 'hk-stock') ? 1000 : 1;

    const raw = json.data.klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]) / priceDiv,
        close: parseFloat(parts[2]) / priceDiv,
        high: parseFloat(parts[3]) / priceDiv,
        low: parseFloat(parts[4]) / priceDiv,
        volume: parseFloat(parts[5]) || 0,
      };
    }).filter(q => !isNaN(q.open) && !isNaN(q.close) && q.open > 0);

    if (raw.length === 0) return null;
    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] East Money K-line failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

async function fetchEMQuote(symbolId, type) {
  const secid = toEMSecId(symbolId, type || 'us-stock');
  // East Money quote factor:
  // A-shares/index: ×100; US/crypto/HK: ×1000
  const priceDiv = (type === 'a-share' || type === 'index') ? 100 : 1000;

  const url = `https://push2.eastmoney.com/api/qt/stock/get` +
    `?secid=${secid}&fields=f43,f168,f169,f170,f57,f58`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.data || json.data.f43 == null) return null;

    const rawPrice = json.data.f43;
    const rawChange = json.data.f168 || 0;
    const price = rawPrice / priceDiv;
    const change = rawChange / priceDiv;
    const prevClose = price - change;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, change, changePct };
  } catch (err) {
    console.warn(`[Quant] East Money quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 4. Binance — 加密货币数据
// ════════════════════════════════════════════════════════════

const BINANCE_INTERVAL = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };

async function fetchBinanceKline(symbol, tfKey) {
  const interval = BINANCE_INTERVAL[tfKey];
  if (!interval) return null;

  const binanceSymbol = symbol.replace('/', '').toUpperCase();
  const lmt = TF_CONFIG[tfKey]?.points || 80;
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${lmt}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    const raw = json.map(k => ({
      date: new Date(k[0]).toISOString(),
      open: parseFloat(k[1]),
      close: parseFloat(k[4]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      volume: parseFloat(k[5]),
    })).filter(q => !isNaN(q.open) && !isNaN(q.close) && q.open > 0);

    if (raw.length === 0) return null;
    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] Binance K-line failed for ${binanceSymbol}: ${err.message}`);
    return null;
  }
}

async function fetchBinancePrice(symbol) {
  const binanceSymbol = symbol.replace('/', '').toUpperCase();
  try {
    const resp = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    const price = parseFloat(json.price);
    if (isNaN(price)) return null;
    return { price, change: 0, changePct: 0 };
  } catch (err) {
    console.warn(`[Quant] Binance price failed for ${binanceSymbol}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 5. Data Source Router
// ════════════════════════════════════════════════════════════

/**
 * Choose data source based on symbol type and fetch K-line.
 */
async function fetchKline(symbolId, type, tfKey) {
  switch (type) {
    case 'crypto':
      // Crypto → Binance only
      return await fetchBinanceKline(symbolId, tfKey);

    case 'a-share':
    case 'hk-stock':
    case 'index':
      // A-shares/HK → Tencent → East Money → fallback
      let data = await fetchTencentKline(symbolId, tfKey);
      if (data) return data;
      data = await fetchEMKline(symbolId, type, tfKey);
      if (data) return data;
      return null;

    case 'us-stock':
      // US stocks → East Money → fallback
      return await fetchEMKline(symbolId, type, tfKey);

    default:
      return null;
  }
}

/**
 * Choose data source based on symbol type and fetch real-time price.
 */
async function fetchQuote(symbolId, type) {
  switch (type) {
    case 'crypto':
      return await fetchBinancePrice(symbolId);

    case 'a-share':
    case 'hk-stock':
    case 'index':
      // Try Tencent first, then Sina, then East Money
      let quote = await fetchTencentQuote(symbolId);
      if (quote) return quote;
      quote = await fetchSinaQuote(symbolId, type);
      if (quote) return quote;
      quote = await fetchEMQuote(symbolId, type);
      if (quote) return quote;
      return null;

    case 'us-stock':
      return await fetchEMQuote(symbolId, type);

    default:
      return null;
  }
}

module.exports = {
  toTencentCode,
  fetchTencentKline,
  fetchTencentQuote,
  toSinaCode,
  fetchSinaQuote,
  toEMSecId,
  fetchEMKline,
  fetchEMQuote,
  fetchBinanceKline,
  fetchBinancePrice,
  fetchKline,
  fetchQuote,
};
