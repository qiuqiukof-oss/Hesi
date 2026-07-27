// @ts-check
// ============================================================
// 围炉圆桌 · 视图渲染器（懒加载，进 lazy bundle）
//
// 统一架构：圆桌 = AI讨论 的一种「视图」。引擎复用 chat-panel 的
// Q.ChatAPI.sendMessage（discuss 模式），本模块只负责把归一化后的
// discuss 事件（onToken / onDiscuss / onDone / onError / onStatus）
// 渲染成席位 SVG + 气泡 + 纪要。不再自持 fetch/SSE。
//
// 容器：主应用 #mahjong-embed 抽屉内的 #rt（席位区）及配套控件。
// 通过 window.QCLI.RoundTableView.{open,close,setSkin} 由 chat-panel 调起。
// ============================================================
'use strict';

import {
  AGENT_ROSTER,
  STATUS_META,
  renderAvatarInner,
  statusClass,
  applyOverrides,
} from './agent-avatars.js';
import { SKINS, applySkin, getSkin } from './roundtable-skins.js';

/** @type {any} */
const Q = window.QCLI = window.QCLI || {};

// 座位几何：主持人上首，4 Agent 分居四角并向外扩，给中心桌布与气泡留足空间。
const SEAT_POS = {
  host:  { style: 'left:50%;top:14px;transform:translateX(-50%)' },
  fox:   { style: 'left:30px;top:215px' },
  panda: { style: 'right:30px;top:215px' },
  owl:   { style: 'left:30px;top:445px' },
  bunny: { style: 'right:30px;top:445px' },
};
// 讨论参与者（AI 助手 + 各 CLI）按顺序映射到这 4 个席位。
const AGENT_SEAT_ORDER = ['fox', 'panda', 'owl', 'bunny'];

function getStore() {
  if (Q.safeStorage) return Q.safeStorage;
  return {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } },
  };
}

function getFavorites() {
  try {
    const raw = localStorage.getItem('qcli-favorites');
    if (!raw) return [];
    return JSON.parse(raw).filter((x) => typeof x === 'string');
  } catch { return []; }
}

// 讨论轮数：读取下拉值，钳制到后端允许范围 [1,12]，并持久化记忆。
function getRounds() {
  const sel = document.getElementById('rounds');
  let v = parseInt(sel && sel.value, 10);
  if (!Number.isFinite(v)) v = 6;
  v = Math.min(Math.max(v, 1), 12);
  try { getStore().set('qcli-roundtable-rounds', String(v)); } catch { /* ignore */ }
  return v;
}

