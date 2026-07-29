/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tool: get_stock_data
// ============================================================

const { fetchGet } = require('../internal-api');

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'get_stock_data',
    description: '获取股票、基金、指数或加密货币的实时行情和历史走势数据（来自 东方财富）',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '股票代码。示例：AAPL / GOOGL / MSFT / TSLA / AMZN / NVDA / BABA / TSM（美股），00700.HK / 9988.HK（港股），000300（沪深300），BTC / ETH（加密货币），SPY / QQQ（ETF）' },
        range: {
          type: 'string',
          enum: ['1D', '1W', '1M', '3M', '1Y'],
          description: '数据时间范围：1D（日内5分钟线）、1W、1M（日线）、3M、1Y',
          default: '1M',
        },
      },
      required: ['symbol'],
    },
    execute: async (args) => {
      try {
        const symbol = encodeURIComponent(args.symbol || 'AAPL');
        const data = await fetchGet(`/stocks/${symbol}`, { range: args.range || '1M' });
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
