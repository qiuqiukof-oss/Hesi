// @ts-check
// ============================================================
// Workspace directory selector.
// Sets the GLOBAL working directory (drives new terminals' cwd +
// AI tool exec / file ops on the server via lib/workspace.js).
// UI: a prominent "📂 选择工作空间 ▾" button in the terminal
// tab-bar AND the chat header. Clicking opens a server-backed
// folder browser (browsers can't expose absolute paths via native
// pickers), so the chosen path is a real absolute filesystem path.
// ============================================================
(function () {
  const STORAGE_KEY = 'hesi-workspace-dir';
  const Q = window.QCLI || (window.QCLI = {});

  // ── inject styles (self-contained) ──
  const style = document.createElement('style');
  style.textContent = `
    .ws-dir-btn{display:inline-flex;align-items:center;gap:6px;margin:0 6px;padding:4px 10px;
      border:1.5px solid var(--accent,#4a9eff);border-radius:6px;background:var(--accent-soft,#e8f1ff);
      color:var(--accent,#1769ff);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;max-width:240px}
    .ws-dir-btn:hover{filter:brightness(.97)}
    .ws-dir-label{overflow:hidden;text-overflow:ellipsis;max-width:160px}
    #ws-picker-modal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
    .ws-picker{width:540px;max-width:92vw;background:var(--bg,#fff);color:var(--fg,#222);border:1px solid var(--border,#ddd);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.3);overflow:hidden;font-size:13px}
    .ws-picker-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,#ddd);font-weight:700}
    .ws-picker-crumbs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 14px;background:var(--bg-soft,#f5f5f5);font-size:12px}
    .ws-crumb{cursor:pointer;color:var(--accent,#1769ff)}
    .ws-crumb:hover{text-decoration:underline}
    .ws-picker-list{max-height:300px;overflow:auto;padding:6px 0}
    .ws-dir-item{display:flex;align-items:center;gap:8px;padding:7px 14px;cursor:pointer}
    .ws-dir-item:hover{background:var(--accent-soft,#eef4ff)}
    .ws-picker-foot{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,#ddd)}
    .ws-picker-input{flex:1;min-width:0;padding:6px 8px;border:1px solid var(--border,#ccc);border-radius:6px;background:var(--bg,#fff);color:var(--fg,#222)}
    .ws-btn{padding:6px 14px;border:1px solid var(--border,#ccc);border-radius:6px;cursor:pointer;background:var(--bg,#fff);color:var(--fg,#222)}
    .ws-btn.primary{background:var(--accent,#1769ff);color:#fff;border-color:var(--accent,#1769ff)}
  `;
  document.head.appendChild(style);

  let current = localStorage.getItem(STORAGE_KEY) || '';

  function apiGet(url) {
    return fetch(url).then((r) => r.json());
  }
  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, d })));
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function updateLabels(ws) {
    if (ws) current = ws;
    document.querySelectorAll('.ws-dir-label').forEach((el) => {
      el.textContent = current || '工作空间';
      el.title = current || '';
    });
  }

  function cdActiveTerminal(dir) {
    try {
      const tabId = Q.Tabs && Q.Tabs.activeTabId;
      if (tabId && Q.wsSend) {
        Q.wsSend({ type: 'input', data: 'cd ' + JSON.stringify(dir) + '\n', tabId });
      }
    } catch (e) { /* noop */ }
  }

  function fetchDirs(dir) {
    return apiGet('/api/fs/dirs?dir=' + encodeURIComponent(dir || ''));
  }

  function openPicker() {
    const modal = document.createElement('div');
    modal.id = 'ws-picker-modal';
    modal.innerHTML = `
      <div class="ws-picker">
        <div class="ws-picker-head">📂 选择工作空间目录</div>
        <div class="ws-picker-crumbs" id="ws-crumbs"></div>
        <div class="ws-picker-list" id="ws-list"></div>
        <div class="ws-picker-foot">
          <input class="ws-picker-input" id="ws-input" placeholder="粘贴绝对路径，如 C:\\Projects\\Hesi 或 /Users/me/Hesi" />
          <button class="ws-btn primary" id="ws-confirm">设为工作空间</button>
          <button class="ws-btn" id="ws-cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const crumbs = modal.querySelector('#ws-crumbs');
    const list = modal.querySelector('#ws-list');
    const input = modal.querySelector('#ws-input');

    let navPath = current || '';

    function renderCrumbs() {
      crumbs.innerHTML = '';
      const segs = navPath.split(/[\\/]/).filter(Boolean);
      let acc = '';
      segs.forEach((s, i) => {
        acc += (i === 0 ? s : (navPath.includes('\\') ? '\\' + s : '/' + s));
        const span = document.createElement('span');
        span.className = 'ws-crumb';
        span.textContent = s;
        span.onclick = () => { navPath = acc; render(); };
        crumbs.appendChild(span);
        if (i < segs.length - 1) {
          const sep = document.createElement('span');
          sep.textContent = ' / ';
          crumbs.appendChild(sep);
        }
      });
    }

    async function render() {
      input.value = navPath;
      renderCrumbs();
      list.innerHTML = '<div style="padding:10px 14px;color:#999">加载中…</div>';
      const data = await fetchDirs(navPath).catch(() => ({ dirs: [] }));
      list.innerHTML = '';
      (data.dirs || []).forEach((d) => {
        const item = document.createElement('div');
        item.className = 'ws-dir-item';
        item.innerHTML = '<span>📁</span><span>' + escapeHtml(d.name) + '</span>';
        item.onclick = () => { navPath = d.path; render(); };
        list.appendChild(item);
      });
      if (!(data.dirs || []).length) {
        const empty = document.createElement('div');
        empty.style.padding = '10px 14px';
        empty.style.color = '#999';
        empty.textContent = '（无子目录，可直接在下方粘贴路径并确认）';
        list.appendChild(empty);
      }
    }

    modal.querySelector('#ws-cancel').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#ws-confirm').onclick = async () => {
      const dir = input.value.trim();
      if (!dir) return;
      const { ok, d } = await apiPost('/api/workspace', { dir });
      if (ok) {
        updateLabels(d.workspace);
        Q.showToast && Q.showToast('工作空间已设为：' + d.workspace, 'success');
        cdActiveTerminal(d.workspace);
        modal.remove();
      } else {
        Q.showToast && Q.showToast('设置失败：' + (d.error || '未知错误'), 'error');
      }
    };

    if (!navPath) {
      apiGet('/api/workspace').then((d) => { navPath = d.workspace || ''; render(); });
    } else {
      render();
    }
  }

  function injectButtons() {
    const labelHtml = '<span class="ws-dir-label">' + (current || '工作空间') + '</span> ▾';
    const tabBar = document.getElementById('tab-bar');
    if (tabBar && !document.getElementById('ws-dir-btn')) {
      const btn = document.createElement('button');
      btn.id = 'ws-dir-btn';
      btn.className = 'ws-dir-btn';
      btn.title = '选择工作空间目录（新终端与 AI 执行默认在此）';
      btn.innerHTML = '📂 ' + labelHtml;
      btn.onclick = openPicker;
      tabBar.parentNode.insertBefore(btn, tabBar);
    }
    const chatActions = document.querySelector('.chat-header-actions');
    if (chatActions && !document.getElementById('ws-dir-btn-chat')) {
      const btn = document.createElement('button');
      btn.id = 'ws-dir-btn-chat';
      btn.className = 'ws-dir-btn';
      btn.title = '选择工作空间目录（AI 执行命令默认在此）';
      btn.innerHTML = '📂 ' + labelHtml;
      btn.onclick = openPicker;
      chatActions.insertBefore(btn, chatActions.firstChild);
    }
  }

  function init() {
    injectButtons();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      apiPost('/api/workspace', { dir: saved }).then(({ ok, d }) => { if (ok) updateLabels(d.workspace); });
    } else {
      apiGet('/api/workspace').then((d) => { if (d.workspace) updateLabels(d.workspace); });
    }
  }

  Q.WorkspaceDir = { open: openPicker, getCurrent: () => current };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
