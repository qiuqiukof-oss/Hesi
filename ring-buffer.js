/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// RingBuffer — 定长环形缓冲区（按总字符数限制）
//
// 合并自 mcp/session-manager.js (RingBuffer) 和
// ws/agent.js (LogRingBuffer)，统一两个实现为一个公共模块。
//
// - 字符串存储，按总字符数限制内存使用
// - 支持按行 tail() 和按字节位置 slice()
// - O(n) 追加 + 超出上限时截断尾部保留
// - 保留至少一个最新 chunk（即使其单独已超过 maxSize）
// ============================================================

class RingBuffer {
  /**
   * @param {number} [maxSize=5000] - 最大总字符数（默认 5000，mcp 默认值）
   */
  constructor(maxSize = 5000) {
    this.maxSize = maxSize;
    /** @type {string} 内部存储的字符串 */
    this._buf = '';
    /** 是否曾发生溢出 */
    this._overflowed = false;
  }

  /**
   * 追加数据。如果超出 maxSize，从头部截断。
   * @param {string} data
   * @returns {{ appendedLen: number }} 实际追加的字符数（便于上游追踪）
   */
  append(data) {
    if (!data) return { appendedLen: 0 };
    const oldLen = this._buf.length;
    this._buf += data;
    if (this._buf.length > this.maxSize) {
      // 保留至少 maxSize 个字符（尾部），丢弃头部
      this._buf = this._buf.slice(-this.maxSize);
      this._overflowed = true;
    }
    return { appendedLen: this._buf.length - oldLen };
  }

  /**
   * 返回全部缓冲内容的拼接字符串。
   * 别名：full(), join()
   * @returns {string}
   */
  full() {
    return this._buf;
  }

  /** @returns {string} 同 full()，兼容 ws/agent.js */
  join() {
    return this._buf;
  }

  /**
   * 返回从逻辑字节位置到末尾的内容。
   * 如果位置已被溢出 evict，返回 null。
   * @param {number} from - 逻辑字节位置
   * @returns {string|null}
   */
  slice(from) {
    if (this._overflowed) {
      // 估计被 evict 的字符数
      const evicted = this.maxSize > 0 ? Math.max(0, this._buf.length - this.maxSize) : 0;
      if (from < evicted) return null; // 位置已被 evict
    }
    if (from >= this._buf.length) return '';
    return this._buf.slice(from);
  }

  /**
   * 返回最后 N 行（按 \n 分割）。
   * @param {number} n - 行数
   * @returns {string}
   */
  tail(n) {
    if (n <= 0) return '';
    const lines = this._buf.split('\n');
    return lines.slice(-n).join('\n');
  }

  /**
   * 当前逻辑长度（溢出后保持不变为 maxSize）。
   * @returns {number}
   */
  get length() {
    return this._overflowed ? this.maxSize : this._buf.length;
  }

  /** 是否发生过溢出 */
  get overflowed() {
    return this._overflowed;
  }

  /** 清空缓冲区 */
  clear() {
    this._buf = '';
    this._overflowed = false;
  }
}

module.exports = { RingBuffer };
