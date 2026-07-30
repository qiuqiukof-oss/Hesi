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

  // ── 从全局 LLM 设置（ChatAPI 同源 localStorage）自动读取 ──
  function readLLM(key, fallback) {
    try { return (typeof localStorage !== 'undefined') ? (localStorage.getItem(key) || fallback) : fallback; }
    catch { return fallback; }
  }
  function fillLLMFields() {
    if (!$('api-key')) return;
    const ak = readLLM('qcli-ai-key', '');
    const pv = readLLM('qcli-ai-provider', '');
    const bu = readLLM('qcli-ai-base-url', '');
    const md = readLLM('qcli-ai-model', '');
    if (ak && !$('api-key').value) $('api-key').value = ak;
    if (pv && !$('provider').value) $('provider').value = pv;
    if (bu && !$('base-url').value) $('base-url').value = bu;
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
      // LLM 配置：优先表单值 → fallback 全局设置（与 ChatAPI 同源）
      const ak = ($('api-key') && $('api-key').value.trim()) || readLLM('qcli-ai-key', '');
      if (ak) body.apiKey = ak;
      const pv = ($('provider') && $('provider').value.trim()) || readLLM('qcli-ai-provider', '');
      if (pv) body.provider = pv;
      const bu = ($('base-url') && $('base-url').value.trim()) || readLLM('qcli-ai-base-url', '');
      if (bu) body.baseUrl = bu;
      const md = ($('model') && $('model').value.trim()) || readLLM('qcli-ai-model', '');
      if (md) body.model = md;
      const ps = $('partners').value.trim(); if (ps) body.partners = ps.split(',').map((x) => x.trim()).filter(Boolean);

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
