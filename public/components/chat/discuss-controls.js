/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 圆桌 / 讨论控件装配（从 chat-panel.js 抽离，P2 拆分）
//
// 原型 mixin：discussControlsMixin，含 _setupDiscussControls。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, discussControlsMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

export const discussControlsMixin = {
  _setupDiscussControls() {
    if (this._discussInitStarted) return;
    this._discussInitStarted = true;

    // PartnerStore 可能在本函数执行时尚未就绪（<chat-panel> 在 bundle.js 同步
    // 升级时即触发 connectedCallback，而 partner-store.js 是 index.html 中后续的
    // <script> 标签），故统一用 getPS() 动态取，绝不捕获此刻可能为 undefined 的值。
    const getPS = () => window.PartnerStore;
    const toggle = document.getElementById('discuss-toggle');
    const btn = document.getElementById('discuss-partner-btn');
    const dropdown = document.getElementById('discuss-partner-dropdown');
    const roundsSel = document.getElementById('discuss-rounds');
    const controls = document.getElementById('discuss-controls');
    if (!toggle || !btn || !dropdown || !roundsSel || !controls) return;

    this._agentNameMap = new Map();
    this._noAgents = false;

    // 多选按钮文案：0 个 → 占位提示；1 个 → 显示名称；多个 → “已选 N 个”
    const updateBtnLabel = () => {
      const PS = getPS();
      const partners = PS ? PS.getPartners() : (this._discussPartners || []);
      if (this._noAgents) {
        btn.textContent = '未安装 Agent · 点击安装 ▾';
        btn.classList.add('placeholder');
        return;
      }
      if (partners.length === 0) {
        btn.textContent = '选择 CLI Agent ▾';
        btn.classList.add('placeholder');
      } else if (partners.length === 1) {
        btn.textContent = (this._agentNameMap.get(partners[0]) || partners[0]) + ' ▾';
        btn.classList.remove('placeholder');
      } else {
        btn.textContent = `已选 ${partners.length} 个 Agent ▾`;
        btn.classList.remove('placeholder');
      }
    };

    const sync = () => {
      this._discussEnabled = !!toggle.checked;
      this._discussMaxTurns = parseInt(roundsSel.value, 10) || 6;
      const PS = getPS();
      const partners = PS ? PS.getPartners() : [];
      this._discussPartners = partners;
      this._discussPartner = partners[0] || '';
      // 开关常驻可见；勾选后才展开「选择 CLI Agent + 轮数」控件
      controls.style.display = this._discussEnabled ? 'flex' : 'none';
      // 关闭讨论开关时收起下拉，避免遮挡
      if (this._discussEnabled) dropdown.classList.add('hidden');
      // P6：同时勾选⚡自动执行→显示协作提示
      const hint = document.getElementById('plan-collab-hint');
      if (hint) hint.style.display = (this._discussEnabled && this._planEnabled) ? 'block' : 'none';
      updateBtnLabel();
    };

    toggle.addEventListener('change', sync);
    roundsSel.addEventListener('change', sync);
    dropdown.addEventListener('change', () => {
      const PS = getPS();
      if (PS) {
        const ids = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.dataset.id);
        PS.setPartners(ids);
      }
      sync();
    });

    // 点击按钮切换下拉显隐
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    // 点击其它区域收起下拉
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });

    // PartnerStore 就绪后再装配渲染 + 订阅；未就绪则短轮询（30ms，最多 5s），
    // 与 chat-panel._initMemory() 同款处理，避免「未安装 Agent」永久卡死。
    const wire = () => {
      const PS = getPS();
      if (!PS) return false;

      const render = (res) => {
        const list = res.list;
        const favSet = res.favSet;
        dropdown.innerHTML = '';
        this._agentNameMap = new Map();
        if (list.length === 0) {
          // 未安装任何 CLI Agent：给出「前往安装」的可点击引导（不打断流程）
          this._noAgents = true;
          const empty = document.createElement('div');
          empty.className = 'discuss-dropdown-empty discuss-install-hint';
          empty.innerHTML = '➕ 未发现可用 CLI Agent<br><span class="discuss-install-link">点击前往安装（opencode / codex / aider…）</span>';
          empty.addEventListener('click', () => {
            const Q = window.QCLI || {};
            const wl = document.getElementById('welcome-overlay');
            if (wl) wl.classList.remove('hidden');
            if (Q.showToast) Q.showToast('请在欢迎页「🤖 AI 智能体」区一键安装 CLI Agent', 'info');
          });
          dropdown.appendChild(empty);
          btn.disabled = false; // 允许点开下拉查看安装引导
          btn.classList.add('placeholder');
        } else {
          this._noAgents = false;
          btn.disabled = false;
          // 收藏优先排序
          list.sort((a, b) => {
            const af = favSet.has(a.id) ? 0 : 1;
            const bf = favSet.has(b.id) ? 0 : 1;
            if (af !== bf) return af - bf;
            return (a.name || '').localeCompare(b.name || '');
          });
          // 收藏夹同步提示
          const availableFavs = list.filter((a) => favSet.has(a.id)).length;
          if (availableFavs > 0) {
            const hint = document.createElement('div');
            hint.className = 'discuss-fav-hint';
            hint.textContent = `★ 已与左侧「收藏夹」同步（${availableFavs} 个）`;
            dropdown.appendChild(hint);
          }
          const checked = new Set(PS.getPartners());
          for (const a of list) {
            const name = a.displayName || a.name;
            const isFav = favSet.has(a.id);
            this._agentNameMap.set(a.id, name);
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
            label.appendChild(document.createTextNode(name + (a.version ? ' · ' + a.version : '')));
            dropdown.appendChild(label);
          }
        }
        sync();
      };

      PS.loadPartnerSource().then(render).catch(() => { this._noAgents = true; sync(); });
      // 订阅：Plan 页改了伙伴选择，这里实时更新
      PS.subscribe((ids) => {
        this._discussPartners = ids;
        // bug 修复（2026-08-04 审查反馈）：跨页同步时主 Agent 维度失同步——
        // 原只更新 _discussPartners，_discussPartner（主 Agent=首个伙伴）残留旧值
        this._discussPartner = (Array.isArray(ids) && ids[0]) || '';
        dropdown.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = ids.indexOf(cb.dataset.id) !== -1; });
        updateBtnLabel();
      });
      sync();
      return true;
    };

    if (!wire()) {
      const t = setInterval(() => { if (wire()) clearInterval(t); }, 30);
      // 最坏 5s 后放弃，避免定时器泄漏
      setTimeout(() => clearInterval(t), 5000);
    }
  },
};
