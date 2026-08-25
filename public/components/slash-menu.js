/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Slash 命令菜单（opencode 风格）— 聊天输入框 `/` 前缀触发。
//
// 背景：Hesi 运行在浏览器内，Ctrl+K/Ctrl+P 等快捷键被浏览器劫持，
// 现有全局命令面板（command-palette）实际不可达。`/` 是纯文本触发，
// 零快捷键依赖，是浏览器环境里唯一可靠的键盘命令入口。
//
// 交互：
//   - 输入 `/cmd` → 一级菜单（工具入口 / 技能 / CLI / 角色 / 动作）
//   - 输入 `/skill xxx`、`/cli xxx`、`/role xxx` → 二级子项过滤
//   - ↑↓ 选择、Enter 执行、Esc 关闭
//   - 无候选不弹（防误触：/home、/usr、1/2 等正常文本不打扰）
//
// 技能执行语义：选中技能 → 完整 body 注入为消息前缀 + 发送
// （绕过 BM25 自动检索，用户精确指定）。CLI → Q.launchCLI（优先接管已开同名终端并邀请 AI 协作）。
// ============================================================
'use strict';

/** 一级：工具入口（打开独立页面） */
const TOOL_COMMANDS = [
  { cmd: 'skills', icon: '🛠', name: '技能库', desc: '管理已摄入技能（启用/停用/删除）', url: '/skills.html' },
  { cmd: 'native', icon: '🪄', name: '原生技能', desc: 'Hesi 内置 skill（skills/builtin）', url: '/skills.html?src=builtin' },
  { cmd: 'bots', icon: '🔌', name: '通讯接入', desc: 'QQ/企微/飞书/钉钉/微信 bot', url: '/bots.html' },
  { cmd: 'llm', icon: '🤖', name: '模型服务', desc: '接入各家大模型（云端/本地）', url: '/llm-providers.html' },
  { cmd: 'plugins', icon: '🏪', name: '插件广场', desc: '发现、安装、创作插件', url: '/plugin-plaza.html' },
  { cmd: 'tools', icon: '🧰', name: '工具箱', desc: '全部工具', url: '/tools.html' },
  { cmd: 'wb', icon: '🧭', name: 'WB广场', desc: '专家/技能/连接器', url: '/workbuddy-hub.html' },
];

/** 一级：有二级子项的父命令 */
const PARENT_COMMANDS = [
  { cmd: 'skill', icon: '🪄', name: '技能', desc: '调用指定技能（完整指令注入）' },
  { cmd: 'cli', icon: '⚡', name: 'CLI', desc: '执行命令 / 进入协作模式' },
  { cmd: 'role', icon: '👤', name: '角色预设', desc: '应用 CLI 角色预设' },
];

/** 一级：系统动作（复用 command-palette 的 Q.* 执行映射） */
const ACTION_COMMANDS = [
  { cmd: 'theme', icon: '🎨', name: '切换主题', desc: '明暗主题切换', run: () => window.QCLI?.toggleTheme?.() },
  { cmd: 'sidebar', icon: '📑', name: '折叠侧边栏', desc: '展开/收起左侧栏', run: () => window.QCLI?.toggleSidebar?.() },
  { cmd: 'add-cli', icon: '➕', name: '添加 CLI', desc: '注册新 CLI 工具', run: () => window.QCLI?.Sidebar?.showAddModal?.() },
  { cmd: 'discover', icon: '🔄', name: '发现 CLI', desc: '扫描 PATH 中的新工具', run: () => window.QCLI?.Sidebar?.discoverCLIs?.() },
  {
    cmd: 'clear', icon: '🧹', name: '清空终端', desc: '重置终端显示',
    run: () => { const t = window.QCLI?.Tabs?.term || window.QCLI?.term; if (t && typeof t.reset === 'function') { try { t.reset(); } catch { /* non-critical */ } } },
  },
];

