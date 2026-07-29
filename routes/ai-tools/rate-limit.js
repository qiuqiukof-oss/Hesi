/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// TokenBucket — 工具调用频率限制
//
// 防止 AI 在单次响应中循环调用工具过多次。
// 每个 token bucket 独立工作，web_search 等可配高消耗。
// ============================================================

class TokenBucket {
  /**
   * @param {number} maxTokens - 最大令牌数（默认 60）
   * @param {number} refillRate - 每次补充的令牌数（默认 20）
   * @param {number} refillIntervalMs - 补充间隔（毫秒，默认 30 秒）
   */
  constructor(maxTokens = 60, refillRate = 20, refillIntervalMs = 30_000) {
    this._maxTokens = maxTokens;
    this._tokens = maxTokens;
    this._refillRate = refillRate;
    this._refillIntervalMs = refillIntervalMs;
    this._lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    const intervals = Math.floor(elapsed / this._refillIntervalMs);
    if (intervals > 0) {
      this._tokens = Math.min(this._maxTokens, this._tokens + intervals * this._refillRate);
      this._lastRefill += intervals * this._refillIntervalMs;
    }
  }

  /**
   * 尝试消耗 tokens。
   * @param {number} [cost=1] - 消耗数量
   * @returns {boolean} - true=允许，false=受限
   */
  tryConsume(cost = 1) {
    this._refill();
    if (this._tokens >= cost) {
      this._tokens -= cost;
      return true;
    }
    return false;
  }

  /**
   * 获取当前可用令牌数。
   * @returns {number}
   */
  get available() {
    this._refill();
    return this._tokens;
  }

  /**
   * 重置令牌桶 — 每次新对话开始时调用，确保突发上限用于当前会话。
   */
  reset() {
    this._tokens = this._maxTokens;
    this._lastRefill = Date.now();
  }
}

/**
 * TokenBucketMap — 按 key 隔离的多实例令牌桶。
 *
 * 解决全局单例 TokenBucket 在多用户/多会话并发下的「饿死」风险：
 * 每个聊天请求（requestId）拥有独立的令牌桶，互不干扰。
 *
 * 使用：tryConsume(key, cost) / reset(key)。key 不存在时自动创建。
 * 内部按 LRU 淘汰冷桶，防止长期运行的进程内存无限增长。
 */
class TokenBucketMap {
  /**
   * @param {number} maxTokens
   * @param {number} refillRate
   * @param {number} refillIntervalMs
   * @param {number} [maxBuckets=256] - 最多保留的桶数量（超出按 LRU 淘汰）
   */
  constructor(maxTokens = 300, refillRate = 100, refillIntervalMs = 30_000, maxBuckets = 256) {
    this._max = maxTokens;
    this._refillRate = refillRate;
    this._interval = refillIntervalMs;
    this._maxBuckets = maxBuckets;
    /** @type {Map<string, TokenBucket>} */
    this._buckets = new Map();
    /** @type {string[]} 最近使用顺序（LRU） */
    this._order = [];
  }

  _get(key) {
    let b = this._buckets.get(key);
    if (!b) {
      b = new TokenBucket(this._max, this._refillRate, this._interval);
      this._buckets.set(key, b);
      this._order.push(key);
      this._evict();
    } else {
      // 更新 LRU 顺序
      const idx = this._order.indexOf(key);
      if (idx !== -1) this._order.splice(idx, 1);
      this._order.push(key);
    }
    return b;
  }

  _evict() {
    while (this._buckets.size > this._maxBuckets) {
      const oldest = this._order.shift();
      if (oldest === undefined) break;
      this._buckets.delete(oldest);
    }
  }

  /** 尝试消耗 key 对应桶的 tokens。 */
  tryConsume(key, cost = 1) {
    return this._get(key).tryConsume(cost);
  }

  /** 重置 key 对应桶（每轮/每请求开始时调用）。 */
  reset(key) {
    if (key === undefined) return; // 无 key 时不操作，保持兼容
    this._get(key).reset();
  }

  /** 删除某个 key 的桶（请求结束时可选清理）。 */
  delete(key) {
    if (this._buckets.delete(key)) {
      const idx = this._order.indexOf(key);
      if (idx !== -1) this._order.splice(idx, 1);
    }
  }
}

module.exports = { TokenBucket, TokenBucketMap };
