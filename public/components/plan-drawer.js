/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 全自动 Plan 执行器 · 聊天侧边抽屉渲染器（仿 RoundTableView）
//
// 架构：Plan = chat 的一种「能力」。引擎复用 Q.ChatAPI 的同源 LLM 设置
// （apiKey/provider/baseUrl/model 均从 Q.ChatAPI 读取，与 AI 助手完全一致），
// 本模块只负责把 UI 渲染进 #plan-embed 抽屉，并调用 /api/plan/execute。
//
// 通过 window.QCLI.PlanDrawer.{open,close} 由 chat-panel 的 togglePlanPanel 调起。
// ============================================================
'use strict';

import { safeStorage } from '../lib/storage.js';

/** @type {any} */
const Q = window.QCLI = window.QCLI || {};

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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PlanDrawer = {
  root: null,
  rendered: false,
  planWs: null,
  currentExecId: null,

  /** 首次打开时把静态 UI 渲染进抽屉容器 */
  _ensureRendered() {
    const root = document.getElementById('plan-embed');
    if (!root) return;
    this.root = root;
    if (this.rendered) return;
    const body = root.querySelector('.plan-embed-body');
    if (!body) return;
    body.innerHTML = `
      <div class="plan-field">
        <label class="plan-label" for="plan-objective">自然语言目标（可选）</label>
        <textarea id="plan-objective" class="plan-textarea" spellcheck="false"
          placeholder="描述你想完成的事，AI 自动拆解成 Plan&#10;例：把圆桌模板画廊做出来，并修复右侧栏在空注册表时崩溃"></textarea>
        <p class="plan-hint">填了目标就交给 AI 自动拆解；留空则手写下方 JSON。</p>
      </div>
      <div class="plan-field">
        <label class="plan-label" for="plan-json">Plan JSON（可选）</label>
        <textarea id="plan-json" class="plan-textarea" spellcheck="false"
          placeholder='{&#10;  "objective": "目标",&#10;  "acceptance": [{ "id":"a1", "kind":"command", "command":"test -f foo.txt", "expect":"" }],&#10;  "steps": [{ "id":"s1", "goal":"步骤", "action":"命令" }]&#10;}'></textarea>
      </div>
      <details class="plan-advanced">
        <summary>高级（LLM / 圆桌 / 权限）</summary>
        <div class="adv-grid">
          <label>API Key<input id="plan-api-key" type="password" placeholder="自动读取聊天设置" /></label>
          <label>Provider<input id="plan-provider" placeholder="自动读取" /></label>
          <label>BaseURL<input id="plan-base-url" placeholder="自动读取" /></label>
          <label>Model<input id="plan-model" placeholder="自动读取" /></label>
          <div class="disc-partner-wrap">
            <button type="button" id="plan-drawer-partner-btn" class="discuss-multibtn plan-partner-btn placeholder"
              title="选择参与讨论的 CLI Agent（可多选，收藏夹已同步）">选择讨论伙伴 ▾</button>
            <div id="plan-drawer-partner-dropdown" class="discuss-dropdown hidden"></div>
          </div>
          <label>执行 Agent<select id="plan-exec-agent" title="步骤默认执行方；默认 AI 助手（内置 LLM 管线），可选外部 CLI agent"></select></label>
        </div>
      </details>
      <div class="plan-actions">
        <button id="plan-load-sample" class="btn">载入示例</button>
        <button id="plan-format" class="btn">格式化</button>
        <button id="plan-execute" class="btn btn-primary">▶ 执行 plan</button>
      </div>
      <h2 class="plan-result-title">执行结果</h2>
      <div id="plan-status" class="status-banner hidden"></div>
      <div id="plan-reflection" class="reflection hidden"></div>
      <div id="plan-steps" class="steps"></div>
      <div id="plan-empty" class="empty-hint">
        <div class="empty-icon">🎯</div>
        <div class="empty-title">准备执行你的第一个 Plan</div>
        <div class="empty-body">
          <div class="empty-tip"><strong>快速开始：</strong>填写自然语言目标，或点「载入示例」再执行。</div>
          <div class="empty-section"><div class="empty-stitle">✅ 验收条件（acceptance）</div><div class="empty-desc">每条 Plan 必须包含至少一条机器可验证的验收。支持 <code>command</code>、<code>script</code>、<code>http</code>。不支持 <code>manual</code>。</div></div>
          <div class="empty-section"><div class="empty-stitle">🔄 反思重规划（v0.6.2+）</div><div class="empty-desc">若首跑 <code>diverged</code>，开启 autoReplan 后会自动修订并重试。</div></div>
          <div class="empty-section"><div class="empty-stitle">🛡️ 运行时拦截（v0.6.2+）</div><div class="empty-desc">开启后每个步骤 action 会经安全策略评估；危险命令被拦截为 <code>blocked</code>。默认关闭。</div></div>
          <div class="empty-section"><div class="empty-stitle">📚 RAG 回流（v0.6.2+）</div><div class="empty-desc">每次执行完成自动回流本地索引，聊天可召回历史 Plan。</div></div>
        </div>
      </div>
    `;
    // 事件绑定
    body.querySelector('#plan-load-sample').addEventListener('click', () => {
      body.querySelector('#plan-json').value = JSON.stringify(SAMPLE, null, 2);
    });
    body.querySelector('#plan-format').addEventListener('click', () => {
      try { body.querySelector('#plan-json').value = JSON.stringify(JSON.parse(body.querySelector('#plan-json').value), null, 2); }
      catch (e) { this._setStatus('格式化失败：' + e.message, 'error'); }
    });
    body.querySelector('#plan-execute').addEventListener('click', () => this._execute());
    // 自动填充 LLM（同源）
    this._fillLLM(body);
    // 执行 Agent 下拉
    this._loadExecAgentOptions(body);
    // 讨论伙伴多选（M3）
    this._loadPartnerOptions(body);
    // 审批闸 WS
    this._connectWS();
    this.rendered = true;
  },

  /** 执行 Agent 下拉：合并 /api/clis(agent) + /api/agents(installed) + ⭐收藏 */
  _loadExecAgentOptions(body) {
    const sel = body.querySelector('#plan-exec-agent');
    if (!sel) return;
    sel.innerHTML = '<option value="ai">AI 助手（内置 LLM 管线）</option>';
    Promise.all([
      fetch('/api/clis').then((r) => r.json()).catch(() => null),
      fetch('/api/agents').then((r) => r.json()).catch(() => null),
    ]).then(([clisRes, agentsRes]) => {
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
      const favIds = safeStorage.getJSON('qcli-favorites', []);
      if (favIds.length) {
        const favItems = favIds.map((fid) => {
          const found = clis.find((c) => (c.id || c.name) === fid) ||
                        agents.find((a) => a.id === fid);
          return { id: fid, name: found ? (found.name || found.displayName || found.id) : fid };
        });
        const g = document.createElement('optgroup'); g.label = '⭐ 收藏';
        favItems.forEach((f) => add(f.id, f.name + (clis.find((c) => (c.id||c.name)===f.id && c.category!=='agent') ? ' · 自选' : '')));
        if (g.children.length) sel.appendChild(g);
      }
    }).catch(() => { /* 静默：仅保留默认项 */ });
  },

  /** 讨论伙伴多选（M3）：复用聊天面板多选模式；抽屉无「先讨论」开关，常显 */
  _loadPartnerOptions(body) {
    const btn = body.querySelector('#plan-drawer-partner-btn');
    const dd = body.querySelector('#plan-drawer-partner-dropdown');
    if (!btn || !dd) return;

    const list = [];
    Promise.all([
      fetch('/api/clis').then((r) => r.json()).catch(() => null),
      fetch('/api/agents').then((r) => r.json()).catch(() => null),
    ]).then(([clisRes, agentsRes]) => {
      const agents = (agentsRes && agentsRes.agents ? agentsRes.agents : []).filter((a) => a.installed);
      agents.forEach((a) => list.push({ id: a.id, name: a.displayName || a.name }));
      const clis = (clisRes && clisRes.clis ? clisRes.clis : []).filter((c) => c.category === 'agent');
      clis.forEach((c) => { if (!list.some((x) => x.id === c.id)) list.push({ id: c.id || c.name, name: c.name }); });

      const favIds = safeStorage.getJSON('qcli-favorites', []);
      const favSet = new Set(favIds);
      list.sort((a, b) => {
        const af = favSet.has(a.id) ? 0 : 1;
        const bf = favSet.has(b.id) ? 0 : 1;
        if (af !== bf) return af - bf;
        return (a.name || '').localeCompare(b.name || '');
      });

      dd.innerHTML = '';
      if (!list.length) {
        dd.innerHTML = '<div class="discuss-dropdown-empty">未发现可用 CLI Agent</div>';
        return;
      }
      if (list.some((a) => favSet.has(a.id))) {
        const hint = document.createElement('div');
        hint.className = 'discuss-fav-hint';
        hint.textContent = `★ 已与收藏夹同步（${list.filter((a) => favSet.has(a.id)).length} 个）`;
        dd.appendChild(hint);
      }
      list.forEach((a) => {
        const isFav = favSet.has(a.id);
        const label = document.createElement('label');
        label.className = 'discuss-option' + (isFav ? ' favorited' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.id = a.id;
        if (isFav) cb.checked = true;
        label.appendChild(cb);
        const star = document.createElement('span');
        star.className = 'discuss-fav-star';
        star.textContent = isFav ? '★ ' : '';
        label.appendChild(star);
        label.appendChild(document.createTextNode(a.name + (a.version ? ' · ' + a.version : '')));
        dd.appendChild(label);
      });
    }).catch(() => { /* 静默 */ });

    const updateLabel = () => {
      const checked = Array.from(dd.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.dataset.id);
      if (!checked.length) { btn.textContent = '选择讨论伙伴 ▾'; btn.classList.add('placeholder'); }
      else if (checked.length === 1) {
        const n = list.find((x) => x.id === checked[0]);
        btn.textContent = (n ? n.name : checked[0]) + ' ▾';
        btn.classList.remove('placeholder');
      } else { btn.textContent = `已选 ${checked.length} 个伙伴 ▾`; btn.classList.remove('placeholder'); }
    };

    btn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => {
      if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    dd.addEventListener('change', updateLabel);
    updateLabel();
  },

  /** 从 Q.ChatAPI 读取同源 LLM 设置（与聊天完全一致） */
  _fillLLM(body) {
    const ak = Q.ChatAPI && Q.ChatAPI.getApiKey ? Q.ChatAPI.getApiKey() : safeStorage.get('qcli-ai-key', '');
    const pv = Q.ChatAPI && Q.ChatAPI.getProvider ? Q.ChatAPI.getProvider() : safeStorage.get('qcli-ai-provider', '');
    const bu = Q.ChatAPI && Q.ChatAPI.getBaseUrl ? Q.ChatAPI.getBaseUrl() : safeStorage.get('qcli-ai-base-url', '');
    const md = Q.ChatAPI && Q.ChatAPI.getModel ? Q.ChatAPI.getModel() : safeStorage.get('qcli-ai-model', '');
    if (ak && !body.querySelector('#plan-api-key').value) body.querySelector('#plan-api-key').value = ak;
    if (pv && !body.querySelector('#plan-provider').value) body.querySelector('#plan-provider').value = pv;
    if (bu && !body.querySelector('#plan-base-url').value) body.querySelector('#plan-base-url').value = bu;
    if (md && !body.querySelector('#plan-model').value) body.querySelector('#plan-model').value = md;
  },

  _setStatus(msg, kind) {
    const el = this.root.querySelector('#plan-status');
    el.className = 'status-banner status-' + (kind || 'info');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  _renderReflection(r) {
    const el = this.root.querySelector('#plan-reflection');
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
  },

  _renderSteps(steps) {
    const wrap = this.root.querySelector('#plan-steps');
    wrap.innerHTML = '';
    (steps || []).forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'step step-' + (s.status || 'unknown');
      const cp = s.checkpoint
        ? '<div class="step-cp">软断点: ' + (s.checkpoint.ok ? '圆桌推导成功' + (s.checkpoint.usedRoundtable ? '（用圆桌）' : '') : '退回需人补充 acceptance') + '</div>'
        : '';
      const out = s.output ? '<pre class="step-out">' + esc(s.output.slice(0, 600)) + '</pre>' : '';
      const snap = s.snapshot ? '<div class="step-snap">快照 ' + esc(s.snapshot.slice(0, 8)) + '</div>' : '';
      div.innerHTML =
        '<div class="step-head"><span class="step-idx">' + (i + 1) + '</span>' +
        '<span class="step-goal">' + esc(s.goal || s.id) + '</span>' +
        '<span class="step-badge">' + esc(s.status || '?') + '</span></div>' +
        (s.reason ? '<div class="step-reason">' + esc(s.reason) + '</div>' : '') + cp + snap + out;
      wrap.appendChild(div);
    });
  },

  _clearResults() {
    this.root.querySelector('#plan-status').classList.add('hidden');
    this.root.querySelector('#plan-reflection').classList.add('hidden');
    this.root.querySelector('#plan-steps').innerHTML = '';
    this.root.querySelector('#plan-empty').classList.remove('hidden');
    this._hideGate();
  },

  async _execute() {
    const body = this.root.querySelector('.plan-embed-body');
    const objective = body.querySelector('#plan-objective').value.trim();
    const payload = {};
    this._clearResults();
    this._setStatus('执行中…', 'info');
    body.querySelector('#plan-execute').disabled = true;
    try {
      if (objective) {
        payload.objective = objective;
      } else {
        const raw = body.querySelector('#plan-json').value.trim();
        if (!raw) { this._setStatus('请填写「自然语言目标」或「Plan JSON」', 'error'); return; }
        try { payload.plan = JSON.parse(raw); } catch (e) { this._setStatus('Plan JSON 解析失败：' + e.message, 'error'); return; }
      }
      // LLM 配置：优先表单值 → fallback Q.ChatAPI 同源（与聊天一致）
      const ak = body.querySelector('#plan-api-key').value.trim() || (Q.ChatAPI && Q.ChatAPI.getApiKey ? Q.ChatAPI.getApiKey() : '');
      if (ak) payload.apiKey = ak;
      const pv = body.querySelector('#plan-provider').value.trim() || (Q.ChatAPI && Q.ChatAPI.getProvider ? Q.ChatAPI.getProvider() : '');
      if (pv) payload.provider = pv;
      const bu = body.querySelector('#plan-base-url').value.trim() || (Q.ChatAPI && Q.ChatAPI.getBaseUrl ? Q.ChatAPI.getBaseUrl() : '');
      if (bu) payload.baseUrl = bu;
      const md = body.querySelector('#plan-model').value.trim() || (Q.ChatAPI && Q.ChatAPI.getModel ? Q.ChatAPI.getModel() : '');
      if (md) payload.model = md;
      // 讨论伙伴：从多选下拉读取
      const dd = body.querySelector('#plan-drawer-partner-dropdown');
      if (dd) {
        payload.partners = Array.from(dd.querySelectorAll('input[type="checkbox"]:checked'))
          .map((cb) => cb.dataset.id).filter(Boolean);
      }
      const ea = body.querySelector('#plan-exec-agent').value.trim();
      if (ea) payload.agentId = ea; // 'ai' 或外部 CLI agent id

      // 个性化权限下钻（与 plan.html 同源）
      const permsRaw = safeStorage.get('qcli-permissions', null);
      if (permsRaw) { try { const p = JSON.parse(permsRaw); if (p && typeof p === 'object') payload.permissions = p; } catch { /* ignore */ } }

      const res = await fetch('/api/plan/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      this.root.querySelector('#plan-empty').classList.add('hidden');
      if (!res.ok) { this._setStatus('请求失败：' + (data.error || res.status), 'error'); return; }
      const kind = data.status === 'done' ? 'ok' : (data.status === 'diverged' || data.status === 'rejected') ? 'error' : 'warn';
      let msg = '状态：' + data.status + (data.branch ? ' · 分支 ' + data.branch : '');
      if (data.missing && data.missing.length) msg += ' · 需补 acceptance: ' + data.missing.join(',');
      if (data.status === 'rejected') {
        msg += '\n💡 提示：Plan 缺少机器可验证的验收条件（acceptance）。';
        if (objective) msg += '\n   ① 点「载入示例」看完整格式  ② 在 JSON 中手动补充 acceptance 数组  ③ 检查聊天设置中的 API Key';
        else msg += '\n   请在 Plan JSON 中添加 acceptance 字段，例如：\n   "acceptance": [{ "id":"a1", "kind":"command", "command":"test -f 文件名", "expect":"" }]';
      } else if (data.status === 'diverged') {
        msg += '\n💡 提示：执行结果偏离预期。若已开启 autoReplan，系统将自动修订并重试。';
      }
      this._setStatus(msg, kind);
      this._renderReflection(data.reflection);
      this._renderSteps(data.steps);
      this._hideGate();
    } catch (e) {
      this._setStatus('网络/执行异常：' + e.message, 'error');
    } finally {
      body.querySelector('#plan-execute').disabled = false;
    }
  },

  // ── 审批闸 WS ──
  _connectWS() {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.planWs = new WebSocket(proto + '//' + location.host);
      this.planWs.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'plan:await-approval') { this.currentExecId = msg.execId; this._showGate(msg.step); }
        else if (msg.type === 'plan:approval-resolved' && msg.execId === this.currentExecId) {
          this._updateGateStatus(msg.approved ? '已通过，继续执行…' : (msg.timedOut ? '超时（视为驳回），已中止' : '已驳回，已中止'));
        }
      };
      this.planWs.onclose = () => { this.planWs = null; };
    } catch { /* WS 不可用则无闸门卡片 */ }
  },

  _showGate(step) {
    let gate = this.root.querySelector('#plan-approval-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'plan-approval-gate';
      gate.className = 'approval-gate hidden';
      gate.innerHTML =
        '<div class="ag-backdrop"></div>' +
        '<div class="ag-card"><div class="ag-title">审批闸 · 步骤需人工确认</div>' +
        '<div class="ag-step"></div><div class="ag-risk"></div>' +
        '<div class="ag-actions"><button id="plan-ag-approve" class="btn btn-primary" type="button">通过并执行</button>' +
        '<button id="plan-ag-reject" class="btn" type="button">驳回并中止</button></div>' +
        '<div class="ag-status"></div></div>';
      this.root.appendChild(gate);
      gate.querySelector('#plan-ag-approve').addEventListener('click', () => this._resolveGate('approve'));
      gate.querySelector('#plan-ag-reject').addEventListener('click', () => this._resolveGate('reject'));
    }
    gate.querySelector('.ag-step').textContent = (step.goal || step.id || '') + (step.action ? '  →  ' + step.action : '');
    gate.querySelector('.ag-risk').textContent = step.risk ? ('风险：' + step.risk) : '';
    gate.querySelector('.ag-status').textContent = '';
    gate.classList.remove('hidden');
  },

  _updateGateStatus(text) {
    const gate = this.root.querySelector('#plan-approval-gate');
    if (gate) gate.querySelector('.ag-status').textContent = text;
  },

  _hideGate() {
    const gate = this.root.querySelector('#plan-approval-gate');
    if (gate) gate.classList.add('hidden');
  },

  async _resolveGate(kind) {
    if (!this.currentExecId) return;
    this._updateGateStatus(kind === 'approve' ? '提交中…' : '驳回中…');
    try {
      const res = await fetch('/api/plan/' + encodeURIComponent(this.currentExecId) + '/' + kind, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) this._updateGateStatus('操作失败：' + (data.error || res.status));
    } catch (e) { this._updateGateStatus('网络异常：' + e.message); }
  },

  // ── 对外 API ──
  open() {
    this._ensureRendered();
    this._fillLLM(this.root.querySelector('.plan-embed-body')); // 每次打开重新同步聊天设置
  },
  close() {
    this._hideGate();
  },
};

Q.PlanDrawer = PlanDrawer;
export default PlanDrawer;
