/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// LRUCache — 工具结果缓存
//
// 用于 web_search 等工具的查询结果去重。
// 减少 API 配额消耗、防止触发反爬、提升响应速度。
// ============================================================

class LRUCache {
  /**
   * @param {number} maxSize - 最大缓存条目数（默认 50）
   * @param {number} ttlMs - 过期时间（毫秒，默认 5 分钟）
   */
  constructor(maxSize = 50, ttlMs = 5 * 60 * 1000) {
    this._map = new Map();
    this._maxSize = Math.max(1, maxSize);
    this._ttlMs = ttlMs;
  }

  /**
   * 获取缓存值。如果不存在或已过期返回 null。
   * @param {string} key
   * @returns {*|null}
   */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._ttlMs) {
      this._map.delete(key);
      return null;
    }
    // LRU: 删除再插入使其移到 Map 末尾（最新）
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /**
   * 设置缓存值。超出 maxSize 时淘汰最老条目。
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this._map.has(key)) this._map.delete(key);
    // 淘汰最旧条目（Map 迭代第一个）
    if (this._map.size >= this._maxSize) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, { value, ts: Date.now() });
  }

  /** 清空缓存 */
  clear() {
    this._map.clear();
  }

  /** 当前缓存数量 */
  get size() {
    return this._map.size;
  }
}

module.exports = { LRUCache };