const RoundTableView = {
  root: null,
  rt: null,
  roster: [],
  host: null,
  protocol: '',
  availableClis: [],
  allClisById: {},   // 全量 registry（含 tool/directory 类），供收藏夹解析与标签显示
  overrides: {},
  seats: {},          // seatId -> { el, avEl, nameEl, roleEl, stEl, bubEl, likeEl, likes, empty }
  selected: [],       // 选中的 CLI id 列表
  participantSeats: {}, // speaker label -> seatId（讨论期间）
  activeSeat: null,
  transcript: [],     // [{label, text}]
  stats: null,
  topic: '',
  sessionId: '',
  running: false,
  _stateLoaded: false,

  init() {
    this.root = document.getElementById('rt');
    if (!this.root) return;
    this.rt = this.root;
    this.skin = this.resolveSkin();
    this.skinObj = getSkin(this.skin);
    applySkin(this.rt, this.skin);
    this.sessionId = this.resolveSession();
    this.bindStaticUI();
    this.fetchState();
    this._stateLoaded = true;
  },

  resolveSkin() {
    try {
      const stored = getStore().get('qcli-roundtable-skin', 'hearth');
      if (stored && SKINS[stored]) return stored;
    } catch { /* ignore */ }
    return 'hearth';
  },

  setSkin(id) {
    if (!SKINS[id]) return;
    this.skin = id;
    this.skinObj = getSkin(id);
    applySkin(this.rt, id);
    try { getStore().set('qcli-roundtable-skin', id); } catch { /* ignore */ }
    this.updateSkinSwitch();
  },

  updateSkinSwitch() {
    document.querySelectorAll('[data-skin]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-skin') === this.skin);
    });
  },

  resolveSession() {
    const s = getStore();
    let id = s.get('qcli-roundtable-session', '');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'rt-' + Date.now()); s.set('qcli-roundtable-session', id); }
    return id;
  },

  bindStaticUI() {
    const $ = (id) => document.getElementById(id);
    this.elTopic = $('topic');
    this.elRounds = $('rounds');
    try {
      const saved = getStore().get('qcli-roundtable-rounds', '');
      if (saved && this.elRounds.querySelector(`option[value="${saved}"]`)) {
        this.elRounds.value = saved;
      }
    } catch { /* ignore */ }
    this.elCliList = $('clilist');
    this.elStart = $('startBtn');
    this.elExport = $('exportBtn');
    this.elSave = $('saveBtn');
    this.elCustom = $('customBtn');
    this.elHideEmpty = $('hideEmpty');
    this.elProtocol = $('protocolTip');
    this.elSession = $('sessionTip');
    this.elMemo = $('memo');
    this.elMemoBody = $('memoBody');
    this.elModal = $('modal');
    this.elModalBody = $('modalBody');
    this.elToast = $('toast');

    if (this.elStart) this.elStart.addEventListener('click', () => this.start());
    if (this.elExport) this.elExport.addEventListener('click', () => this.exportMemo());
    if (this.elSave) this.elSave.addEventListener('click', () => this.saveToConversation());
    if (this.elCustom) this.elCustom.addEventListener('click', () => this.openCustomize());
    document.querySelectorAll('[data-skin]').forEach((btn) => {
      btn.addEventListener('click', () => this.setSkin(btn.getAttribute('data-skin')));
    });
    this.updateSkinSwitch();
    if (this.elHideEmpty) {
      this.elHideEmpty.addEventListener('change', () => {
        this.rt.classList.toggle('hide-empty', !this.elHideEmpty.checked);
      });
    }
    // 模态保存/取消
    const modalSave = document.getElementById('modalSave');
    if (modalSave) modalSave.addEventListener('click', () => this.saveCustomize());
    const modalCancel = document.getElementById('modalCancel');
    if (modalCancel) modalCancel.addEventListener('click', () => this.closeCustomize());
    if (this.elModal) {
      this.elModal.addEventListener('click', (e) => { if (e.target.id === 'modal') this.closeCustomize(); });
    }
    // 会话提示卡片
    this.renderSessionCard({ saved: false });
  },

  renderSessionCard({ saved = false } = {}) {
    if (!this.elSession) return;
    const short = this.sessionId.slice(0, 8);
    const icon = saved ? '✅' : '📋';
    const title = saved ? '已保存到会话' : '纪要将保存到会话';
    this.elSession.innerHTML = `
      <div class="session-card">
        <span class="sc-icon">${icon}</span>
        <div class="sc-body">
          <span class="sc-title">${title}</span>
          <span class="sc-id">${short}… · 聊天用 ?sessionId=${this.sessionId}</span>
        </div>
        <span class="sc-actions">
          <button class="sc-copy" data-sid="${this.esc(this.sessionId)}" title="复制 sessionId">复制</button>
          <a class="sc-open" href="/index.html?sessionId=${encodeURIComponent(this.sessionId)}" target="_blank" rel="noopener noreferrer" title="新标签页打开该会话">打开</a>
        </span>
      </div>`;
    const copyBtn = this.elSession.querySelector('.sc-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const sid = copyBtn.getAttribute('data-sid');
        navigator.clipboard.writeText(sid).then(() => this.toast('sessionId 已复制'))
          .catch(() => this.toast('复制失败，可手动选中文本'));
      });
    }
  },

  async fetchState() {
    try {
      const r = await fetch('/api/roundtable/state');
      const st = await r.json();
      this.overrides = st.overrides || {};
      this.availableClis = st.availableClis || [];
      this.protocol = st.protocol || '';
      const rawHost = st.host || {
        id: 'host',
        name: 'AI 助手 · 主持人',
        roleLabel: 'Moderator',
        avatar: { type: 'emoji', value: '🤖' },
      };
      this.host = {
        ...rawHost,
        roleLabel: rawHost.roleLabel || rawHost.role || 'Moderator',
      };
      this.roster = applyOverrides(AGENT_ROSTER, this.overrides);
      // 全量 registry（含被识别为 tool/directory 的 CLI），供收藏夹解析与显示名
      try {
        const cr = await fetch('/api/clis');
        const cj = await cr.json();
        const map = {};
        (cj.clis || []).forEach((c) => { map[c.id] = c; });
        this.allClisById = map;
      } catch { /* ignore */ }
      if (st.blackboard) {
        const b = st.blackboard;
        const tasks = Array.isArray(b.tasks) ? b.tasks.length : (b.tasks ? Object.keys(b.tasks).length : 0);
        const files = b.files ? Object.keys(b.files).length : 0;
        const bbTasks = document.getElementById('bbTasks');
        const bbRound = document.getElementById('bbRound');
        const bbFiles = document.getElementById('bbFiles');
        if (bbTasks) bbTasks.textContent = `任务 ${tasks} · 文件 ${files}`;
        if (bbRound) bbRound.textContent = `第 ${b.round || 0} 回合`;
        if (bbFiles) bbFiles.textContent = '黑板已活跃';
      }
      if (this.elProtocol) this.elProtocol.textContent = this.protocol ? '协议：' + this.protocol : '';
      this.renderCliList();
      this.renderSeats();
    } catch (e) {
      this.toast('加载状态失败：' + e.message);
    }
  },

  // CLI 显示名解析：优先全量 registry（含 tool/directory 类收藏项），回落 availableClis，再回落 id
  cliLabel(id) {
    const full = this.allClisById && this.allClisById[id];
    if (full) return full.displayName || full.name;
    const c = this.availableClis.find((x) => x.id === id);
    return c ? (c.displayName || c.name) : id;
  },

  renderCliList() {
    const favs = new Set(getFavorites());
    const byId = this.allClisById || {};
    // 可选项 = 过滤出的 agent/manual + 收藏夹中存在于全量 registry 的项
    const present = new Map(this.availableClis.map((c) => [c.id, c]));
    const selectable = [...this.availableClis];
    const unknownFavs = [];
    for (const id of favs) {
      if (present.has(id)) continue;
      const c = byId[id];
      if (c) {
        if (!selectable.some((x) => x.id === id)) {
          selectable.push({ id: c.id, name: c.name, displayName: c.displayName || c.name, category: c.category, discovered: c.discovered });
        }
      } else {
        unknownFavs.push(id);
      }
    }
    if (!this.elCliList) return;
    if (!selectable.length && !unknownFavs.length) {
      this.elCliList.innerHTML = '<span class="tip">未检测到可用 CLI Agent（opencode/codex 等）。可先在「工具箱」安装，圆桌仍可可视化展示。</span>';
      return;
    }
    selectable.sort((a, b) => (favs.has(b.id) ? 1 : 0) - (favs.has(a.id) ? 1 : 0));

    this.elCliList.innerHTML = '';
    const mkChip = (c, { disabled = false, starred = false } = {}) => {
      const chip = document.createElement('label');
      chip.className = 'clichip' + (disabled ? ' disabled' : '') + (starred ? ' starred' : '');
      const star = starred ? '⭐ ' : '';
      const catTag = (!disabled && c.category && c.category !== 'agent') ? ` <span class="cat">${c.category}</span>` : '';
      chip.innerHTML = `<input type="checkbox" value="${c.id}" ${disabled ? 'disabled' : ''}> ${star}${c.displayName || c.name}${catTag}`;
      if (!disabled) {
        chip.querySelector('input').addEventListener('change', (ev) => {
          chip.classList.toggle('on', ev.target.checked);
          this.selected = Array.from(this.elCliList.querySelectorAll('input:checked')).map((i) => i.value);
          this.renderSeats();
        });
      }
      return chip;
    };
    for (const c of selectable) this.elCliList.appendChild(mkChip(c, { starred: favs.has(c.id) }));
    for (const id of unknownFavs) {
      this.elCliList.appendChild(mkChip({ id, name: id, displayName: id }, { disabled: true, starred: true }));
    }
  },

  renderSeats() {
    if (!this.rt) return;
    this.rt.querySelectorAll('.rtseat').forEach((n) => n.remove());
    this.seats = {};
    this.buildSeat('host', this.host, { host: true });
    const occupied = this.selected.slice(0, AGENT_SEAT_ORDER.length);
    AGENT_SEAT_ORDER.forEach((seatId, idx) => {
      const agent = this.roster[idx];
      const isOccupied = idx < occupied.length;
      this.buildSeat(seatId, agent, { empty: !isOccupied });
    });
    this.applyHideEmpty();
  },

  buildSeat(seatId, agent, { empty = false, host = false } = {}) {
    const pos = SEAT_POS[seatId];
    const seat = document.createElement('div');
    seat.className = 'rtseat' + (empty ? ' empty' : '') + (host ? ' host' : '');
    seat.setAttribute('data-seat', seatId);
    seat.setAttribute('style', pos.style);
    const color = agent.themeColor || '#c9ced4';
    const avInner = empty ? '' : renderAvatarInner(agent);
    seat.innerHTML = `
      <div class="rt-av ${empty ? '' : statusClass('idle')}" style="border-color:${color}">${avInner}</div>
      <div class="rtname">${agent.name || ''}</div>
      <div class="rtrole">${agent.roleLabel || ''}</div>
      ${empty ? '<div class="seatchair">空座</div>' : '<div class="rtst" style="background:#9aa1a9">待命</div>'}
      <div class="${host ? 'bub' : 'bub bub-side'}" style="display:none"></div>
      ${host ? '' : '<div class="likes" style="display:none">👍 <span>0</span></div>'}`;
    if (!host && !empty) {
      const likeEl = seat.querySelector('.likes');
      likeEl.style.display = 'block';
      likeEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const span = likeEl.querySelector('span');
        span.textContent = String((+span.textContent) + 1);
      });
    }
    this.rt.appendChild(seat);
    this.seats[seatId] = {
      el: seat,
      avEl: seat.querySelector('.rt-av'),
      nameEl: seat.querySelector('.rtname'),
      roleEl: seat.querySelector('.rtrole'),
      stEl: seat.querySelector('.rtst'),
      bubEl: seat.querySelector('.bub'),
      likeEl: seat.querySelector('.likes'),
      likes: 0,
      empty,
      agent,
    };
  },

  applyHideEmpty() {
    if (this.rt && this.elHideEmpty) this.rt.classList.toggle('hide-empty', !this.elHideEmpty.checked);
  },

  setSeat(seatId, { state, name, bubble }) {
    const s = this.seats[seatId];
    if (!s) return;
    if (state) {
      const color = (s.agent && s.agent.themeColor) || '#c9ced4';
      s.avEl.className = 'rt-av ' + statusClass(state);
      s.avEl.style.borderColor = color;
      s.avEl.style.boxShadow = (state === 'speaking') ? this.skinObj.activeGlow(color) : '';
      if (s.stEl) { s.stEl.style.display = 'inline-block'; s.stEl.style.background = (STATUS_META[state] || STATUS_META.idle).color; s.stEl.textContent = (STATUS_META[state] || STATUS_META.idle).label; }
    }
    if (name) s.nameEl.textContent = name;
    if (bubble !== undefined) {
      s._bub = (s._bub || '') + bubble;
      s.bubEl.style.display = 'block';
      const color = (s.agent && s.agent.themeColor) || '#c9ced4';
      const av = renderAvatarInner(s.agent);
      const nm = this.esc(name || s.agent.name || '');
      s.bubEl.style.borderLeftColor = color;
      s.bubEl.innerHTML = `<div class="bub-hd"><span class="bub-av" style="border:1.5px solid ${color}">${av}</span><span class="bub-name">${nm}</span></div><div class="bub-body">${this.esc(s._bub)}</div>`;
      this.positionBubble(seatId);
    }
  },

  positionBubble(seatId) {
    const s = this.seats[seatId];
    if (!s) return;
    if (seatId === 'host') {
      s.bubEl.style.left = '50%';
      s.bubEl.style.top = '80px';
      s.bubEl.style.right = 'auto';
      s.bubEl.style.transform = 'translateX(-50%)';
    } else if (seatId === 'fox' || seatId === 'owl') {
      s.bubEl.style.left = '92px';
      s.bubEl.style.top = '-8px';
      s.bubEl.style.right = 'auto';
      s.bubEl.style.transform = 'none';
    } else {
      s.bubEl.style.right = '92px';
      s.bubEl.style.top = '-8px';
      s.bubEl.style.left = 'auto';
      s.bubEl.style.transform = 'none';
    }
  },

  // ── 引擎：复用 Q.ChatAPI.sendMessage（discuss 模式）──
  start() {
    if (this.running) return;
    const apiKey = (Q.ChatAPI && Q.ChatAPI.getApiKey) ? Q.ChatAPI.getApiKey() : getStore().get('qcli-ai-key', '');
    if (!apiKey) { this.toast('未配置 API Key（设置 → AI Key）'); return; }
    if (!this.selected.length) { this.toast('请至少选择一个参与 Agent'); return; }
    const topic = this.elTopic.value.trim();
    if (!topic) { this.toast('请输入议题'); return; }

    this.topic = topic;
    this.running = true;
    this.transcript = [];
    this.stats = null;
    this.elStart.disabled = true;
    this.elExport.disabled = true;
    this.elSave.disabled = true;
    this.elMemo.classList.add('show');
    this.renderMemo();

    // 参与者映射：AI 助手坐主持人位（上首），选中的 CLI 依次入座 fox/panda/owl/bunny
    this.participantSeats = { 'AI 助手': 'host' };
    this.selected.forEach((id, i) => {
      const label = this.cliLabel(id);
      this.participantSeats[label] = AGENT_SEAT_ORDER[i];
    });
    // 重置席位为待命
    ['host', ...AGENT_SEAT_ORDER].forEach((sid) => {
      if (this.seats[sid] && !this.seats[sid].empty) {
        const name = sid === 'host' ? this.host.name : this.roster[AGENT_SEAT_ORDER.indexOf(sid)].name;
        this.setSeat(sid, { state: 'idle', name });
      }
    });

    const api = Q.ChatAPI;
    if (!api || !api.sendMessage) { this.toast('讨论引擎不可用'); this.finishDiscussion(); return; }
    api.sendMessage({
      messages: [{ role: 'user', content: topic }],
      discuss: true,
      partners: this.selected,
      maxTurns: getRounds(),
      sessionId: this.sessionId,
      onToken: (content) => {
        if (this.activeSeat) this.setSeat(this.activeSeat, { bubble: content });
        this.appendMemo(content);
      },
      onDiscuss: (evt) => {
        if (!evt) return;
        if (evt.type === 'start') {
          const seatId = this.participantSeats[evt.label] || null;
          this.activeSeat = seatId;
          if (seatId) {
            const s = this.seats[seatId];
            if (s) {
              s._bub = ''; s.bubEl.style.display = 'none'; s.bubEl.innerHTML = '';
              if (this.skinObj.tileAnim) {
                s.el.classList.add('tile-out');
                setTimeout(() => s.el.classList.remove('tile-out'), 520);
              }
            }
            this.setSeat(seatId, { state: 'speaking', name: evt.label });
            this.startMemoTurn(evt.label);
          } else if (evt.speaker === 'summary') {
            // 结论汇总无专属席位，但仍需独立成段；否则正文会被丢弃或误并入上一位发言
            this.activeSeat = null;
            this.startMemoTurn(evt.label);
          }
        } else if (evt.type === 'end') {
          if (this.activeSeat) this.setSeat(this.activeSeat, { state: 'done' });
        } else if (evt.type === 'stats') {
          this.stats = evt.stats;
        }
      },
      onStatus: (msg) => this.log(msg),
      onDone: () => this.finishDiscussion(),
      onError: (err) => {
        let msg = (typeof err === 'string') ? err : (err && err.message) || '讨论出错';
        if (msg === 'NEEDS_KEY') msg = '未配置 API Key（设置 → AI Key）';
        this.log('⚠️ ' + msg);
        this.toast(msg);
        this.finishDiscussion();
      },
    });
  },

  log(msg) {
    this.transcript.push({ label: '·', text: msg });
    this.renderMemo();
  },

  startMemoTurn(label) {
    this.transcript.push({ label, text: '' });
    this.renderMemo();
  },
  appendMemo(text) {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.label !== '·') last.text += text;
    this.renderMemo();
  },
  renderMemo() {
    if (!this.elMemoBody) return;
    this.elMemoBody.innerHTML = this.transcript
      .filter((t) => t.label !== '·' || t.text)
      .map((t) => {
        let icon = '';
        if (t.label !== '·') {
          const seatId = this.participantSeats[t.label] || null;
          const agent = seatId ? this.roster[AGENT_SEAT_ORDER.indexOf(seatId)] : null;
          icon = this.skinObj.messageIcon(seatId, agent);
        }
        return `<div class="ml ${t.label !== '·' ? 'speaking' : ''}"><span class="who" style="font-weight:600">${icon ? icon + ' ' : ''}${this.esc(t.label)}：</span>${this.esc(t.text)}</div>`;
      })
      .join('');
  },

  finishDiscussion() {
    this.running = false;
    if (this.elStart) this.elStart.disabled = false;
    if (this.transcript.some((t) => t.label !== '·' && t.text.trim())) {
      if (this.elExport) this.elExport.disabled = false;
      if (this.elSave) this.elSave.disabled = false;
    }
    // 占出席位回到待命（含主持人位）
    ['host', ...AGENT_SEAT_ORDER].forEach((sid) => { if (this.seats[sid] && !this.seats[sid].empty) this.setSeat(sid, { state: 'idle' }); });
    this.activeSeat = null;
  },

  buildSummaryMarkdown() {
    const parts = [];
    parts.push('# 📋 圆桌纪要');
    parts.push('');
    parts.push(`**议题**：${this.topic}`);
    parts.push(`**时间**：${new Date().toLocaleString()}`);
    parts.push('**主持**：AI 助手');
    const participants = this.selected.map((id) => this.cliLabel(id));
    parts.push(`**参与 Agent**：${participants.join(' / ') || '无'}`);
    parts.push('');
    parts.push('## 发言记录');
    for (const t of this.transcript) {
      if (t.label === '·') continue;
      parts.push('');
      parts.push(`### ${t.label}`);
      parts.push(t.text.trim());
    }
    if (this.stats) {
      parts.push('');
      parts.push('## 统计');
      parts.push('```json');
      parts.push(JSON.stringify(this.stats, null, 2));
      parts.push('```');
    }
    return parts.join('\n');
  },

  exportMemo() {
    const md = this.buildSummaryMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roundtable-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async saveToConversation() {
    const summary = this.buildSummaryMarkdown();
    try {
      const r = await fetch('/api/roundtable/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, summary }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        this.renderSessionCard({ saved: true });
        this.toast('已保存到对话（会话 ' + this.sessionId.slice(0, 8) + '…）');
      } else {
        this.toast('保存失败：' + (j.error || j.reason || r.status));
      }
    } catch (e) {
      this.toast('保存出错：' + e.message);
    }
  },

  openCustomize() {
    if (!this.elModalBody) return;
    this.elModalBody.innerHTML = '';
    for (const a of this.roster) {
      const seat = document.createElement('div');
      seat.className = 'mseat';
      seat.innerHTML = `
        <div class="mt">${a.name} <span style="color:var(--sub);font-weight:400">(${a.id})</span></div>
        <div class="mfield">名字 <input type="text" data-k="name" data-id="${a.id}" value="${this.esc(a.name)}"></div>
        <div class="mfield">角色 <input type="text" data-k="roleLabel" data-id="${a.id}" value="${this.esc(a.roleLabel)}"></div>
        <div class="mfield">主题色 <input type="color" data-k="themeColor" data-id="${a.id}" value="${this.esc(a.themeColor)}"></div>
        <div class="mfield">头像(emoji) <input type="text" data-k="emoji" data-id="${a.id}" placeholder="留空用内置SVG" value="${a.avatar && a.avatar.type === 'emoji' ? this.esc(a.avatar.value) : ''}" style="width:80px"></div>`;
      this.elModalBody.appendChild(seat);
    }
    this.elModal.classList.add('show');
  },

  async saveCustomize() {
    const overrides = {};
    this.elModalBody.querySelectorAll('input[data-k]').forEach((inp) => {
      const id = inp.getAttribute('data-id');
      const k = inp.getAttribute('data-k');
      const v = inp.value;
      if (!overrides[id]) overrides[id] = {};
      if (k === 'emoji') {
        if (v.trim()) overrides[id].avatar = { type: 'emoji', value: v.trim() };
      } else if (v !== '') {
        overrides[id][k] = v;
      }
    });
    try {
      const r = await fetch('/api/roundtable/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        this.overrides = j.overrides || {};
        this.roster = applyOverrides(AGENT_ROSTER, this.overrides);
        this.renderSeats();
        this.toast('自定义已保存');
        this.elModal.classList.remove('show');
      } else {
        this.toast('保存失败：' + (j.error || r.status));
      }
    } catch (e) {
      this.toast('保存出错：' + e.message);
    }
  },

  closeCustomize() { if (this.elModal) this.elModal.classList.remove('show'); },

  toast(msg) {
    if (!this.elToast) return;
    this.elToast.textContent = msg;
    this.elToast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.elToast.classList.remove('show'), 2200);
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // ── 由 chat-panel 调起的弹层控制 ──
  open(skin) {
    const el = document.getElementById('mahjong-embed');
    if (!el) return;
    el.classList.remove('hidden');
    if (skin && SKINS[skin]) this.setSkin(skin);
    if (!this._stateLoaded) { this._stateLoaded = true; this.fetchState(); }
  },
  close() {
    const el = document.getElementById('mahjong-embed');
    if (el) el.classList.add('hidden');
  },
};

window.QCLI.RoundTableView = RoundTableView;
window.RoundTableView = RoundTableView;

function init() {
  if (!document.getElementById('rt')) return;
  RoundTableView.init();
  // URL 自动展开：?view=roundtable[&skin=mahjong]
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('view') === 'roundtable') {
      RoundTableView.open(p.get('skin') || undefined);
    }
  } catch { /* ignore */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
