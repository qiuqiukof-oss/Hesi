/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Session list item — renders a single session row.
// ============================================================
'use strict';

/** @param {number} ts */
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = 60000, h = 3600000, d = 86400000;
  if (diff < m) return '刚刚';
  if (diff < h) return Math.floor(diff / m) + ' 分钟前';
  if (diff < d) return Math.floor(diff / h) + ' 小时前';
  if (diff < 7 * d) return Math.floor(diff / d) + ' 天前';
  const dt = new Date(ts);
  return (dt.getMonth() + 1) + '/' + dt.getDate();
}

/**
 * @param {object} session
 * @param {{active?:boolean, onSelect?:Function, onRename?:Function, onDelete?:Function}} opts
 * @returns {HTMLElement}
 */
export function createSessionItem(session, opts = {}) {
  const el = document.createElement('div');
  el.className = 'session-item' + (opts.active ? ' active' : '');
  el.dataset.id = session.id;

  const titleEl = document.createElement('div');
  titleEl.className = 'session-item-title';
  titleEl.textContent = session.title || '新会话';
  titleEl.title = session.title || '新会话';

  const metaEl = document.createElement('div');
  metaEl.className = 'session-item-meta';
  const count = session.messageCount || 0;
  metaEl.textContent = count + ' 条 · ' + relTime(session.updatedAt);

  const delBtn = document.createElement('button');
  delBtn.className = 'session-item-del';
  delBtn.textContent = '🗑';
  delBtn.title = '删除会话';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onDelete && opts.onDelete(session);
  });

  el.appendChild(titleEl);
  el.appendChild(metaEl);
  el.appendChild(delBtn);

  el.addEventListener('click', () => opts.onSelect && opts.onSelect(session));
  titleEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    opts.onRename && opts.onRename(session);
  });
  return el;
}

export { relTime };
