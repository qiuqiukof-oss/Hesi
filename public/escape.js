/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// escape.js — Canonical HTML-escaping helper (single source of truth)
// ------------------------------------------------------------
// Historically ~17 modules each redefined their own escapeHtml().
// This module is the one place that owns the implementation; other
// modules should `import { escapeHtml } from './escape.js'` instead
// of rolling their own. Kept dependency-free so any module can use it.
// ============================================================

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for safe insertion into HTML text OR attribute context.
 *
 * NOTE: this deliberately does NOT use the DOM `textContent`→`innerHTML` trick.
 * That approach only escapes &, <, > — it leaves quotes intact, so a value
 * interpolated into an attribute (`title="${escapeHtml(x)}"`) could break out
 * with a stray `"`. The explicit map below escapes all five characters, making
 * this a safe superset replacement for every legacy escapeHtml variant (both
 * the DOM-based and the regex-based ones). It's also DOM-free, so it works in
 * workers / SSR / tests.
 *
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const s = str == null ? '' : String(str);
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
