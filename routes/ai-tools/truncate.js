/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// ToolResultTruncator — Token 感知截断
//
// 防止 AI 上下文被过长的工具结果撑爆。
// 对长文本采用头尾保留 + 中间截断策略。
// ============================================================

class ToolResultTruncator {
  /**
   * @param {number} maxTokens - 最大估计 token 数（默认 4000）
   */
  constructor(maxTokens = 4000) {
    this._maxTokens = maxTokens;
  }

  /**
   * 粗略估算文本的 token 数。
   * 英文 ~4 chars/token，中文 ~2 chars/token。
   * @param {string} text
   * @returns {number}
   */
  _estimateTokens(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/g) || []).length;
    const ascii = text.length - cjk;
    return Math.ceil(cjk / 2 + ascii / 4);
  }

  /**
   * 截断工具结果。
   * 如果结果不超过限制，原样返回。
   * @param {string} result
   * @returns {string}
   */
  truncate(result) {
    if (typeof result !== 'string' || !result) return result;
    const tokens = this._estimateTokens(result);
    if (tokens <= this._maxTokens) return result;

    // 按比例截取，保留头尾
    const ratio = this._maxTokens / tokens;
    const cutAt = Math.floor(result.length * ratio * 0.9); // 留 10% 余量
    const headLen = Math.floor(cutAt * 0.6);
    const tailLen = Math.floor(cutAt * 0.4);

    const head = result.slice(0, headLen);
    const tail = result.slice(result.length - tailLen);

    return `${head}\n\n[... 截断: 原始约 ${tokens} tokens，已保留 ${this._maxTokens} tokens | original ~${tokens} tokens, trimmed to ${this._maxTokens} tokens ...]\n\n${tail}`;
  }

  /**
   * 更新最大 token 限制。
   * @param {number} maxTokens
   */
  setMaxTokens(maxTokens) {
    this._maxTokens = maxTokens;
  }
}

module.exports = { ToolResultTruncator };
