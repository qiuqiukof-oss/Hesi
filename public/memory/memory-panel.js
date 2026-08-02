/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Memory drawer (🧠) — shows the auto-built user profile + remembered facts,
// and lets the user forget individual facts. Read-only-ish, matching
// WorkBuddy's "memory auto-injected, viewable & forgettable" feel.
// ============================================================
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});

/** @param {string} s */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
/** @param {string} s */
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/"/g, '&quot;');
}

function mount() {
  if (document.getElementById('memory-drawer')) return;
  // 守卫：仅主应用页（index.html 有 🧠 记忆按钮）挂载记忆面板。
  // 独立页（budget.html / tools.html 等）也加载 bundle.js，若无守卫会无条件
  // append 记忆面板 DOM 到 body；又因独立页未引 memory-sessions.css，
  // `.memory-drawer.hidden{display:none}` 失效 → 面板裸显在页面下方。
  if (!document.getElementById('chat-memory-btn')) return;

  const overlay = document.createElement('div');
  overlay.id = 'memory-drawer';
  overlay.className = 'memory-drawer hidden';
  overlay.innerHTML = `
    <div class="memory-drawer-bg" data-close="1"></div>
    <div class="memory-drawer-inner">
      <div class="memory-drawer-header">
        <span class="memory-drawer-icon">🧠</span>
        <span class="memory-drawer-title">记忆</span>
        <button class="memory-drawer-close" data-close="1" title="关闭">✕</button>
      </div>
      <div class="memory-drawer-body" id="memory-drawer-body">
        <div class="memory-loading">加载中…</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('#memory-drawer-body');
  // P2.1 时间轴 Tab：与「事实」并列切换
  const tabBar = document.createElement('div');
  tabBar.className = 'memory-tabs';
  tabBar.innerHTML = '<button class="memory-tab active" data-tab="facts">📋 事实</button>'
    + '<button class="memory-tab" data-tab="timeline">🕒 时间轴</button>';
  overlay.querySelector('.memory-drawer-inner').insertBefore(tabBar, body);
  tabBar.querySelectorAll('.memory-tab').forEach((tb) => {
    tb.addEventListener('click', () => {
      tabBar.querySelectorAll('.memory-tab').forEach((x) => x.classList.remove('active'));
      tb.classList.add('active');
      if (tb.dataset.tab === 'timeline') {
        const sid = Q.MemorySession && Q.MemorySession.currentId;
        if (Q.MemoryTimeline) Q.MemoryTimeline.renderMemoryTimeline(body, sid);
        else body.innerHTML = '<div class="memory-empty">时间轴模块未加载，请刷新页面。</div>';
      } else {
        renderFacts();
      }
    });
  });
  const close = () => overlay.classList.add('hidden');
  overlay.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  const renderFacts = async () => {
    if (!Q.MemorySession) {
      body.innerHTML = '<div class="memory-empty">记忆模块未加载，请刷新页面。</div>';
      return;
    }
    body.innerHTML = '<div class="memory-loading">加载中…</div>';
    // Re-probe each open — self-heals if the backend was restarted.
    const status = await Q.MemorySession.ensureEnabled().catch((e) => ({ enabled: false, error: (e && e.message) || 'unknown' }));
    if (!status.enabled) {
      if (status.error) {
        body.innerHTML = '<div class="memory-empty">记忆服务不可用：' + escapeHtml(status.error)
          + '。<br>请确认 Hesi 后端已启动（默认端口 4264），然后重开本抽屉或刷新页面。</div>';
      } else {
        body.innerHTML = '<div class="memory-empty">记忆功能未启用（MEMORY_ENABLED=false）。</div>';
      }
      return;
    }
    let data;
    try {
      data = await Q.MemorySession.getFacts();
    } catch (e) {
      body.innerHTML = '<div class="memory-empty">加载失败：' + escapeHtml(e && e.message || '') + '</div>';
      return;
    }
    const facts = data.facts || [];
    const profile = data.profile || '';
    let html = '';

    // Profile summary
    html += '<div class="memory-section"><div class="memory-section-title">用户画像</div>';
    if (profile) {
      html += '<div class="memory-profile">' + escapeHtml(profile) + '</div>';
    } else {
      html += '<div class="memory-empty">暂无画像，多聊几句后会自动生成。</div>';
    }
    html += '</div>';

    // Facts
    html += '<div class="memory-section"><div class="memory-section-title">已记住的事实（' + facts.length + '）</div>';
    if (!facts.length) {
      html += '<div class="memory-empty">还没有长期事实。AI 会在对话中自动抽取并记住稳定信息。</div>';
    } else {
      html += '<div class="memory-facts">';
      for (const f of facts) {
        html += '<div class="memory-fact">'
          + '<div class="memory-fact-text">' + escapeHtml(f.fact) + '</div>'
          + '<button class="memory-fact-forget" data-id="' + escapeAttr(f.id) + '" title="遗忘这条">🧠➖</button>'
          + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Recall test
    html += '<div class="memory-section"><div class="memory-section-title">召回测试</div>'
      + '<div class="memory-recall-row"><input type="text" id="memory-recall-q" placeholder="输入一句话，看看会召回什么..." autocomplete="off" />'
      + '<button id="memory-recall-btn">测试</button></div>'
      + '<div id="memory-recall-result" class="memory-recall-result"></div></div>';

    body.innerHTML = html;

    body.querySelectorAll('.memory-fact-forget').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          await Q.MemorySession.forgetFact(id);
          renderFacts();
        } catch (e) {
          window.alert('遗忘失败：' + (e && e.message || ''));
        }
      });
    });
    const rq = body.querySelector('#memory-recall-q');
    const rb = body.querySelector('#memory-recall-btn');
    const rr = body.querySelector('#memory-recall-result');
    rb.addEventListener('click', async () => {
      const q = rq.value.trim();
      if (!q) return;
      rr.textContent = '查询中…';
      try {
        const block = await Q.MemorySession.recall(q, 5);
        rr.textContent = block && block.content ? block.content : '(无召回内容)';
      } catch (e) {
        rr.textContent = '召回失败：' + (e && e.message || '');
      }
    });
  };

  const open = () => { overlay.classList.remove('hidden'); renderFacts(); };

  const btn = document.getElementById('chat-memory-btn');
  if (btn) btn.addEventListener('click', open);

  Q.MemoryPanel = { open, close };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
