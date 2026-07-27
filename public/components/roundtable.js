// @ts-check
// ============================================================
// Phase 2 S4/S5 — 围炉圆桌控制器（懒加载，进 lazy bundle）
//
// 把 Phase 1 的共享黑板 / 多 Agent 讨论（discuss.js）从纯文本升级为
// 可视化协作空间：4 个可爱 Agent 围坐 + 中心共享桌布 + 实时闲谈气泡。
// 只读渲染 discuss SSE，不改内核。支持：空座、⚙ 自定义、抛话题、
// 点赞、纪要持久化（落对话）+ 导出 Markdown。
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

// 座位几何：主持人上首，4 Agent 围坐。
const SEAT_POS = {
  host:  { style: 'left:50%;top:6px;transform:translateX(-50%)' },
  fox:   { style: 'left:16px;top:140px' },
  panda: { style: 'right:16px;top:140px' },
  owl:   { style: 'left:16px;top:312px' },
  bunny: { style: 'right:16px;top:312px' },
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
function getAI() {
  const s = getStore();
  return {
    apiKey: s.get('qcli-ai-key', ''),
    provider: s.get('qcli-ai-provider', 'openai'),
    model: s.get('qcli-ai-model', ''),
    baseUrl: s.get('qcli-ai-base-url', ''),
  };
}

const Roundtable = {
  root: null,
  rt: null,
  roster: [],
  host: null,
  protocol: '',
  availableClis: [],
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

  init() {
    this.root = document.getElementById('rt');
    if (!this.root) return;
    this.rt = this.root;
    this.skin = this.resolveSkin();
    this.skinObj = getSkin(this.skin);
    applySkin(this.rt, this.skin);
    try {
      if (new URLSearchParams(location.search).get('embed')) document.body.classList.add('embed');
    } catch { /* ignore */ }
    this.sessionId = this.resolveSession();
    this.bindStaticUI();
    this.fetchState();
  },

  resolveSkin() {
    try {
      const p = new URLSearchParams(location.search);
      const fromUrl = p.get('skin');
      if (fromUrl && SKINS[fromUrl]) return fromUrl;
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
    const p = new URLSearchParams(location.search);
    const fromUrl = p.get('sessionId');
    if (fromUrl) return fromUrl;
    const s = getStore();
    let id = s.get('qcli-roundtable-session', '');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'rt-' + Date.now()); s.set('qcli-roundtable-session', id); }
    return id;
  },

  bindStaticUI() {
    const $ = (id) => document.getElementById(id);
    this.elTopic = $('topic');
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

    this.elStart.addEventListener('click', () => this.startDiscussion());
    this.elExport.addEventListener('click', () => this.exportMemo());
    this.elSave.addEventListener('click', () => this.saveToConversation());
    this.elCustom.addEventListener('click', () => this.openCustomize());
    document.querySelectorAll('[data-skin]').forEach((btn) => {
      btn.addEventListener('click', () => this.setSkin(btn.getAttribute('data-skin')));
    });
    this.updateSkinSwitch();
    this.elHideEmpty.addEventListener('change', () => {
      this.rt.classList.toggle('hide-empty', !this.elHideEmpty.checked);
    });
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
      if (st.blackboard) {
        const b = st.blackboard;
        const tasks = Array.isArray(b.tasks) ? b.tasks.length : (b.tasks ? Object.keys(b.tasks).length : 0);
        const files = b.files ? Object.keys(b.files).length : 0;
        document.getElementById('bbTasks').textContent = `任务 ${tasks} · 文件 ${files}`;
        document.getElementById('bbRound').textContent = `第 ${b.round || 0} 回合`;
        document.getElementById('bbFiles').textContent = '黑板已活跃';
      }
      this.elProtocol.textContent = this.protocol ? '协议：' + this.protocol.slice(0, 24) + '…' : '';
      this.renderCliList();
      this.renderSeats();
    } catch (e) {
      this.toast('加载状态失败：' + e.message);
    }
  },

  renderCliList() {
    if (!this.availableClis.length) {
      this.elCliList.innerHTML = '<span class="tip">未检测到可用 CLI Agent（opencode/codex 等）。可先在「工具箱」安装，圆桌仍可可视化展示。</span>';
      return;
    }
    this.elCliList.innerHTML = '';
    for (const c of this.availableClis) {
      const chip = document.createElement('label');
      chip.className = 'clichip';
      chip.innerHTML = `<input type="checkbox" value="${c.id}"> ${c.displayName || c.name}`;
      chip.querySelector('input').addEventListener('change', (ev) => {
        chip.classList.toggle('on', ev.target.checked);
        this.selected = Array.from(this.elCliList.querySelectorAll('input:checked')).map((i) => i.value);
        this.renderSeats();
      });
      this.elCliList.appendChild(chip);
    }
  },

  renderSeats() {
    // 清掉旧席位（保留 center）
    this.rt.querySelectorAll('.rtseat').forEach((n) => n.remove());
    this.seats = {};
    // 主持人
    this.buildSeat('host', this.host, { host: true });
    // 4 个 Agent：前 N 个被选中 CLI 占用，其余空座
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
      <div class="bub" style="display:none"></div>
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
    this.rt.classList.toggle('hide-empty', !this.elHideEmpty.checked);
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
      s.bubEl.textContent = s._bub.slice(-120);
      this.positionBubble(seatId);
    }
  },

  positionBubble(seatId) {
    const s = this.seats[seatId];
    if (!s) return;
    const pos = SEAT_POS[seatId].style;
    if (pos.includes('left:50%')) { s.bubEl.style.left = '50%'; s.bubEl.style.top = '70px'; s.bubEl.style.transform = 'translateX(-50%)'; }
    else if (pos.includes('right:16px')) { s.bubEl.style.right = '150px'; s.bubEl.style.top = '150px'; }
    else { s.bubEl.style.left = '150px'; s.bubEl.style.top = '150px'; }
  },

  async startDiscussion() {
    if (this.running) return;
    const ai = getAI();
    if (!ai.apiKey) { this.toast('未配置 API Key（设置 → AI Key）'); return; }
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
      const c = this.availableClis.find((x) => x.id === id);
      const label = c ? (c.displayName || c.name) : id;
      this.participantSeats[label] = AGENT_SEAT_ORDER[i];
    });
    // 重置席位为待命
    ['host', ...AGENT_SEAT_ORDER].forEach((sid) => {
      if (this.seats[sid] && !this.seats[sid].empty) {
        const name = sid === 'host' ? this.host.name : this.roster[AGENT_SEAT_ORDER.indexOf(sid)].name;
        this.setSeat(sid, { state: 'idle', name });
      }
    });

    const body = {
      messages: [{ role: 'user', content: topic }],
      discuss: true,
      partners: this.selected,
      maxTurns: 6,
      apiKey: ai.apiKey,
      provider: ai.provider,
      model: ai.model,
      baseUrl: ai.baseUrl,
      sessionId: this.sessionId,
    };

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        this.toast('讨论启动失败：' + resp.status);
        console.error('[roundtable]', err);
        this.finishDiscussion();
        return;
      }
      await this.consumeSSE(resp);
    } catch (e) {
      this.toast('讨论出错：' + e.message);
      this.finishDiscussion();
    }
  },

  async consumeSSE(resp) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) {
          try { this.handleEvent(JSON.parse(line.slice(6))); } catch { /* ignore malformed */ }
        }
      }
    }
  },

  handleEvent(evt) {
    switch (evt.type) {
      case 'status':
        this.log(evt.message);
        break;
      case 'discuss_start': {
        const seatId = this.participantSeats[evt.label] || null;
        this.activeSeat = seatId;
        if (seatId) {
          const s = this.seats[seatId];
          if (s) {
            s._bub = ''; s.bubEl.style.display = 'none'; s.bubEl.textContent = '';
            if (this.skinObj.tileAnim) {
              s.el.classList.add('tile-out');
              setTimeout(() => s.el.classList.remove('tile-out'), 520);
            }
          }
          this.setSeat(seatId, { state: 'speaking', name: evt.label });
          this.startMemoTurn(evt.label);
        }
        break;
      }
      case 'token':
        if (this.activeSeat) this.setSeat(this.activeSeat, { bubble: evt.content });
        this.appendMemo(evt.content);
        break;
      case 'discuss_end':
        if (this.activeSeat) this.setSeat(this.activeSeat, { state: 'done' });
        break;
      case 'discuss_stats':
        this.stats = evt.stats;
        break;
      case 'error':
        this.log('⚠️ ' + evt.message);
        this.toast(evt.message);
        break;
      case '[DONE]':
        this.finishDiscussion();
        break;
    }
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
    this.elStart.disabled = false;
    if (this.transcript.some((t) => t.label !== '·' && t.text.trim())) {
      this.elExport.disabled = false;
      this.elSave.disabled = false;
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
    const participants = this.selected.map((id) => {
      const c = this.availableClis.find((x) => x.id === id);
      return c ? (c.displayName || c.name) : id;
    });
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

  closeCustomize() { this.elModal.classList.remove('show'); },

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
};

// 模态按钮
document.getElementById('modalSave') && document.getElementById('modalSave').addEventListener('click', () => Roundtable.saveCustomize());
document.getElementById('modalCancel') && document.getElementById('modalCancel').addEventListener('click', () => Roundtable.closeCustomize());
if (document.getElementById('modal')) {
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') Roundtable.closeCustomize(); });
}

function init() {
  if (!document.getElementById('rt')) return;
  Roundtable.init();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
