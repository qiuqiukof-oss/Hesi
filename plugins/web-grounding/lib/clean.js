/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// clean.js — 轻量文本清洗
//
// 浏览器 innerText 已是纯文本（无 HTML 标签、无截图），
// 这里只做"去噪"：折叠多余空行、清尾随空白，方便 LLM 直接读。
// 不做结构化抽取——结构化是 LLM 的活，不在工具层做。
// ============================================================

function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

module.exports = { cleanText };
