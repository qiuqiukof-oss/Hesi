/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// Zero-dependency Markdown → HTML renderer for the note drawer.
// SECURITY: ALL text is HTML-escaped FIRST, then a closed set of
// inline/block transforms is applied. Raw HTML is never emitted.
// Links are sanitized (only http(s)/mailto/relative) and get
// rel="noopener noreferrer". No external dependencies (offline-first).
// ============================================================

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Allow only safe URL schemes; everything else becomes '#'. */
function sanitizeUrl(url) {
  const u = String(url).trim();
  if (/^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  // Bare relative path without a scheme colon (e.g. page.html, ./x, a/b)
  if (/^[^:]+$/.test(u) && /^[\w./?#=&%-]+$/.test(u)) return u;
  return '#';
}

/** Inline formatting: escape first, then code/bold/italic/link. */
function inline(text) {
  let s = escapeHtml(text);
  // inline code (must run before bold/italic so * inside code is untouched)
  s = s.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // italic
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const href = sanitizeUrl(u);
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + t + '</a>';
  });
  // soft line breaks
  s = s.replace(/\n/g, '<br/>');
  return s;
}

/** Split a GFM table row into cells (handles leading/trailing pipes). */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/**
 * Render a Markdown string to an HTML string.
 * @param {string} src
 * @returns {string}
 */
export function renderMarkdown(src) {
  const text = String(src || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(
        '<pre class="md-pre"><code' +
          (lang ? ' data-lang="' + escapeHtml(lang) + '"' : '') +
          '>' +
          escapeHtml(buf.join('\n')) +
          '</code></pre>'
      );
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // blockquote (collect consecutive)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + renderMarkdown(buf.join('\n')) + '</blockquote>');
      continue;
    }

    // GFM table: header row + separator row
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = '<table class="md-table"><thead><tr>';
      header.forEach((c) => (t += '<th>' + inline(c) + '</th>'));
      t += '</tr></thead><tbody>';
      rows.forEach((r) => {
        t += '<tr>';
        header.forEach((_, idx) => (t += '<td>' + inline(r[idx] || '') + '</td>'));
        t += '</tr>';
      });
      t += '</tbody></table>';
      out.push(t);
      continue;
    }

    // lists (ul / ol): collect consecutive items
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const m = lines[i].match(re);
        if (m) buf.push(m[1]);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + buf.map((it) => '<li>' + inline(it) + '</li>').join('') + '</' + tag + '>');
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // paragraph: gather until blank or a block starter
    const para = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|>\s?|```|\s*([-*_])(\s*\2){2,}\s*$)/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      out.push('<p>' + inline(para.join('\n')) + '</p>');
    }
  }

  return out.join('\n');
}

if (typeof window !== 'undefined') {
  window.QCLI = window.QCLI || {};
  window.QCLI.MdRender = { renderMarkdown, escapeHtml };
}
