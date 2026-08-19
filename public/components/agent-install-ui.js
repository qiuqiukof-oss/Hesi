/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <agent-install-ui> — 一键安装智能体 UI（U 盘智能体愿景）
//
// 独立脚本（不进入 esbuild bundle），由 index.html 通过
//   <script defer src="/components/agent-install-ui.js"></script>
// 引入。自动挂载到 #welcome-agent-install 容器。
//
// 行为：
//   - 拉取 /api/agents（安装状态/版本）与 /api/agents/install/registry（可安装清单）
//   - 为每个 featured 智能体渲染一张卡片：图标 / 名称 / 状态徽章 / 一键安装按钮
//   - 点击安装 → POST /api/agents/install/:id，进度经独立 WebSocket 实时推送
//   - 进度条 + 实时日志流；完成显示版本号；失败显示原因 + 重试；安装中可取消
// ============================================================
(function () {
  'use strict';

  const Q = (window.QCLI = window.QCLI || {});

  // i18n helper — resolves via QCLI.__ (set by i18n.js). Falls back to the
  // key itself if i18n isn't ready yet.
  function __(key) {
    return (Q && typeof Q.__ === 'function') ? Q.__(key) : key;
  }

  // ── 共享进度 WebSocket（一个 tab 仅一个，供所有卡片共用） ──
  let progressWS = null;
  const wsListeners = [];
  function getWSURL() {
    return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
  }
  function ensureProgressWS() {
    if (progressWS && (progressWS.readyState === WebSocket.OPEN || progressWS.readyState === WebSocket.CONNECTING)) {
      return progressWS;
    }
    try {
      progressWS = new WebSocket(getWSURL());
      progressWS.onmessage = function (ev) {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && typeof msg.type === 'string' && msg.type.indexOf('agent:install:') === 0) {
          for (let i = 0; i < wsListeners.length; i++) {
            try { wsListeners[i](msg); } catch (e) { /* ignore */ }
          }
        }
      };
    } catch (e) { /* WS 不可用时安装仍会返回 jobId，只是没有实时进度 */ }
    return progressWS;
  }

  // ── API 封装 ──
  function api(url, opts) {
    opts = opts || {};
    return fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }

  // ── 状态映射 ──
  const cards = {}; // agentId -> { el, fill, log, status, btn, jobId }

  function setStatusBadge(card, kind, text) {
    const b = card.el.querySelector('.ai-badge');
    if (!b) return;
    b.className = 'ai-badge ai-' + kind;
    b.textContent = text;
  }

  function setInstalling(card, jobId) {
    card.jobId = jobId;
    card.el.classList.add('ai-installing');
    card.el.classList.remove('ai-done', 'ai-failed');
    setStatusBadge(card, 'installing', __('agent.status.installing'));
    card.btn.textContent = __('agent.btn.cancel');
    card.btn.disabled = false;
    card.btn.dataset.action = 'cancel';
    card.fill.style.width = '8%';
    card.log.textContent = '';
    card.log.classList.remove('hidden');
  }

  function setDone(card, version) {
    card.el.classList.remove('ai-installing');
    card.el.classList.add('ai-done');
    setStatusBadge(card, 'installed', __('agent.status.installed') + ' ' + (version || ''));
    card.btn.textContent = __('agent.btn.reinstall');
    card.btn.disabled = false;
    card.btn.dataset.action = 'install';
    card.fill.style.width = '100%';
  }

  function setFailed(card, error) {
    card.el.classList.remove('ai-installing');
    card.el.classList.add('ai-failed');
    setStatusBadge(card, 'failed', __('agent.status.failed'));
    card.btn.textContent = __('agent.btn.retry');
    card.btn.disabled = false;
    card.btn.dataset.action = 'install';
    card.fill.style.width = '100%';
    if (error) {
      const line = document.createElement('div');
      line.className = 'ai-log-line ai-log-err';
      line.textContent = '✗ ' + error;
      card.log.appendChild(line);
    }
  }

  function setNotInstalled(card) {
    card.el.classList.remove('ai-installing', 'ai-done', 'ai-failed');
    setStatusBadge(card, 'notinstalled', __('agent.status.notinstalled'));
    card.btn.textContent = __('agent.btn.install');
    card.btn.disabled = false;
    card.btn.dataset.action = 'install';
    card.fill.style.width = '0%';
    card.log.classList.add('hidden');
    card.log.textContent = '';
  }

  function appendLog(card, message) {
    if (!message) return;
    const line = document.createElement('div');
    line.className = 'ai-log-line';
    line.textContent = message;
    card.log.appendChild(line);
    // 限制日志行数，避免无限增长
    while (card.log.childElementCount > 60) card.log.removeChild(card.log.firstChild);
    card.log.scrollTop = card.log.scrollHeight;
  }

  function onProgress(card, msg) {
    if (msg.stage) appendLog(card, '[' + msg.stage + '] ' + (msg.message || ''));
    // 进度条做平滑推进（真实百分比未知，用阶段近似 + 抖动）
    let pct = parseInt(card.fill.style.width, 10) || 8;
    pct = Math.min(95, pct + 6);
    card.fill.style.width = pct + '%';
  }

  // ── 安装动作 ──
  function startInstall(agentId) {
    const card = cards[agentId];
    if (!card) return;
    card.btn.disabled = true;
    ensureProgressWS();
    api('/api/agents/install/' + agentId, { method: 'POST' }).then(function (r) {
      if (!r.ok) {
        setFailed(card, (r.body && r.body.error) || ('HTTP ' + r.status));
        return;
      }
      setInstalling(card, r.body.jobId);
    }).catch(function (e) {
      setFailed(card, e.message || String(e));
    });
  }

  function cancelInstall(agentId) {
    const card = cards[agentId];
    if (!card) return;
    card.btn.disabled = true;
    api('/api/agents/install/' + agentId + '/cancel', { method: 'POST' }).then(function (r) {
      if (r.ok) {
        setNotInstalled(card);
        appendLog(card, '已取消安装');
      } else {
        card.btn.disabled = false;
      }
    }).catch(function () { card.btn.disabled = false; });
  }

  // ── 渲染 ──
  function buildCard(agent) {
    const el = document.createElement('div');
    el.className = 'agent-install-card';
    el.innerHTML =
      '<div class="ai-head">' +
        '<span class="ai-icon">' + (agent.icon || '📦') + '</span>' +
        '<div class="ai-title">' +
          '<strong>' + agent.displayName + '</strong>' +
          '<span class="ai-badge ai-notinstalled">' + __('agent.status.notinstalled') + '</span>' +
        '</div>' +
      '</div>' +
      '<p class="ai-desc">' + (agent.desc || '') + '</p>' +
      (agent.offlineAvailable ? '<span class="ai-offline">' + __('agent.offline') + '</span>' : '') +
      '<div class="ai-progress hidden">' +
        '<div class="ai-progress-track"><div class="ai-progress-fill"></div></div>' +
        '<div class="ai-progress-log hidden"></div>' +
      '</div>' +
      '<button class="ai-install-btn" data-action="install">' + __('agent.btn.install') + '</button>';

    const card = {
      el: el,
      fill: el.querySelector('.ai-progress-fill'),
      log: el.querySelector('.ai-progress-log'),
      btn: el.querySelector('.ai-install-btn'),
      progressWrap: el.querySelector('.ai-progress'),
      jobId: null,
    };
    cards[agent.id] = card;

    // 显示进度区
    card.progressWrap.classList.remove('hidden');

    card.btn.addEventListener('click', function () {
      if (card.btn.dataset.action === 'cancel') cancelInstall(agent.id);
      else startInstall(agent.id);
    });
    return card;
  }

  function render(container, registry, statuses) {
    container.innerHTML = '';
    // 状态映射
    const statusMap = {};
    (statuses || []).forEach(function (a) { statusMap[a.id] = a; });

    const list = (registry || []).filter(function (a) { return a.featured; });
    // 保持注册表顺序，featured 在前
    list.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });

    if (list.length === 0) {
      container.innerHTML = '<p class="ai-empty">' + __('agent.empty') + '</p>';
      return;
    }

    list.forEach(function (agent) {
      const card = buildCard(agent);
      container.appendChild(card.el);
      const st = statusMap[agent.id];
      if (st && st.installed) {
        setDone(card, st.version);
      } else {
        setNotInstalled(card);
      }
    });
  }

  // ── 刷新（拉取状态 + 注册表） ──
  function refresh(container) {
    if (!container) return;
    return Promise.all([
      api('/api/agents/install/registry'),
      api('/api/agents'),
    ]).then(function (res) {
      const registry = (res[0].body && res[0].body.agents) || [];
      const statuses = (res[1].body && res[1].body.agents) || [];
      render(container, registry, statuses);
    }).catch(function (e) {
      container.innerHTML = '<p class="ai-empty">' + __('agent.loadfail') + (e.message || e) + '</p>';
    });
  }

  // ── 进度事件路由 ──
  wsListeners.push(function (msg) {
    const card = cards[msg.agentId];
    if (!card) return;
    if (msg.type === 'agent:install:progress') {
      onProgress(card, msg);
    } else if (msg.type === 'agent:install:complete') {
      if (msg.success) {
        setDone(card, msg.version);
        refresh(containerRef); // 用真实版本刷新
      } else {
        setFailed(card, msg.error);
      }
    }
  });

  var containerRef = null;

  function mountInto(selector) {
    const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!container) return;
    containerRef = container;
    refresh(container);
  }

  // ── 自动挂载 ──
  function autoMount() {
    const el = document.getElementById('welcome-agent-install');
    if (el) mountInto(el);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  // Re-render agent install cards when the language changes.
  window.addEventListener('qcli:langchange', function () {
    if (containerRef) refresh(containerRef);
  });

  // 暴露 API
  Q.AgentInstall = {
    mountInto: mountInto,
    refresh: function () { refresh(containerRef); },
  };
})();