export class SlashMenu {
  /**
   * @param {HTMLTextAreaElement} input 聊天输入框
   * @param {{ onSkill?: (skill:object, restText:string)=>void, onToast?: (msg:string)=>void }} [opts]
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.opts = opts;
    this.el = null;
    this.items = [];       // 当前候选 [{icon,name,desc,run}]
    this.selected = -1;
    this._skills = null;   // 技能缓存（懒加载）
    this._presets = null;  // 角色缓存（懒加载）
    this._buildDom();
  }

  _buildDom() {
    const el = document.createElement('div');
    el.className = 'slash-menu';
    el.style.display = 'none';
    // 锚定到输入框父容器（.chat-input-area 相对定位，见 chat.css）
    const anchor = this.input.closest('.chat-input-area') || this.input.parentElement || document.body;
    anchor.appendChild(el);
    // 鼠标点击选中（事件委托，复用 _select 的执行逻辑）
    // mousedown preventDefault：防止点击菜单时输入框失焦（失焦可能触发其它 UI 逻辑）
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.slash-item');
      if (!itemEl) return;
      const idx = Array.prototype.indexOf.call(el.children, itemEl);
      if (idx >= 0 && this.items[idx] && this.items[idx].run) {
        const item = this.items[idx];
        const jump = item.jump === true;
        item.run();
        if (jump) {
          this.input.focus();
        } else {
          this.input.value = '';
          this.close();
          this.input.focus(); // 执行后焦点还给输入框，便于继续输入
        }
      }
    });
    this.el = el;
  }

  get _Q() { return window.QCLI || {}; }

  // ── 数据源（懒加载） ──

  async _loadSkills() {
    if (this._skills) return this._skills;
    try {
      const r = await fetch('/api/skills');
      const d = await r.json();
      this._skills = (d && d.skills) || [];
    } catch {
      this._skills = [];
    }
    return this._skills;
  }

  async _loadPresets() {
    if (this._presets) return this._presets;
    try {
      const r = await fetch('/api/presets');
      const d = await r.json();
      const list = (d && (d.presets || d.available)) || [];
      this._presets = Array.isArray(list) ? list : [];
    } catch {
      this._presets = [];
    }
    return this._presets;
  }

  _loadClis() {
    const Q = this._Q;
    return (Q.state && Q.state.clis) || [];
  }

  // ── /cli 选中：接管（优先）或新建+自动邀请 AI 协作 ──

  /**
   * /cli 选中 CLI：优先「接管」已开同名终端（切过去 + 邀请 AI 协作），
   * 未开则新建并在启动完成后自动邀请协作。不再无条件新开空终端。
   * @param {{ id: string, name: string }} cli
   */
  async _pickCli(cli) {
    const Q = this._Q;
    const Tabs = Q.Tabs;
    const isShared = (tabId) => window.__sharedCliTabId === tabId;

    // 1) 同名 CLI 已有打开的会话 → 接管（复用，不新建）
    if (Tabs && Array.isArray(Tabs.tabs) && Tabs.tabs.length) {
      const existing =
        Tabs.tabs.find((t) => t && t.cliId === cli.id && t.tabId === Tabs.activeTabId) ||
        Tabs.tabs.find((t) => t && t.cliId === cli.id);
      if (existing) {
        if (Tabs.activeTabId !== existing.tabId && typeof Tabs.switch === 'function') {
          try { Tabs.switch(existing.tabId); } catch (e) { console.warn('[SlashMenu] switch tab:', e && e.message); }
        }
        if (!isShared(existing.tabId) && typeof Tabs.toggleAiCollab === 'function') {
          try { await Tabs.toggleAiCollab(existing.tabId, false); } catch (e) { console.warn('[SlashMenu] share existing:', e && e.message); }
        }
        this.opts.onToast?.('已接管终端「' + cli.name + '」并进入协作模式');
        return;
      }
    }

    // 2) 未开过 → 新建；先注册 launched 监听，再发送启动
    const launchedPromise = this._onceLaunched(cli);
    Q.launchCLI?.(cli.id);
    const launchedTabId = await launchedPromise;
    if (!launchedTabId) {
      this.opts.onToast?.('已启动 CLI：' + cli.name + '（可 hover 终端点「协作」或输入 /cli collab）');
      return;
    }
    this.opts.onToast?.('已启动 CLI：' + cli.name + '，正在进入协作模式…');
    if (Tabs && typeof Tabs.toggleAiCollab === 'function' && !isShared(launchedTabId)) {
      // 后端已回 launched → tab 已入 activePTYs；稍等前端事件处理完再 share
      setTimeout(async () => {
        try { await Tabs.toggleAiCollab(launchedTabId, false); } catch (e) { console.warn('[SlashMenu] auto share:', e && e.message); }
      }, 600);
    }
  }

