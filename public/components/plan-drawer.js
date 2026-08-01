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
  // 5 字符完整转义（防 XSS）：与全局 esc 约定保持一致。esc() 结果会拼进 class="..."
  // 等属性上下文，只转义 & < > 时含 " 的内容可注入任意属性。
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PlanDrawer = {
  root: null,
  rendered: false,
  planWs: null,
  currentExecId: null,
  historyTimer: null,
  pendingExecId: null,
  discussMode: 'auto',

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
        <div class="plan-check-row" id="plan-discuss-row">
          <input type="checkbox" id="plan-discuss-before" />
          <span>先讨论再生成 Plan（下方所选伙伴会先进行圆桌讨论）</span>
        </div>
        <div class="adv-grid plan-discuss-opts disabled" id="plan-discuss-opts">
          <label>讨论模式
            <select id="plan-discuss-mode">
              <option value="auto" selected>auto（自动继续）</option>
              <option value="confirm">confirm（结束后等我确认 10 分钟）</option>
            </select>
          </label>
          <label>最多讨论轮数
            <input id="plan-discuss-turns" type="number" min="1" max="8" value="4" />
          </label>
        </div>
      </details>
      <div class="plan-actions">
        <button id="plan-load-sample" class="btn">载入示例</button>
        <button id="plan-format" class="btn">格式化</button>
        <button id="plan-execute" class="btn btn-primary">▶ 执行 plan</button>
        <button id="plan-history-open" class="btn">📚 历史 Plan</button>
      </div>
      <!-- 前置圆桌讨论舞台（M3）：实时展示讨论轮次、发言人、token 统计 -->
      <div id="plan-discussion-stage" class="plan-discussion-stage hidden">
        <div class="pd-stage-header">
          <span class="pd-stage-pulse"></span>
          <span class="pd-stage-title">🤝 圆桌讨论</span>
          <span class="pd-stage-status">准备中…</span>
        </div>
        <div class="pd-stage-progress"><div class="pd-stage-progress-bar"></div></div>
        <div class="pd-stage-meta"></div>
        <div class="pd-stage-log"></div>
        <div class="pd-stage-actions hidden">
          <button type="button" class="btn btn-primary pd-stage-continue">✅ 继续生成 Plan</button>
          <button type="button" class="btn pd-stage-cancel">❌ 取消</button>
        </div>
        <details class="pd-stage-summary hidden">
          <summary>讨论结论</summary>
          <div class="pd-stage-summary-body"></div>
        </details>
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
      <div id="plan-history-panel" class="pd-history hidden">
        <div class="pd-hist-bar">
          <input id="plan-history-search" class="pd-hist-search" placeholder="搜索目标 / 步骤 / 结论…" />
          <button id="plan-history-clear" class="pd-hist-btn" title="清空全部历史（需确认）">清空</button>
          <button id="plan-history-close" class="pd-hist-btn" title="关闭">✕</button>
        </div>
        <div class="pd-hist-hint">每次 Plan 执行后自动沉淀；点条目展开详情，可重新执行或删除。</div>
        <div id="plan-history-list" class="pd-hist-list"></div>
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
    // Plan 历史（从独立页 plan.html 移植，v0.6.5）
    body.querySelector('#plan-history-open').addEventListener('click', () => this._openHistory());
    body.querySelector('#plan-history-close').addEventListener('click', () => this._closeHistory());
    body.querySelector('#plan-history-search').addEventListener('input', (e) => this._onHistorySearch(e));
    body.querySelector('#plan-history-clear').addEventListener('click', () => this._clearHistory());
    // 自动填充 LLM（同源）
    this._fillLLM(body);
    // 执行 Agent 下拉
    this._loadExecAgentOptions(body);
    // 讨论伙伴多选（M3）
    this._loadPartnerOptions(body);
    // 讨论开关：默认 auto 模式，避免 confirm 挂起 HTTP 导致 UI 卡死
    this._wireDiscussToggle(body);
    // LLM 字段持久化（与「设置 → AI」同 key：qcli-ai-*）
    this._wireLLMPersist(body);
    // 审批闸 WS
    this._connectWS();
    // 结果摘要与步骤的复制按钮（事件委托）
    body.querySelector('#plan-reflection').addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-ref');
      if (btn && btn.dataset.copyText) this._copyText(btn.dataset.copyText, btn);
    });
    body.querySelector('#plan-steps').addEventListener('click', (e) => {
      const artifact = e.target.closest('.step-artifact');
      if (artifact) { this._copyText(artifact.textContent, artifact); return; }
      const btn = e.target.closest('.step-copy');
      if (btn && btn.dataset.copyText) this._copyText(btn.dataset.copyText, btn);
    });
    // 前置讨论确认闸（confirm 模式）
    const stage = body.querySelector('#plan-discussion-stage');
    if (stage) {
      stage.querySelector('.pd-stage-continue')?.addEventListener('click', () => this._confirmDiscussion());
      stage.querySelector('.pd-stage-cancel')?.addEventListener('click', () => this._cancelDiscussion());
    }
    this.rendered = true;
  },

  _copyText(text, triggerEl) {
    const write = async () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy failed');
      }
    };
    write().then(() => {
      if (triggerEl && triggerEl.tagName === 'BUTTON') {
        const old = triggerEl.textContent;
        triggerEl.textContent = '✓';
        setTimeout(() => { triggerEl.textContent = old; }, 1200);
      } else {
        this._setStatus('已复制到剪贴板', 'ok');
      }
    }).catch(() => {
      this._setStatus('复制失败，请手动选择文本复制', 'warn');
    });
  },

  /** 生成请求级 execId，前后端 WS 事件关联用 */
  _uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  /** 讨论开关：勾选后才把 discussBeforePlan 等字段打进 /api/plan/execute */
  _wireDiscussToggle(body) {
    const cb = body.querySelector('#plan-discuss-before');
    const opts = body.querySelector('#plan-discuss-opts');
    const mode = body.querySelector('#plan-discuss-mode');
    if (!cb || !opts) return;
    const apply = () => {
      const on = cb.checked;
      opts.classList.toggle('disabled', !on);
      if (on) {
        // 默认 UI 用 auto，避免 confirm 模式挂起 HTTP 10 分钟让新手困惑
        if (!mode.value) mode.value = 'auto';
        safeStorage.set('qcli-plan-discuss-before', '1');
      } else {
        safeStorage.set('qcli-plan-discuss-before', '0');
      }
    };
    cb.addEventListener('change', apply);
    // 恢复上次状态
    cb.checked = safeStorage.get('qcli-plan-discuss-before') === '1';
    apply();
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

  /** 讨论伙伴多选（M3）：复用 PartnerStore 共享状态（聊天面板/Plan 页同步） */
  _loadPartnerOptions(body) {
    const PS = window.PartnerStore;
    const btn = body.querySelector('#plan-drawer-partner-btn');
    const dd = body.querySelector('#plan-drawer-partner-dropdown');
    if (!btn || !dd) return;

    // 同步挂载 handler（不等 await，根治「点不开」）
    btn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => {
      if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) dd.classList.add('hidden');
    });

    const nameMap = new Map();
    const updateLabel = () => {
      const checked = Array.from(dd.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.dataset.id);
      if (!checked.length) { btn.textContent = '选择讨论伙伴 ▾'; btn.classList.add('placeholder'); }
      else if (checked.length === 1) { btn.textContent = (nameMap.get(checked[0]) || checked[0]) + ' ▾'; btn.classList.remove('placeholder'); }
      else { btn.textContent = `已选 ${checked.length} 个伙伴 ▾`; btn.classList.remove('placeholder'); }
    };

    if (!PS) { dd.innerHTML = '<div class="discuss-dropdown-empty">伙伴模块未加载</div>'; return; }
    PS.loadPartnerSource().then(({ list, favSet }) => {
      dd.innerHTML = '';
      if (!list.length) { dd.innerHTML = '<div class="discuss-dropdown-empty">未发现可用 CLI Agent</div>'; return; }
      const availableFavs = list.filter((a) => favSet.has(a.id)).length;
      if (availableFavs > 0) {
        const hint = document.createElement('div');
        hint.className = 'discuss-fav-hint';
        hint.textContent = `★ 已与收藏夹同步（${availableFavs} 个）`;
        dd.appendChild(hint);
      }
      const checked = new Set(PS.getPartners());
      list.forEach((a) => {
        const isFav = favSet.has(a.id);
        nameMap.set(a.id, a.name);
        const label = document.createElement('label');
        label.className = 'discuss-option' + (isFav ? ' favorited' : '');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.id = a.id;
        if (isFav || checked.has(a.id)) cb.checked = true; // 收藏夹 + 共享 store 同步
        label.appendChild(cb);
        const star = document.createElement('span');
        star.className = 'discuss-fav-star';
        star.textContent = isFav ? '★ ' : '';
        label.appendChild(star);
        label.appendChild(document.createTextNode(a.name + (a.version ? ' · ' + a.version : '')));
        dd.appendChild(label);
      });
      updateLabel();
    }).catch(() => { dd.innerHTML = '<div class="discuss-dropdown-empty">加载失败，请检查网络</div>'; });

    dd.addEventListener('change', () => {
      const ids = Array.from(dd.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.dataset.id);
      PS.setPartners(ids);
      updateLabel();
    });
    PS.subscribe((ids) => {
      dd.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = ids.indexOf(cb.dataset.id) !== -1; });
      updateLabel();
    });
  },

  /** LLM 字段持久化（抽屉）：与「设置 → AI」同 key（qcli-ai-*） */
  _wireLLMPersist(body) {
    const fields = [
      ['#plan-api-key', 'qcli-ai-key'],
      ['#plan-provider', 'qcli-ai-provider'],
      ['#plan-base-url', 'qcli-ai-base-url'],
      ['#plan-model', 'qcli-ai-model'],
    ];
    fields.forEach(([sel, key]) => {
      const el = body.querySelector(sel);
      if (!el) return;
      const save = () => { try { localStorage.setItem(key, el.value); } catch { /* ignore */ } };
      el.addEventListener('input', save);
      el.addEventListener('change', save);
    });
    window.addEventListener('storage', (e) => {
      if (!e.key || e.key.indexOf('qcli-ai-') !== 0) return;
      const m = fields.find(([, k]) => k === e.key);
      if (!m) return;
      const el = body.querySelector(m[0]);
      if (el && document.activeElement !== el) el.value = e.newValue || '';
    });
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
    const lines = [
      '状态: ' + (r.status || '—'),
      '步完成: ' + (r.stepsDone || 0) + '/' + (r.stepsTotal || 0),
      '验收通过率: ' + rate,
      r.budget ? '轮数: ' + (r.budget.rounds || 0) : '',
      r.reason ? '说明: ' + r.reason : '',
    ].filter(Boolean).join('\n');
    el.className = 'reflection';
    el.innerHTML =
      '<button type="button" class="btn btn-ghost copy-ref" title="复制结果摘要" data-copy-text="' + esc(lines) + '">📋 复制摘要</button>' +
      '<div class="ref-card"><span class="ref-k">状态</span><span class="ref-v">' + esc(r.status) + '</span></div>' +
      '<div class="ref-card"><span class="ref-k">步完成</span><span class="ref-v">' + (r.stepsDone || 0) + '/' + (r.stepsTotal || 0) + '</span></div>' +
      '<div class="ref-card"><span class="ref-k">验收通过率</span><span class="ref-v">' + rate + '</span></div>' +
      (r.budget ? '<div class="ref-card"><span class="ref-k">轮数</span><span class="ref-v">' + (r.budget.rounds || 0) + '</span></div>' : '') +
      (r.reason ? '<div class="ref-card ref-full"><span class="ref-k">说明</span><span class="ref-v">' + esc(r.reason) + '</span></div>' : '');
    el.classList.remove('hidden');
  },

  _highlightArtifacts(text) {
    // 高亮输出中的产物路径（/tmp/...、/home/...、C:\... 等），并支持点击复制
    return esc(text).replace(
      /(\/tmp\/[^\s\"'<>\n]+|\/home\/[^\s\"'<>\n]+|(?:[A-Za-z]:[\\/]|\\\\)[^\s\"'<>\n]+)/g,
      '<span class="step-artifact" title="点击复制路径">$1</span>'
    );
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
      const copyText = [
        '步骤 ' + (i + 1) + ': ' + (s.goal || s.id),
        s.action ? '命令: ' + s.action : '',
        '状态: ' + (s.status || '?'),
        s.reason ? '原因: ' + s.reason : '',
        s.output ? '输出:\n' + s.output : '',
      ].filter(Boolean).join('\n');
      const out = s.output ? '<pre class="step-out">' + this._highlightArtifacts(s.output.slice(0, 600)) + '</pre>' : '';
      const snap = s.snapshot ? '<div class="step-snap">快照 ' + esc(s.snapshot.slice(0, 8)) + '</div>' : '';
      div.innerHTML =
        '<div class="step-head"><span class="step-idx">' + (i + 1) + '</span>' +
        '<span class="step-goal">' + esc(s.goal || s.id) + '</span>' +
        '<span class="step-badge">' + esc(s.status || '?') + '</span>' +
        '<button type="button" class="btn btn-ghost step-copy" title="复制步骤" data-copy-text="' + esc(copyText) + '">📋</button></div>' +
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
      // 讨论开关（M3）：勾选后才发送 discussBeforePlan，默认 auto 模式避免 confirm 挂起
      const discussBefore = body.querySelector('#plan-discuss-before')?.checked;
      if (discussBefore) {
        payload.discussBeforePlan = true;
        payload.discussMode = body.querySelector('#plan-discuss-mode')?.value || 'auto';
        const turns = Number(body.querySelector('#plan-discuss-turns')?.value || 4);
        payload.discussMaxTurns = Number.isFinite(turns) && turns > 0 ? Math.min(turns, 8) : 4;
      }
      // 用统一 execId 关联后端 WS 事件，让前端能实时渲染讨论舞台
      const execId = this._uuid();
      this.pendingExecId = execId;
      payload.execId = execId;
      this.discussMode = discussBefore ? (payload.discussMode || 'auto') : 'auto';
      // 后端只在「有自然语言目标、未手写 plan、且选了伙伴」时才真正跑讨论
      if (discussBefore && objective) {
        this._showDiscussionStage({
          partners: payload.partners || [],
          maxTurns: payload.discussMaxTurns || 4,
          mode: this.discussMode,
        });
      } else {
        this._hideDiscussionStage();
      }
      const ea = body.querySelector('#plan-exec-agent').value.trim();
      if (ea) payload.agentId = ea; // 'ai' 或外部 CLI agent id

      // 执行器选了外部 CLI agent 时，自动并入讨论伙伴：避免「只设了执行器、漏勾讨论伙伴下拉」
      // 导致该 CLI agent 只跑步骤、却不进圆桌讨论（表现为「讨论没与 CLI agent 沟通」）。
      // 'ai' 不并入（AI 助手不是可勾选的 CLI 伙伴）；已勾选则不重复添加。
      if (ea && ea !== 'ai' && (!Array.isArray(payload.partners) || !payload.partners.includes(ea))) {
        payload.partners = Array.isArray(payload.partners) ? payload.partners : [];
        payload.partners.push(ea);
        if (dd) {
          const cb = dd.querySelector(`input[type="checkbox"][data-id="${ea}"]`);
          if (cb) { cb.checked = true; }
        }
      }

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
      if (data.status === 'discussion-cancelled') {
        this._setStageStatus('已取消：讨论后未确认执行');
        this._setStatus('已取消：讨论后未确认执行', 'warn');
        return;
      }
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
      // 执行已结束（无论成功/失败/驳回），关闭实时讨论舞台，避免 M3/checkpoint
      // 讨论舞台卡在「讨论进行中…」而执行结果已经 done 的状态不同步。
      this._hideDiscussionStage();
    } catch (e) {
      this._setStatus('网络/执行异常：' + e.message, 'error');
      this._hideDiscussionStage();
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
        // 前置圆桌讨论实时事件（与本次 execute 的 execId 关联）
        else if (this.pendingExecId && msg.execId === this.pendingExecId
          && (msg.type.startsWith('plan:discuss') || msg.type.startsWith('plan:discussion'))) {
          this._onDiscussionEvent(msg.type, msg);
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

  // ── 前置圆桌讨论舞台（M3 实时可视化）──
  _showDiscussionStage({ partners, maxTurns, mode }) {
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (!stage) return;
    stage.classList.remove('hidden');
    stage.querySelector('.pd-stage-status').textContent = '准备开始…';
    stage.querySelector('.pd-stage-progress-bar').style.width = '0%';
    stage.querySelector('.pd-stage-meta').textContent =
      `模式：${mode === 'confirm' ? '确认后生成' : '自动继续'} · 最多 ${maxTurns} 轮 · 伙伴：${(partners || []).join(' / ') || '未选'}`;
    stage.querySelector('.pd-stage-log').innerHTML = '';
    stage.querySelector('.pd-stage-actions').classList.add('hidden');
    stage.querySelector('.pd-stage-summary').classList.add('hidden');
    stage.querySelector('.pd-stage-summary-body').textContent = '';
    this._discussCurrentBubble = null;
    // 立即滚动到舞台，让用户明确感知讨论已开始
    try { stage.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
  },

  _hideDiscussionStage() {
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (stage) stage.classList.add('hidden');
    this._discussCurrentBubble = null;
  },

  _setStageStatus(text) {
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (!stage) return;
    stage.querySelector('.pd-stage-status').textContent = text;
    // 尝试从 status 文本里解析「第 x/y 轮」来更新进度条
    const m = text.match(/第\s*(\d+)\s*\/\s*(\d+)\s*轮/);
    if (m) {
      const [, cur, total] = m;
      const pct = total > 0 ? Math.min(100, Math.max(0, (Number(cur) / Number(total)) * 100)) : 0;
      stage.querySelector('.pd-stage-progress-bar').style.width = pct + '%';
    }
  },

  _addStageBubble({ speaker, label, round }) {
    const log = this.root.querySelector('#plan-discussion-stage .pd-stage-log');
    if (!log) return null;
    const wrap = document.createElement('div');
    wrap.className = 'pd-bubble pd-bubble-' + esc(speaker);
    wrap.dataset.speaker = speaker;
    const header = document.createElement('div');
    header.className = 'pd-bubble-head';
    const icon = speaker === 'ai' ? '🧠' : (speaker === 'summary' ? '📋' : '🤖');
    header.textContent = `${icon} ${esc(label || speaker)} · 第 ${round || '?'} 轮`;
    const content = document.createElement('pre');
    content.className = 'pd-bubble-content';
    wrap.appendChild(header);
    wrap.appendChild(content);
    log.appendChild(wrap);
    this._discussCurrentBubble = content;
    this._stageScrollToBottom();
    return content;
  },

  _stageScrollToBottom() {
    const log = this.root.querySelector('#plan-discussion-stage .pd-stage-log');
    if (log) { try { log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }); } catch { log.scrollTop = log.scrollHeight; } }
  },

  _formatStageStats(stats) {
    if (!stats) return '';
    const parts = [];
    if (stats.rounds != null) parts.push(`实际 ${stats.rounds} 轮`);
    if (stats.aiInputTokens != null) parts.push(`AI 输入 ${stats.aiInputTokens.toLocaleString()} tokens`);
    if (stats.aiOutputTokens != null) parts.push(`AI 输出 ${stats.aiOutputTokens.toLocaleString()} tokens`);
    if (stats.cacheHitRate != null) parts.push(`缓存命中 ${Math.round(stats.cacheHitRate * 100)}%`);
    if (stats.cliOutputChars != null) parts.push(`CLI 输出 ${stats.cliOutputChars.toLocaleString()} 字符`);
    return parts.join(' · ');
  },

  _onDiscussionEvent(type, msg) {
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (!stage) return;
    // 执行阶段（非 M3 前置讨论）的 checkpoint 圆桌：后端只发 plan:discuss-* 更新事件、
    // 不发 plan:discussion-start，这里兜底——只要收到任意讨论事件且舞台还藏着，就显示出来。
    // （M3 前置讨论已在点击「执行」时通过 _showDiscussionStage 显示，不会走到此分支。）
    if (stage.classList.contains('hidden')
      && (type.startsWith('plan:discuss') || type.startsWith('plan:discussion'))) {
      this._showDiscussionStage({
        partners: msg.partners,
        maxTurns: msg.maxTurns || 3,
        mode: msg.mode || 'auto',
      });
    }
    switch (type) {
      case 'plan:discussion-start': {
        stage.classList.remove('hidden');
        this._setStageStatus('讨论开始');
        break;
      }
      case 'plan:discussion-shared': {
        this._setStageStatus('复用进行中的讨论…');
        break;
      }
      case 'plan:discuss-status': {
        if (msg.message) this._setStageStatus(msg.message);
        break;
      }
      case 'plan:discuss-discuss_start': {
        this._addStageBubble({ speaker: msg.speaker, label: msg.label, round: msg.round });
        break;
      }
      case 'plan:discuss-token': {
        if (this._discussCurrentBubble && msg.content != null) {
          this._discussCurrentBubble.textContent += msg.content;
          this._stageScrollToBottom();
        }
        break;
      }
      case 'plan:discuss-discuss_end': {
        this._discussCurrentBubble = null;
        break;
      }
      case 'plan:discuss-discuss_stats': {
        const meta = stage.querySelector('.pd-stage-meta');
        const statsLine = this._formatStageStats(msg.stats);
        if (statsLine) meta.textContent = statsLine;
        break;
      }
      case 'plan:discussion-result': {
        this._setStageStatus('讨论完成');
        const summary = msg.summary || '';
        const summaryEl = stage.querySelector('.pd-stage-summary');
        const summaryBody = stage.querySelector('.pd-stage-summary-body');
        summaryBody.textContent = summary;
        summaryEl.classList.remove('hidden');
        if (this.discussMode === 'confirm') {
          stage.querySelector('.pd-stage-actions').classList.remove('hidden');
          this._setStageStatus('讨论完成，等待你确认是否继续生成 Plan');
        } else {
          this._setStageStatus('讨论完成，正在生成 Plan…');
        }
        break;
      }
      case 'plan:discussion-error': {
        this._setStageStatus('讨论出错：' + (msg.message || '未知错误'));
        break;
      }
      case 'plan:discussion-confirmed': {
        stage.querySelector('.pd-stage-actions').classList.add('hidden');
        this._setStageStatus('已确认，继续生成 Plan…');
        break;
      }
      case 'plan:discussion-cancelled': {
        stage.querySelector('.pd-stage-actions').classList.add('hidden');
        this._setStageStatus('已取消');
        break;
      }
      case 'plan:discussion-timeout': {
        stage.querySelector('.pd-stage-actions').classList.add('hidden');
        this._setStageStatus('确认超时，自动继续生成 Plan…');
        break;
      }
      default: break;
    }
  },

  async _confirmDiscussion() {
    if (!this.pendingExecId) return;
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (stage) {
      stage.querySelector('.pd-stage-actions').classList.add('hidden');
      this._setStageStatus('提交确认中…');
    }
    try {
      const res = await fetch('/api/plan/discuss/' + encodeURIComponent(this.pendingExecId) + '/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) this._setStageStatus('确认失败：' + (data.error || res.status));
    } catch (e) { this._setStageStatus('确认异常：' + e.message); }
  },

  async _cancelDiscussion() {
    if (!this.pendingExecId) return;
    const stage = this.root.querySelector('#plan-discussion-stage');
    if (stage) {
      stage.querySelector('.pd-stage-actions').classList.add('hidden');
      this._setStageStatus('取消中…');
    }
    try {
      const res = await fetch('/api/plan/discuss/' + encodeURIComponent(this.pendingExecId) + '/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) this._setStageStatus('取消失败：' + (data.error || res.status));
    } catch (e) { this._setStageStatus('取消异常：' + e.message); }
  },

  // ── Plan 历史（从独立页 plan.html 移植，v0.6.5）──
  _openHistory() {
    const p = this.root.querySelector('#plan-history-panel');
    if (p) p.classList.remove('hidden');
    const btn = this.root.querySelector('#plan-history-open');
    if (btn) btn.classList.add('active');
    // 面板位于滚动容器最底部（空状态卡片之后），不滚动的话用户完全看不到展开 → 体感"点击没反应"。
    if (p) {
      try {
        p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch { /* 旧浏览器不支持 scrollIntoView options，忽略 */ }
    }
    this._loadHistory('');
  },
  _closeHistory() {
    const p = this.root.querySelector('#plan-history-panel');
    if (p) p.classList.add('hidden');
    const btn = this.root.querySelector('#plan-history-open');
    if (btn) btn.classList.remove('active');
  },
  _onHistorySearch(e) {
    clearTimeout(this.historyTimer);
    const q = e.target.value.trim();
    this.historyTimer = setTimeout(() => this._loadHistory(q), 250);
  },
  async _loadHistory(q) {
    const list = this.root.querySelector('#plan-history-list');
    if (!list) return;
    list.innerHTML = '<div class="pd-hist-loading">加载中…</div>';
    try {
      const url = q
        ? `/api/plan/history/search?q=${encodeURIComponent(q)}&topK=15`
        : '/api/plan/history?limit=50';
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        list.innerHTML = `<div class="pd-hist-err">${esc(data.error || '加载失败')}</div>`;
        return;
      }
      // 方案 A：历史列表只渲染 plan（搜索端点现返回 {items,plans,roundtables}，
      // 圆桌条目 shape 不同、当前无对应 UI，须排除避免渲染垃圾；roundtables 留待后续 UI）。
      const items = data.plans || data.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="pd-hist-empty">暂无历史 Plan 记录。执行 Plan 后会自动沉淀到这里。</div>';
        return;
      }
      list.innerHTML = '';
      for (const it of items) {
        const meta = it.meta || {};
        // 三态：有 meta.status → ok/fail；无（v0.6.3 之前沉淀的旧记录）→ unknown，避免一律染红
        const hasStatus = typeof meta.status === 'string' && !!meta.status;
        const statusCls = hasStatus ? (meta.ok ? 'ok' : 'fail') : 'unknown';
        const statusText = hasStatus ? meta.status : '无记录';
        const dur = (meta.startedAt && meta.endedAt)
          ? ((new Date(meta.endedAt) - new Date(meta.startedAt)) / 1000).toFixed(1)
          : '';
        const when = meta.endedAt ? String(meta.endedAt).slice(0, 19).replace('T', ' ') : '';
        const bits = [];
        if (dur) bits.push(`⏱ ${esc(dur)}s`);
        if (meta.agentId) bits.push(`🤖 ${esc(meta.agentId)}`);
        if (when) bits.push(`🕒 ${esc(when)}`);
        const metaLine = bits.length
          ? bits.join(' · ')
          : '<span class="pd-hist-legacy">早期记录 · 无执行元信息</span>';
        const div = document.createElement('div');
        div.className = 'pd-hist-item';
        div.innerHTML =
          '<div class="pd-hi-head">' +
            `<span class="pd-hi-title">${esc(it.title || it.ref)}</span>` +
            `<span class="pd-hi-status ${statusCls}">${esc(statusText)}</span>` +
          '</div>' +
          `<div class="pd-hi-meta">${metaLine}</div>` +
          '<div class="pd-hi-actions">' +
            '<button class="pd-hi-btn pd-hi-run">↻ 重新执行</button>' +
            '<button class="pd-hi-btn pd-hi-del">🗑 删除</button>' +
          '</div>' +
          '<pre class="pd-hi-detail hidden"></pre>';
        div.querySelector('.pd-hi-head').addEventListener('click', () => {
          const d = div.querySelector('.pd-hi-detail');
          d.textContent = it.text || '';
          d.classList.toggle('hidden');
        });
        div.querySelector('.pd-hi-run').addEventListener('click', (e) => { e.stopPropagation(); this._rerunHistory(it); });
        div.querySelector('.pd-hi-del').addEventListener('click', (e) => { e.stopPropagation(); this._deleteHistory(it.ref, div); });
        list.appendChild(div);
      }
    } catch (e) {
      list.innerHTML = `<div class="pd-hist-err">加载失败：${esc(e.message)}</div>`;
    } finally {
      // 列表是异步渲染的：_openHistory 里的 scrollIntoView 执行时面板高度尚未定型，
      // 等这里渲染完高度才固定 → 再滚一次，确保整个面板完整进入视口（否则底部被截断）。
      const p = this.root.querySelector('#plan-history-panel');
      if (p) {
        try {
          p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch { /* 旧浏览器不支持 scrollIntoView options，忽略 */ }
      }
    }
  },
  _rerunHistory(it) {
    const plan = it.meta && it.meta.plan;
    const objEl = this.root.querySelector('#plan-objective');
    const jsonEl = this.root.querySelector('#plan-json');
    if (plan && typeof plan === 'object') {
      objEl.value = '';
      jsonEl.value = JSON.stringify(plan, null, 2);
    } else if (it.title) {
      objEl.value = it.title;
      jsonEl.value = '';
    }
    this._closeHistory();
    this._setStatus('已把历史 Plan 填入输入框，点「执行 plan」重试。', 'info');
    jsonEl.scrollIntoView({ behavior: 'smooth' });
  },
  async _deleteHistory(ref, div) {
    if (!confirm(`确认删除历史记录 ${ref}？`)) return;
    try {
      const resp = await fetch(`/api/plan/history/${encodeURIComponent(ref)}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.ok) { div.remove(); this._setStatus('已删除该历史记录', 'info'); }
      else this._setStatus('删除失败：' + (data.error || ''), 'error');
    } catch (e) { this._setStatus('删除失败：' + e.message, 'error'); }
  },
  async _clearHistory() {
    if (!confirm('确认清空全部历史 Plan 记录？此操作不可恢复。')) return;
    try {
      const resp = await fetch('/api/plan/history', { method: 'DELETE' });
      const data = await resp.json();
      if (data.ok) { this._loadHistory(''); this._setStatus('已清空历史记录', 'info'); }
      else this._setStatus('清空失败：' + (data.error || ''), 'error');
    } catch (e) { this._setStatus('清空失败：' + e.message, 'error'); }
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
