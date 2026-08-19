/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// message-render — pure Markdown → HTML rendering for <chat-panel>
//
// Extracted from chat-panel.js (P2.1 structural refactor). These are
// side-effect-free string transforms (only dep: escapeHtml), so they are
// unit-testable in isolation and safe to reuse. Behavior is intentionally
// identical to the previous inline implementation.
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/**
 * Turn bare URLs into clickable links. Input MUST already be HTML-escaped.
 * Only a whitelist of protocols is linked (http/https/file/relative uploads)
 * so `javascript:` and similar XSS vectors are never produced.
 * @param {string} text
 * @returns {string}
 */
export function linkify(text) {
  const urlRe = /((?:https?:\/\/|file:\/\/|\/uploads\/)[^\s<>"'）)\]]+)/g;
  return text.replace(urlRe, (url) => {
    let href = url;
    let trailing = '';
    // 剥离被误捕获的句末标点（。.，,；;：: 等），保留在链接之外
    if (/[.,;:。，；：]\s*$/.test(href)) {
      trailing = href.slice(-1);
      href = href.slice(0, -1);
    }
    const label = href.length > 50 ? href.slice(0, 47) + '…' : href;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>${trailing}`;
  });
}

/**
 * Lightweight Markdown → HTML (no external deps). Escapes first, stashes code
 * blocks/inline code as placeholders (so their contents are never mangled or
 * linkified), then restores them last. XSS-safe by construction.
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first, then apply markdown patterns
  let html = escapeHtml(text);

  // 先把代码块/行内代码抽离为占位符，避免其中的 URL 被误链、也避免 markdown 破坏其内容
  const codeStore = [];
  const stash = (fragment) => {
    const idx = codeStore.push(fragment) - 1;
    return `%%CB${idx}%%`;
  };

  // Code blocks (processed first so inner content is safe)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmedCode = code.trimEnd();
    const escapedCode = escapeHtml(trimmedCode);
    const escapedLang = lang ? escapeHtml(lang) : '';
    const langBadge = lang ? `<span class="md-code-lang">${escapedLang}</span>` : '';

    // Mermaid 代码块：渲染为流程图而非普通代码
    if (lang === 'mermaid') {
      return stash(`<div class="mermaid">${escapedCode}</div>`);
    }

    return stash(`<div class="md-code-block">`
      + `<div class="md-code-header">${langBadge}<button class="md-copy-btn" title="复制">📋</button></div>`
      + `<pre><code>${escapedCode}</code></pre>`
      + `<button class="cmd-send-btn" title="发送该命令到当前终端">▶ 发送到终端</button>`
      + `</div>`);
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => stash(`<code class="md-inline-code">${code}</code>`));

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, (_, t) => t.trim() ? `<em>${t}</em>` : `*${t}*`);

  // Horizontal rules (---)
  html = html.replace(/^---$/gm, '<hr class="md-hr">');

  // 链接可点击（代码已抽离、输入已转义 ⇒ XSS 安全）
  html = linkify(html);

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // 还原代码块
  html = html.replace(/%%CB(\d+)%%/g, (_, i) => codeStore[Number(i)] || '');

  return html;
}
