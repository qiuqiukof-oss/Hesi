/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// AI Tools — 统一出口
// ============================================================
const { ToolRegistry } = require('./registry');
const { LRUCache } = require('./cache');
const { ToolResultTruncator } = require('./truncate');
const { TokenBucket, TokenBucketMap } = require('./rate-limit');
const { classifyError } = require('./errors');

module.exports = {
  ToolRegistry,
  LRUCache,
  ToolResultTruncator,
  TokenBucket,
  TokenBucketMap,
  classifyError,
};
