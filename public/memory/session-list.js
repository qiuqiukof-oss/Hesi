// @ts-check
// ============================================================
// Session list — left column inside the chat drawer.
// ============================================================
// Talks to Q.MemorySession for data; renders searchable, grouped sessions
// with new / resume / rename / delete. When the memory subsystem is disabled
// server-side, the column hides itself and the chat falls back to legacy mode.
// ============================================================
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
import { createSessionItem } from './session-item.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});

const DAY = 86400000;

/** @param {Array} sessions */
function groupSessions(sessions) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today0 = startOfToday.getTime();
  const groups = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '过去 7 天', items: [] },
    { label: '更早', items: [] },
  ];
  for (const s of sessions) {
    const t = s.updatedAt || 0;
    if (t >= today0) groups[0].items.push(s);
    else if (t >= today0 - DAY) groups[1].items.push(s);
    else if (t >= today0 - 7 * DAY) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups;
}

function mount() {
  const drawer = document.getElementById('chat-drawer');
  if (!drawer || document.getElementById('chat-session-aside')) return;

  // Wrap the existing chat content (header + messages + input) into a column
  // so the session aside can sit beside it as a flex row.
  let main = drawer.querySelector('.chat-main');
  if (!main) {
    main = document.createElement('div');
    main.className = 'chat-main';
    Array.from(drawer.children).forEach((ch) => {
      if (ch.id === 'chat-resize-handle' || ch.id === 'chat-session-aside') return;
      main.appendChild(ch);
    });
    drawer.appendChild(main);
  }

  const aside = document.createElement('div');
  aside.id = 'chat-session-aside';
  aside.className = 'chat-session-aside';
  aside.innerHTML = `
    <div class="csa-header">
      <input type="text" id="csa-search" class="csa-search" placeholder="🔍 搜索会话..." autocomplete="off" aria-label="搜索会话" />
      <button id="csa-new" class="csa-new" title="新建会话">＋</button>
      <button id="csa-trash" class="csa-trash" title="回收站（可恢复已删除会话）">🗑<span id="csa-trash-count" class="csa-trash-count" hidden>0</span></button>
    </div>
    <div id="csa-list" class="csa-list"></div>
  `;
  drawer.insertBefore(aside, main);
  drawer.classList.add('chat-drawer-with-sessions');

  const listEl = aside.querySelector('#csa-list');
  const searchEl = aside.querySelector('#csa-search');
  const newBtn = aside.querySelector('#csa-new');
  const trashBtn = aside.querySelector('#csa-trash');
  const trashCountEl = aside.querySelector('#csa-trash-count');

  const render = (sessions, currentId) => {
    // Hide the whole column when memory is disabled (legacy fallback).
    if (!Q.MemorySession || !Q.MemorySession.enabled) {
      aside.style.display = 'none';
      return;
    }
    aside.style.display = '';
    listEl.innerHTML = '';
    if (!sessions || !sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'csa-empty';
      empty.textContent = '暂无会话';
      listEl.appendChild(empty);
      return;
    }
    const groups = groupSessions(sessions);
    for (const g of groups) {
      if (!g.items.length) continue;
      const gh = document.createElement('div');
      gh.className = 'csa-group-label';
      gh.textContent = g.label;
      listEl.appendChild(gh);
      for (const s of g.items) {
        listEl.appendChild(createSessionItem(s, {
          active: s.id === currentId,
          onSelect: (sess) => Q.MemorySession && Q.MemorySession.switch(sess.id),
          onRename: (sess) => {
            const t = window.prompt('重命名会话', sess.title || '');
            if (t && t.trim() && Q.MemorySession) Q.MemorySession.rename(sess.id, t.trim());
          },
          onDelete: (sess) => {
            if (window.confirm('删除会话「' + (sess.title || '新会话') + '」？将移入回收站，可在「🗑 回收站」中恢复。') && Q.MemorySession) {
              Q.MemorySession.remove(sess.id).catch(() => {});
            }
          },
        }));
      }
    }
  };

  newBtn.addEventListener('click', () => Q.MemorySession && Q.MemorySession.create());

  // ── Recycle bin ──
  const updateTrashCount = async () => {
    if (!Q.MemorySession) return;
    try {
      const trashed = await Q.MemorySession.listTrash();
      const n = (trashed || []).length;
      trashCountEl.textContent = String(n);
      trashCountEl.hidden = n === 0;
    } catch { /* ignore */ }
  };
  const openTrashModal = async () => {
    const overlay = document.createElement('div');
    overlay.className = 'csa-trash-overlay';
    const box = document.createElement('div');
    box.className = 'csa-trash-modal';
    box.innerHTML = '<div class="csa-trash-title">🗑 回收站<span class="csa-trash-close">✕</span></div><div class="csa-trash-list"></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    box.querySelector('.csa-trash-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const listEl2 = box.querySelector('.csa-trash-list');
    const renderTrash = async () => {
      const trashed = await Q.MemorySession.listTrash();
      listEl2.innerHTML = '';
      if (!trashed.length) {
        listEl2.innerHTML = '<div class="csa-empty">回收站为空</div>';
        return;
      }
      for (const s of trashed) {
        const row = document.createElement('div');
        row.className = 'csa-trash-row';
        const info = document.createElement('div');
        info.className = 'csa-trash-info';
        info.innerHTML = '<div class="csa-trash-name"></div><div class="csa-trash-meta"></div>';
        info.querySelector('.csa-trash-name').textContent = s.title || '已删除会话';
        const dt = new Date(s.deletedAt || 0);
        info.querySelector('.csa-trash-meta').textContent =
          (s.messageCount || 0) + ' 条 · 删除于 ' + (dt.getMonth() + 1) + '/' + dt.getDate();
        const acts = document.createElement('div');
        acts.className = 'csa-trash-acts';
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'csa-trash-restore';
        restoreBtn.textContent = '恢复';
        restoreBtn.addEventListener('click', async () => {
          await Q.MemorySession.restore(s.id).catch(() => {});
          await renderTrash();
          await updateTrashCount();
        });
        const purgeBtn = document.createElement('button');
        purgeBtn.className = 'csa-trash-purge';
        purgeBtn.textContent = '彻底删除';
        purgeBtn.addEventListener('click', async () => {
          if (window.confirm('彻底删除「' + (s.title || '新会话') + '」？此操作不可恢复。') &&
              await Q.MemorySession.purge(s.id).catch(() => false)) {
            await renderTrash();
            await updateTrashCount();
          }
        });
        acts.appendChild(restoreBtn);
        acts.appendChild(purgeBtn);
        row.appendChild(info);
        row.appendChild(acts);
        listEl2.appendChild(row);
      }
    };
    await renderTrash();
  };
  trashBtn.addEventListener('click', openTrashModal);
  updateTrashCount();

  let st = null;
  searchEl.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(async () => {
      const q = searchEl.value.trim();
      const sessions = (await (Q.MemorySession ? Q.MemorySession.list(q) : Promise.resolve([]))) || [];
      render(sessions, Q.MemorySession ? Q.MemorySession.currentId : '');
    }, 200);
  });

  if (Q.MemorySession) {
    Q.MemorySession.onListChange((sessions, currentId) => { render(sessions, currentId); updateTrashCount(); });
    render(Q.MemorySession.sessions, Q.MemorySession.currentId);
    updateTrashCount();
    // Show the list as soon as memory is confirmed enabled — whether that
    // happens during initial load or later (e.g. backend was slow to start).
    Q.MemorySession.onReady((st) => {
      if (st.enabled) Q.MemorySession.refreshList().catch(() => {});
    });
    if (Q.MemorySession.ready) {
      if (Q.MemorySession.enabled) Q.MemorySession.refreshList().catch(() => {});
    } else {
      // Guarantee init runs even if the chat panel didn't trigger it.
      Q.MemorySession.init().catch((e) => console.warn('[SessionList] MemorySession init failed:', e && e.message));
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
