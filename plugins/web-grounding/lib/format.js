/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// format.js — read() 结果的统一文本格式化（单一事实源）
//
// 供 mcp-server.js 与 Hesi 插件 handler 复用，避免三处重复。
// 输出含降噪比例（rawChars vs chars），让 AI 感知内容精简程度。
// ============================================================

/**
 * 把 read() 的文本结果格式化成 AI 可直接阅读的文本。
 * @param {'search'|'fetch'} mode
 * @param {string} label 查询词或 URL
 * @param {object} r read() 返回对象（含 ok/mode/engineSource/url/title/text/links/chars/rawChars/format）
 * @returns {string}
 */
function formatResult(mode, label, r) {
  if (!r || !r.ok) {
    return `Web grounding 失败：${(r && r.error) || '未知错误'}`;
  }
  const head =
    mode === 'search'
      ? `# 搜索：${label}\n来源引擎：${r.engineSource || '未知'} (${r.url || ''})\n`
      : `# ${r.title || label}\n来源：${r.url || ''}\n`;
  let links = '';
  if (Array.isArray(r.links) && r.links.length) {
    links =
      '\n## 相关链接\n' +
      r.links
        .slice(0, 15)
        .map((l) => `- [${l.text || l.url}](${l.url})`)
        .join('\n');
  }
  const reduction =
    r.rawChars && r.chars != null ? Math.round((1 - r.chars / r.rawChars) * 100) : 0;
  const tail = `\n\n---\n正文/结果字数：${r.chars} | 原始页面字数：${r.rawChars} | 降噪：${reduction}% | 耗时：${r.elapsedMs}ms | 格式：${r.format}`;
  return `${head}\n${r.text || '(无文本)'}${links}${tail}`;
}

module.exports = { formatResult };
