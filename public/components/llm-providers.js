/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// LLM Provider 设置页组件（M3）
//
// 注册为右侧面板 Tab「模型服务」：provider 卡片网格 + 状态徽标
// （ok/degraded/down/unconfigured）+ 配置表单（key/baseUrl/模型下拉）
// + 健康刷新 + 模型动态化（本地探测 / 云端静态）。
//
// 数据源：GET /api/llm-providers（脱敏）
// 写入：  POST /api/llm-providers/config
// 刷新：  POST /api/llm-providers/health
// ============================================================
// @ts-check

function Q() {
  return window.QCLI || {};
}

const STATUS_META = {
  ok: { label: '✓ 可用', cls: 'llmp-ok', icon: '🟢' },
  degraded: { label: '⚠ key 无效', cls: 'llmp-degraded', icon: '🟠' },
  down: { label: '✗ 不可达', cls: 'llmp-down', icon: '🔴' },
  unconfigured: { label: '未配置', cls: 'llmp-unconfigured', icon: '⚪' },
  unknown: { label: '未探测', cls: 'llmp-unconfigured', icon: '⚪' },
};

/** 徽标 HTML */
function statusBadge(status) {
  const m = STATUS_META[status] || STATUS_META.unknown;
  return `<span class="llmp-badge ${m.cls}">${m.icon} ${m.label}</span>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

/** 拉取某 provider 模型列表（本地探测 / 云端静态）。@param {string} id @returns {Promise<string[]>} */
async function fetchModels(id) {
  try {
    const data = await apiGet(`/api/llm-providers/${encodeURIComponent(id)}/models`);
    return Array.isArray(data.models) ? data.models : [];
  } catch (e) {
    console.warn('[llm-providers] fetchModels failed:', e && e.message);
    return [];
  }
}

/** 渲染卡片网格。@param {HTMLElement} root */
async function renderGrid(root) {
  root.innerHTML = '<div class="llmp-loading">加载模型服务列表…</div>';
  let data;
  try {
    data = await apiGet('/api/llm-providers');
  } catch (e) {
    root.innerHTML = `<div class="llmp-error">加载失败：${escapeHtml(e.message)}</div>`;
    return;
  }
  const providers = data.providers || [];
  const cards = providers.map((p) => {
    const meta = STATUS_META[p.health] || STATUS_META.unknown;
    const modelOptions = (p.model ? `<option value="${escapeHtml(p.model)}">${escapeHtml(p.model)}</option>` : '')
      + '<option value="">（使用默认）</option>';
    return `
      <div class="llmp-card" data-id="${escapeHtml(p.id)}">
        <div class="llmp-card-head">
          <span class="llmp-card-name">${escapeHtml(p.name)}</span>
          <span class="llmp-card-kind">${p.kind === 'local' ? '本地' : '云端'}</span>
          ${statusBadge(p.health)}
        </div>
        <div class="llmp-card-meta">
          ${p.source !== 'none' ? `凭证来源 ${p.source === 'env' ? '环境变量' : '设置页'} · ${p.maskedKey ? 'key ' + escapeHtml(p.maskedKey) : '无 key'} · ` : ''}
          <span class="llmp-base" title="${escapeHtml(p.baseUrl)}">${escapeHtml(p.baseUrl)}</span>
        </div>
        <div class="llmp-health-err">${escapeHtml(p.healthError || '')}</div>
        <div class="llmp-card-fields">
          <label>API Key
            <input class="llmp-key" type="password" placeholder="${p.source === 'env' ? '已由环境变量提供（留空不变）' : '粘贴 API Key'}" autocomplete="off" />
          </label>
          <label>Base URL
            <input class="llmp-base-input" type="text" placeholder="${escapeHtml(p.baseUrl)}" />
          </label>
          <label>模型
            <select class="llmp-model"></select>
          </label>
        </div>
        <div class="llmp-card-actions">
          <button class="llmp-btn llmp-btn-primary" data-act="save">💾 保存</button>
          <button class="llmp-btn" data-act="models">🔄 拉取模型</button>
          <button class="llmp-btn" data-act="clear">🗑 清空配置</button>
        </div>
        <div class="llmp-msg"></div>
      </div>`;
  }).join('');
  root.innerHTML = `
    <div class="llmp-toolbar">
      <span class="llmp-title">模型服务</span>
      <button class="llmp-btn" id="llmp-refresh">🔄 刷新健康</button>
      <span class="llmp-hint">配置后聊天 / Plan / 圆桌 / 记忆自动使用（env 优先，设置页覆盖）</span>
    </div>
    <div class="llmp-grid">${cards}</div>`;

  root.querySelectorAll('.llmp-card').forEach((card) => bindCard(card));
  const refreshBtn = root.querySelector('#llmp-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '刷新中…';
      try { await apiPost('/api/llm-providers/health', {}); } catch { /* 忽略，渲染会显示 */ }
      await renderGrid(root);
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 刷新健康';
    });
  }
}

/** 绑定单卡片交互。@param {HTMLElement} card */
function bindCard(card) {
  const id = card.dataset.id;
  const msgEl = card.querySelector('.llmp-msg');
  const modelSel = card.querySelector('.llmp-model');
  const saveBtn = card.querySelector('[data-act="save"]');
  const clearBtn = card.querySelector('[data-act="clear"]');
  const modelsBtn = card.querySelector('[data-act="models"]');

  const toast = (text, type) => {
    if (msgEl) {
      msgEl.textContent = text;
      msgEl.className = 'llmp-msg ' + (type === 'error' ? 'llmp-msg-error' : 'llmp-msg-ok');
    }
    if (Q().showToast) Q().showToast(text, type === 'error' ? 'error' : 'success');
  };

  // 预填当前模型（若有）
  const currentModel = card.querySelector('.llmp-card-name').textContent && modelSel;
  void currentModel;

  // 拉取模型列表（首次进入自动拉一次本地探测）
  const loadModels = async () => {
    if (modelSel) {
      modelSel.innerHTML = '<option value="">拉取中…</option>';
      const models = await fetchModels(id);
      if (!models.length) {
        modelSel.innerHTML = '<option value="">（无模型 / 服务未运行）</option>';
        return;
      }
      modelSel.innerHTML = models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')
        + '<option value="">（使用默认）</option>';
    }
  };
  if (modelsBtn) modelsBtn.addEventListener('click', loadModels);

  // 保存
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const fields = {};
      const keyInput = card.querySelector('.llmp-key');
      const baseInput = card.querySelector('.llmp-base-input');
      if (keyInput && keyInput.value.trim()) fields.apiKey = keyInput.value.trim();
      if (baseInput && baseInput.value.trim()) fields.baseUrl = baseInput.value.trim();
      if (modelSel && modelSel.value) fields.model = modelSel.value;
      if (!Object.keys(fields).length) {
        toast('没有可保存的内容（key 已由 env 提供时可留空）', 'error');
        return;
      }
      saveBtn.disabled = true;
      try {
        const data = await apiPost('/api/llm-providers/config', { provider: id, fields });
        toast(data.warning ? `已保存（注意：${data.warning}）` : '已保存 ✓');
        await renderGrid(card.parentElement && card.parentElement.parentElement
          ? (card.closest('.llmp-grid') ? card.closest('.llmp-grid').parentElement : document.querySelector('.llmp-root'))
          : document.querySelector('.llmp-root'));
      } catch (e) {
        toast('保存失败：' + (e && e.message), 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // 清空配置（回 env/none）
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.disabled = true;
      try {
        await apiPost('/api/llm-providers/config', { provider: id, fields: { apiKey: '', baseUrl: '', model: '' } });
        toast('已清空设置页配置（恢复 env/默认）✓');
        await renderGrid(card.closest('.llmp-grid').parentElement);
      } catch (e) {
        toast('清空失败：' + (e && e.message), 'error');
      } finally {
        clearBtn.disabled = false;
      }
    });
  }
}

/** 注册右侧面板 Tab。 */
function registerTab() {
  const UIR = Q().UIRegistry;
  if (!UIR) {
    setTimeout(registerTab, 200);
    return;
  }
  UIR.registerTab('llm-providers', {
    icon: '🤖',
    label: '模型服务',
    category: 'monitor',
    order: 3, // 笔记(order 2)之后
    render: (container) => {
      container.classList.add('llmp-root');
      try {
        renderGrid(container);
      } catch (e) {
        container.innerHTML = '<div class="llmp-error">' + escapeHtml(e.message || String(e)) + '</div>';
      }
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerTab);
} else {
  registerTab();
}
