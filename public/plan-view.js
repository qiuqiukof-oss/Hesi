/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// 全自动 Plan 执行器前端（Phase 0）
// 纯原生 JS：POST /api/plan/execute，渲染逐步结果 + 反思。
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SAMPLE = {
    objective: '在仓库根新增计划说明文件 PLAN_DEMO.md，内容为 # Demo',
    acceptance: [
      { id: 'a1', kind: 'command', command: 'test -f PLAN_DEMO.md && grep -q "Demo" PLAN_DEMO.md', expect: '' },
    ],
    steps: [
      { id: 's1', goal: '写文件', action: 'printf "# Demo\\n" > PLAN_DEMO.md' },
      { id: 's2', goal: '校验内容', action: 'grep Demo PLAN_DEMO.md', checkpoint: true },
    ],
    allow_external: false,
    forbidden: ['rm -rf'],
    scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
  };

  function setStatus(msg, kind) {
    const el = $('status-banner');
    el.className = 'status-banner status-' + (kind || 'info');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderReflection(r) {
    const el = $('reflection');
    if (!r) { el.classList.add('hidden'); return; }
    const rate = r.acceptancePassRate == null ? '—' : Math.round(r.acceptancePassRate * 100) + '%';
    el.className = 'reflection';
    el.innerHTML =
      '<div class="ref-card"><span class="ref-k">状态</span><span class="ref-v">' + esc(r.status) + '</span></div>' +
      '<div class="ref-card"><span class="ref-k">步完成</span><span class="ref-v">' + (r.stepsDone || 0) + '/' + (r.stepsTotal || 0) + '</span></div>' +
      '<div class="ref-card"><span class="ref-k">验收通过率</span><span class="ref-v">' + rate + '</span></div>' +
      (r.budget ? '<div class="ref-card"><span class="ref-k">轮数</span><span class="ref-v">' + (r.budget.rounds || 0) + '</span></div>' : '') +
      (r.reason ? '<div class="ref-card ref-full"><span class="ref-k">说明</span><span class="ref-v">' + esc(r.reason) + '</span></div>' : '');
    el.classList.remove('hidden');
  }

  function renderSteps(steps) {
    const wrap = $('steps');
    wrap.innerHTML = '';
    (steps || []).forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'step step-' + (s.status || 'unknown');
      const cp = s.checkpoint
        ? '<div class="step-cp">软断点: ' +
          (s.checkpoint.ok ? '圆桌推导成功' + (s.checkpoint.usedRoundtable ? '（用圆桌）' : '') : '退回需人补充 acceptance') +
          '</div>'
        : '';
      const out = s.output ? '<pre class="step-out">' + esc(s.output.slice(0, 600)) + '</pre>' : '';
      const snap = s.snapshot ? '<div class="step-snap">快照 ' + esc(s.snapshot.slice(0, 8)) + '</div>' : '';
      div.innerHTML =
        '<div class="step-head"><span class="step-idx">' + (i + 1) + '</span>' +
        '<span class="step-goal">' + esc(s.goal || s.id) + '</span>' +
        '<span class="step-badge">' + esc(s.status || '?') + '</span></div>' +
        (s.reason ? '<div class="step-reason">' + esc(s.reason) + '</div>' : '') +
        cp + snap + out;
      wrap.appendChild(div);
    });
  }

  function clearResults() {
    $('status-banner').classList.add('hidden');
    $('reflection').classList.add('hidden');
    $('steps').innerHTML = '';
    $('empty-hint').classList.remove('hidden');
    hideGate();
  }

  // ── P2.6 审批闸：WS 监听 + 闸门卡片 ──
  let planWs = null;
  let currentExecId = null;

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function connectPlanWS() {
    try {
      planWs = new WebSocket(wsUrl());
      planWs.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'plan:await-approval') {
          currentExecId = msg.execId;
          showGate(msg.step);
        } else if (msg.type === 'plan:approval-resolved' && msg.execId === currentExecId) {
          updateGateStatus(msg.approved ? '已通过，继续执行…' : (msg.timedOut ? '超时（视为驳回），已中止' : '已驳回，已中止'));
        }
      };
      planWs.onclose = () => { planWs = null; };
    } catch { /* WS 不可用则无闸门卡片，仍可走完整自动执行 */ }
  }

  function showGate(step) {
    let gate = $('approval-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'approval-gate';
      gate.className = 'approval-gate hidden';
      gate.innerHTML =
        '<div class="ag-backdrop"></div>' +
        '<div class="ag-card">' +
          '<div class="ag-title">审批闸 · 步骤需人工确认</div>' +
          '<div class="ag-step"></div>' +
          '<div class="ag-risk"></div>' +
          '<div class="ag-actions">' +
            '<button id="ag-approve" class="btn btn-primary" type="button">通过并执行</button>' +
            '<button id="ag-reject" class="btn" type="button">驳回并中止</button>' +
          '</div>' +
          '<div class="ag-status"></div>' +
        '</div>';
      document.body.appendChild(gate);
      gate.querySelector('#ag-approve').addEventListener('click', () => resolveGate('approve'));
      gate.querySelector('#ag-reject').addEventListener('click', () => resolveGate('reject'));
    }
    gate.querySelector('.ag-step').textContent = (step.goal || step.id || '') + (step.action ? '  →  ' + step.action : '');
    gate.querySelector('.ag-risk').textContent = step.risk ? ('风险：' + step.risk) : '';
    gate.querySelector('.ag-status').textContent = '';
    gate.classList.remove('hidden');
  }

  function updateGateStatus(text) {
    const gate = $('approval-gate');
    if (gate) gate.querySelector('.ag-status').textContent = text;
  }

  function hideGate() {
    const gate = $('approval-gate');
    if (gate) gate.classList.add('hidden');
  }

  async function resolveGate(kind) {
    if (!currentExecId) return;
    updateGateStatus(kind === 'approve' ? '提交中…' : '驳回中…');
    try {
      const res = await fetch('/api/plan/' + encodeURIComponent(currentExecId) + '/' + kind, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) updateGateStatus('操作失败：' + (data.error || res.status));
    } catch (e) {
      updateGateStatus('网络异常：' + e.message);
    }
  }

  // ── 执行 Agent 下拉：合并 /api/clis(agent) + /api/agents(installed) + ⭐收藏 ──
  async function loadExecAgentOptions() {
    const sel = $('exec-agent');
    if (!sel) return;
    // 默认项：AI 助手（内置 LLM 管线，圆桌式默认）
    sel.innerHTML = '<option value="ai">AI 助手（内置 LLM 管线）</option>';
    try {
      const [clisRes, agentsRes] = await Promise.all([
        fetch('/api/clis').then((r) => r.json()).catch(() => null),
        fetch('/api/agents').then((r) => r.json()).catch(() => null),
      ]);
      const seen = new Set(['ai']);
      const add = (id, label) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        const o = document.createElement('option');
        o.value = id;
        o.textContent = label;
        sel.appendChild(o);
      };
      // ── 分组 1：外部 agent（自动识别 category=agent）──
      const clis = (clisRes && clisRes.clis) || [];
      const agentClis = clis.filter((c) => c.category === 'agent');
      if (agentClis.length) {
        const g = document.createElement('optgroup'); g.label = '外部 Agent';
        agentClis.forEach((c) => add(c.id || c.name, (c.name || c.id)));
        if (g.children.length) sel.appendChild(g);
      }
      // ── 分组 2：已安装 agents ──
      const agents = (agentsRes && agentsRes.agents) || [];
      const installedAgents = agents.filter((a) => a.installed);
      if (installedAgents.length) {
        const g = document.createElement('optgroup'); g.label = '已安装';
        installedAgents.forEach((a) => add(a.id, (a.displayName || a.name)));
        if (g.children.length) sel.appendChild(g);
      }
      // ── 分组 3：⭐ 收藏（用户自选，含不被自动识别为 agent 的条目）──
      let favIds = [];
      try { favIds = JSON.parse(localStorage.getItem('qcli-favorites') || '[]'); } catch { favIds = []; }
      if (favIds.length) {
        const allClis = clis; // 全量 CLI（不限 category），交叉取名称
        const favItems = favIds.map((fid) => {
          const found = allClis.find((c) => (c.id || c.name) === fid) ||
                        agents.find((a) => a.id === fid);
          return { id: fid, name: found ? (found.name || found.displayName || found.id) : fid };
        });
        const g = document.createElement('optgroup');
        g.label = '\u2B50 \u6536\u85CF'; // ⭐ 收藏
        favItems.forEach((f) => {
          const isCustom = allClis.some((c) => ((c.id || c.name) === f.id) && (c.category !== 'agent'));
          add(f.id, f.name + (isCustom ? ' \u00B7 \u81EA\u9009' : '')); // · 自选
        });
        if (g.children.length) sel.appendChild(g);
      }
    } catch { /* 静默：仅保留默认项 */ }
  }

  // ── 从全局 LLM 设置读取（与 ChatAPI 同源，含 sessionStorage 迁移）──
  function readLLM(key, fallback) {
    try {
      const ls = typeof localStorage !== 'undefined' ? localStorage : null;
      const ss = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      // 优先 localStorage，再试 sessionStorage（API Key 等敏感值可能存在 session 中）
      if (ls) { const v = ls.getItem(key); if (v) return v; }
      if (ss) { const v = ss.getItem(key); if (v) {
        // 迁移到 localStorage（与 ChatAPI 行为一致）
        try { if (ls) ls.setItem(key, v); } catch { /* quota etc */ }
        return v;
      }}
      return fallback;
    } catch { return fallback; }
  }

  // 尝试从 safeStorage 兼容层读取（plan.html 无 bundle.js 时 QCLI.safeStorage 不存在，
  // 但某些自定义构建可能通过全局脚本注入；多一条路多一个机会）
  function readSafeStorage(key, fallback) {
    try {
      const Q = (typeof window !== 'undefined' && window.QCLI) || {};
      if (Q.safeStorage && typeof Q.safeStorage.get === 'function') {
        const v = Q.safeStorage.get(key, fallback);
        if (v) return v;
      }
      if (Q.safeSession && typeof Q.safeSession.get === 'function') {
        const v = Q.safeSession.get(key, '');
        if (v) return v;
      }
    } catch { /* ignore */ }
    return fallback;
  }
    function fillLLMFields() {
    if (!$('api-key')) return;
    // 与 ChatAPI 同源：localStorage 优先 → sessionStorage 迁移（plan.html 无 QCLI 全局）
    const ak = readLLM('qcli-ai-key', '');
    if (ak && !$('api-key').value) $('api-key').value = ak;
    const pv = readLLM('qcli-ai-provider', '');
    if (pv && !$('provider').value) $('provider').value = pv;
    const bu = readLLM('qcli-ai-base-url', '');
    if (bu && !$('base-url').value) $('base-url').value = bu;
    const md = readLLM('qcli-ai-model', '');
    if (md && !$('model').value) $('model').value = md;
  }

  async function execute() {
    const objective = $('objective-input').value.trim();
    const body = {};
    clearResults();
    setStatus('执行中…', 'info');
    $('execute').disabled = true;
    try {
      if (objective) {
        body.objective = objective; // 自然语言入口：交给 AI 拆解
      } else {
        const raw = $('plan-input').value.trim();
        if (!raw) {
          setStatus('请填写「自然语言目标」或「Plan JSON」', 'error');
          return;
        }
        try {
          body.plan = JSON.parse(raw);
        } catch (e) {
          setStatus('Plan JSON 解析失败：' + e.message, 'error');
          return;
        }
      }
      // LLM 配置：提交时最终兜底——按优先级链读取（确保即使 fillLLMFields 因时序未命中也能拿到）
      // 优先级：表单值 > ChatAPI(QCLI) > safeStorage 兼容 > 原生 localStorage/sessionStorage
      const _getLLM = (inputId, storageKey, chatApiGetter) => {
        // 1. 表单值（用户手动修改或自动填充）
        const el = $(inputId);
        if (el && el.value.trim()) return el.value.trim();
        // 2. ChatAPI / safeStorage（与聊天面板完全同源，此时 QCLI 可能已就绪）
        try {
          const Q = (typeof window !== 'undefined' && window.QCLI) || {};
          if (chatApiGetter && Q.ChatAPI && Q.ChatAPI[chatApiGetter]) {
            const v = Q.ChatAPI[chatApiGetter](); if (v) return v;
          }
          if (Q.safeStorage) { const v = Q.safeStorage.get(storageKey, ''); if (v) return v; }
        } catch { /* continue */ }
        // 3. safeStorage 兼容层（处理非标准注入场景）
        const sv = readSafeStorage(storageKey, '');
        if (sv) return sv;
        // 4. 原生 localStorage → sessionStorage 最终兜底
        return readLLM(storageKey, '');
      };
      // 诊断日志：确认每项 LLM 配置的读取来源（稳定后可移除）
      try {
        const diag = {};
        diag.ak_src = _getLLM('api-key', 'qcli-ai-key', 'getApiKey') ? 'OK' : 'MISSING';
        diag.pv_src = _getLLM('provider', 'qcli-ai-provider', 'getProvider') || '(default openai)';
        diag.bu_src = _getLLM('base-url', 'qcli-ai-base-url', 'getBaseUrl') ? 'OK' : '(default)';
        diag.md_src = _getLLM('model', 'qcli-ai-model', 'getModel') ? 'OK' : '(default gpt-4o-mini)';
        console.log('[Plan LLM Config]', JSON.stringify(diag));
      } catch { /* diag 不影响主流程 */ }
      const ak = _getLLM('api-key', 'qcli-ai-key', 'getApiKey');
      if (ak) body.apiKey = ak;
      const pv = _getLLM('provider', 'qcli-ai-provider', 'getProvider');
      if (pv) body.provider = pv;
      const bu = _getLLM('base-url', 'qcli-ai-base-url', 'getBaseUrl');
      if (bu) body.baseUrl = bu;
      const md = _getLLM('model', 'qcli-ai-model', 'getModel');
      if (md) body.model = md;
      const ps = $('partners').value.trim(); if (ps) body.partners = ps.split(',').map((x) => x.trim()).filter(Boolean);
      const ea = $('exec-agent') ? $('exec-agent').value.trim() : '';
      if (ea) body.agentId = ea; // 'ai' 或外部 CLI agent id

      // 个性化「权限设置」下钻：从 localStorage 读取（与个性化面板同源）
      const permsRaw = (typeof localStorage !== 'undefined') ? localStorage.getItem('qcli-permissions') : null;
      if (permsRaw) {
        try {
          const p = JSON.parse(permsRaw);
          if (p && typeof p === 'object') body.permissions = p;
        } catch { /* ignore */ }
      }

      const res = await fetch('/api/plan/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      $('empty-hint').classList.add('hidden');
      if (!res.ok) {
        setStatus('请求失败：' + (data.error || res.status), 'error');
        return;
      }
      const kind = data.status === 'done' ? 'ok' : (data.status === 'diverged' || data.status === 'rejected') ? 'error' : 'warn';
      let msg = '状态：' + data.status + (data.branch ? ' · 分支 ' + data.branch : '');
      if (data.missing && data.missing.length) {
        msg += ' · 需补 acceptance: ' + data.missing.join(',');
      }
      // 友好化常见错误
      if (data.status === 'rejected') {
        msg += '\n💡 提示：Plan 缺少机器可验证的验收条件（acceptance）。';
        if (objective) {
          msg += '\n   使用自然语言目标时，AI 会自动生成 acceptance；若未生成，请尝试：';
          msg += '\n   ① 点「载入示例」看完整格式  ② 在 JSON 中手动补充 acceptance 数组  ③ 检查 API Key 是否已配置';
        } else {
          msg += '\n   请在 Plan JSON 中添加 acceptance 字段，例如：';
          msg += '\n   "acceptance": [{ "id":"a1", "kind":"command", "command":"test -f 文件名", "expect":"" }]';
        }
      } else if (data.status === 'diverged') {
        msg += '\n💡 提示：执行结果偏离预期。若已开启 autoReplan，系统将自动修订并重试。';
      }
      setStatus(msg, kind);
      renderReflection(data.reflection);
      renderSteps(data.steps);
      hideGate();
    } catch (e) {
      setStatus('网络/执行异常：' + e.message, 'error');
    } finally {
      $('execute').disabled = false;
    }
  }

  function init() {
    connectPlanWS();
    fillLLMFields(); // 自动从全局 LLM 设置填充高级字段
    loadExecAgentOptions(); // 填充执行 Agent 下拉
    $('load-sample').addEventListener('click', () => {
      $('plan-input').value = JSON.stringify(SAMPLE, null, 2);
    });
    $('format-json').addEventListener('click', () => {
      try {
        $('plan-input').value = JSON.stringify(JSON.parse($('plan-input').value), null, 2);
      } catch (e) { setStatus('格式化失败：' + e.message, 'error'); }
    });
    $('execute').addEventListener('click', execute);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
