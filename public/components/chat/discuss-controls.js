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
    const toggle = document.getElementById('discuss-toggle');
    const btn = document.getElementById('discuss-partner-btn');
    const dropdown = document.getElementById('discuss-partner-dropdown');
    const roundsSel = document.getElementById('discuss-rounds');
    const controls = document.getElementById('discuss-controls');
    if (!toggle || !btn || !dropdown || !roundsSel || !controls) return;

    this._discussPartners = [];
    this._agentNameMap = new Map();

    // 多选按钮文案：0 个 → 占位提示；1 个 → 显示名称；多个 → “已选 N 个”
    const updateBtnLabel = () => {
      if (this._noAgents) {
        btn.textContent = '未安装 Agent · 点击安装 ▾';
        btn.classList.add('placeholder');
        return;
      }
      if (this._discussPartners.length === 0) {
        btn.textContent = '选择 CLI Agent ▾';
        btn.classList.add('placeholder');
      } else if (this._discussPartners.length === 1) {
        btn.textContent = (this._agentNameMap.get(this._discussPartners[0]) || this._discussPartners[0]) + ' ▾';
        btn.classList.remove('placeholder');
      } else {
        btn.textContent = `已选 ${this._discussPartners.length} 个 Agent ▾`;
        btn.classList.remove('placeholder');
      }
    };

    const sync = () => {
      this._discussEnabled = !!toggle.checked;
      this._discussMaxTurns = parseInt(roundsSel.value, 10) || 6;
      this._discussPartners = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.id);
      this._discussPartner = this._discussPartners[0] || '';
      // 开关常驻可见；勾选后才展开「选择 CLI Agent + 轮数」控件
      controls.style.display = this._discussEnabled ? 'flex' : 'none';
      // 关闭讨论开关时收起下拉，避免遮挡
      if (this._discussEnabled) dropdown.classList.add('hidden');
      updateBtnLabel();
    };

    toggle.addEventListener('change', sync);
    roundsSel.addEventListener('change', sync);
    dropdown.addEventListener('change', sync);

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

    // 拉取已安装的 CLI Agent + 注册表中所有 agent 类 CLI，并与左侧栏「收藏夹」同步
    Promise.all([
      fetch('/api/agents').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/clis').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([agentsData, clisData]) => {
      const list = (agentsData && agentsData.agents ? agentsData.agents : []).filter(a => a.installed);
      // 合并注册表中 category==='agent' 但不在 /api/agents 的 CLI（如 mimo / opencli）
      const registryAgents = (clisData && clisData.clis ? clisData.clis : [])
        .filter(c => (c.category || '') === 'agent');
      const seen = new Set(list.map(a => a.id));
      for (const c of registryAgents) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          list.push({ id: c.id, name: c.name, displayName: c.name, version: c.version || '', installed: true, fromRegistry: true });
        }
      }
      // 读取左侧栏收藏夹（localStorage: qcli-favorites）
      const favs = (window.QCLI && typeof window.QCLI.getFavorites === 'function') ? window.QCLI.getFavorites() : [];
      const favSet = new Set(favs);
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
        const availableFavs = list.filter(a => favSet.has(a.id)).length;
        if (availableFavs > 0) {
          const hint = document.createElement('div');
          hint.className = 'discuss-fav-hint';
          hint.textContent = `★ 已与左侧「收藏夹」同步（${availableFavs} 个）`;
          dropdown.appendChild(hint);
        }
        for (const a of list) {
          const name = a.displayName || a.name;
          const isFav = favSet.has(a.id);
          this._agentNameMap.set(a.id, name);
          const label = document.createElement('label');
          label.className = 'discuss-option' + (isFav ? ' favorited' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.id = a.id;
          if (isFav) cb.checked = true; // 与收藏夹同步：默认勾选
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
    }).catch(() => { sync(); });
    sync();
  },
};