  /**
   * 一次性监听 ws `launched` 消息，返回新 tab 的 tabId（15s 超时返回 null）。
   * 调用方必须先调本方法（注册监听）再发启动消息。
   */
  _onceLaunched(cli) {
    return new Promise((resolve) => {
      const ws = this._Q.ws;
      let timer = null;
      const cleanup = () => {
        if (ws) ws.removeEventListener('message', onMsg);
        if (timer) clearTimeout(timer);
      };
      const onMsg = (ev) => {
        let msg = null;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}'); } catch { return; }
        if (!msg || msg.type !== 'launched') return;
        const cid = (msg.cli && msg.cli.id) || msg.cliId || '';
        if (String(cid) === String(cli.id)) {
          cleanup();
          resolve(msg.tabId || null);
        }
      };
      if (ws) ws.addEventListener('message', onMsg);
      timer = setTimeout(() => { cleanup(); resolve(null); }, 15000);
    });
  }

  // ── 解析当前输入 ──

  _parse(text) {
    if (!text || text[0] !== '/') return null;
    if (text.startsWith('//')) return null; // 注释/路径，不弹
    const rest = text.slice(1);
    if (!rest) return { cmd: '', arg: '' }; // 单个 / → 显示全部一级命令（opencode 行为）
    const parts = rest.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();
    return { cmd, arg };
  }

  // ── 刷新候选（input 事件调用） ──

  async refresh() {
    const parsed = this._parse(this.input.value);
    if (!parsed) { this.close(); return; }
    const { cmd, arg } = parsed;

    // 单个 /（无命令）→ 显示全部一级命令
    if (!cmd) {
      const all = [
        ...TOOL_COMMANDS.map((c) => ({ ...c, kind: 'tool' })),
        ...PARENT_COMMANDS.map((c) => ({ ...c, kind: 'parent' })),
        ...ACTION_COMMANDS.map((c) => ({ ...c, kind: 'action' })),
      ];
      const items = all.map((c) => ({
        icon: c.icon, name: '/' + c.cmd, desc: c.desc,
        jump: c.kind === 'parent',
        run: c.kind === 'tool'
          ? () => { window.open(c.url, '_blank'); }
          : c.kind === 'parent'
            ? () => { this.input.value = '/' + c.cmd + ' '; this.input.focus(); this.refresh(); }
            : c.run,
      }));
      this._render(items);
      return;
    }

    // 二级：/skill、/cli、/role
    if (cmd === 'skill') {
      const skills = await this._loadSkills();
      const q = arg.toLowerCase();
      // 内置/自定义优先展示；有搜索词则全量过滤
      let list = skills;
      if (q) list = list.filter((s) => (s.name + ' ' + (s.description || '') + ' ' + (s.id || '')).toLowerCase().includes(q));
      else list = list.filter((s) => s.source === 'builtin' || s.source === 'custom').slice(0, 12);
      const items = list.slice(0, 20).map((s) => ({
        icon: '🪄', name: s.name || s.id, desc: s.id + (s.enabled === false ? '（已停用）' : ''),
        jump: true, // 选中后保留输入（插入 [技能：名称] 标记，用户继续输入）
        run: () => this._pickSkill(s, arg),
      }));
      this._render(items);
      return;
    }
    if (cmd === 'cli') {
      const clis = this._loadClis();
      const q = arg.toLowerCase();
      const list = clis.filter((c) => !q || (c.name + ' ' + (c.id || '')).toLowerCase().includes(q)).slice(0, 20);
      const items = list.map((c) => ({
        icon: '⚡', name: c.name, desc: (c.category || 'tool') + (c.version && c.version !== 'unknown' ? ' · v' + c.version : ''),
        run: () => this._pickCli(c),
      }));
      this._render(items);
      return;
    }
    if (cmd === 'role') {
      const presets = await this._loadPresets();
      const q = arg.toLowerCase();
      const list = presets.filter((p) => !q || ((p.name || p.id || '')).toLowerCase().includes(q)).slice(0, 20);
      const items = list.map((p) => ({
        icon: '👤', name: p.name || p.id, desc: (p.description || p.id || '角色预设'),
        run: () => { this.opts.onToast?.('角色预设：' + (p.name || p.id) + '（请直接在 AI 对话中说明使用该角色）'); },
      }));
      this._render(items);
      return;
    }

    // 一级：工具 + 父命令 + 动作，按 cmd 前缀过滤
    const q = cmd.toLowerCase();
    const all = [
      ...TOOL_COMMANDS.map((c) => ({ ...c, kind: 'tool' })),
      ...PARENT_COMMANDS.map((c) => ({ ...c, kind: 'parent' })),
      ...ACTION_COMMANDS.map((c) => ({ ...c, kind: 'action' })),
    ];
    const matched = all.filter((c) => c.cmd.startsWith(q) || q.startsWith(c.cmd));
    if (!matched.length) { this.close(); return; } // 无候选不弹（防误触）
    const items = matched.map((c) => ({
      icon: c.icon, name: '/' + c.cmd, desc: c.desc,
      jump: c.kind === 'parent',
      run: c.kind === 'tool'
        ? () => { window.open(c.url, '_blank'); }
        : c.kind === 'parent'
          ? () => { this.input.value = '/' + c.cmd + ' '; this.input.focus(); this.refresh(); }
          : c.run,
    }));
    this._render(items);
  }

  _pickSkill(skill, restText) {
    if (skill.enabled === false) {
      this.opts.onToast?.('技能「' + (skill.name || skill.id) + '」已停用，先在技能库启用');
      return;
    }
    // 在输入框插入可见技能标记，用户继续输入自己的内容；
    // 发送时由 chat-panel 解析标记、注入完整 skill body、并剥离标记本身。
    this.input.value = '[技能：' + (skill.name || skill.id) + '] ' + (restText || '');
    // 光标移到行尾，便于继续输入
    try {
      const len = this.input.value.length;
      this.input.setSelectionRange(len, len);
    } catch { /* 非 textarea 环境忽略 */ }
    this.input.focus();
    this.close();
  }

  // 供 chat-panel 发送时解析技能标记：按 name / id 精确查找（懒加载缓存内）
  findSkillByName(name) {
    if (!name || !this._skills) return null;
    const q = String(name).toLowerCase();
    return this._skills.find((s) => (s.name || '').toLowerCase() === q || (s.id || '').toLowerCase() === q) || null;
  }

  // ── 渲染 ──

  _render(items) {
    this.items = items;
    if (!items.length) { this.close(); return; }
    this.selected = 0;
    this.el.innerHTML = items.map((it, i) =>
      '<div class="slash-item' + (i === 0 ? ' active' : '') + '"><span class="slash-ico">' + it.icon + '</span>' +
      '<span class="slash-name">' + escHtml(it.name) + '</span>' +
      '<span class="slash-desc">' + escHtml(it.desc || '') + '</span></div>'
    ).join('');
    this.el.style.display = 'block';
  }

  close() {
    this.items = [];
    this.selected = -1;
    if (this.el) { this.el.style.display = 'none'; this.el.innerHTML = ''; }
  }

  get open() { return this.el && this.el.style.display !== 'none'; }

  _move(delta) {
    if (!this.open || !this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    const kids = this.el.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('active', i === this.selected);
    // 键盘导航时让选中项保持在可视区内（菜单自身滚动条跟随，不滚动外层页面）
    const active = kids[this.selected];
    if (active && typeof active.scrollIntoView === 'function') {
      try { active.scrollIntoView({ block: 'nearest' }); } catch { /* 老浏览器忽略 */ }
    }
  }

  _select() {
    if (!this.open || !this.items.length) return false;
    const item = this.items[this.selected >= 0 ? this.selected : 0];
    if (item && item.run) {
      const jump = item.jump === true; // 父命令（/skill /cli /role）→ 进入二级，保留输入
      item.run();
      if (jump) {
        // run 已把输入设为 '/cmd ' 并调用 refresh() 渲染二级；不清空、不关闭
        this.input.focus();
      } else {
        this.input.value = '';
        this.close();
      }
    }
    return true;
  }

  /**
   * keydown 处理（chat-panel 调用）。返回 true 表示已消费该按键。
   * @param {KeyboardEvent} e
   * @returns {boolean}
   */
  handleKeydown(e) {
    if (!this.open) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); return true; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._select(); return true; }
    if (e.key === 'Tab') { e.preventDefault(); this._select(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
