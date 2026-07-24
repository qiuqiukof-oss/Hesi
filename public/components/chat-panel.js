// ============================================================
// <chat-panel> — Web Component wrapping AI Chat Drawer
//
// Phase 2: Extracts chat panel logic from app.js into a
// Custom Element. Uses existing DOM in index.html (Light DOM).
//
// API
//   element.toggle()
//   element.sendMessage()
//   element.clearHistory()
//   element.appendToDOM(msg)
//   element.showThinking()
//   element.removeThinking()
//   element.scrollToBottom()
//   Q.ChatUI.* (delegated via microtask patch)
// ============================================================
// @ts-check
'use strict';

import { safeStorage } from '../lib/storage.js';
import AgentSessionRenderer from './agent-session-renderer.js';
import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{role:string, content:string}} ChatMessage */
/** @typedef {{name:string, durMs:number, status:string}} ToolCallInfo */
/** @typedef {{type:string, names?:string[], name?:string, durMs?:number}} ToolCallEvent */

// ============================================================
// Markdown renderer — lightweight, no external deps
// ============================================================

/** @returns {QCLI} */
function qcli() { return /** @type {QCLI} */ (window.QCLI || {}); }

/** @param {string} text @returns {string} */
// 将 URL 转为可点击链接。输入已经过 escapeHtml；仅白名单协议，杜绝 javascript: 等 XSS。
function linkify(text) {
  const urlRe = /((?:https?:\/\/|file:\/\/|\/uploads\/)[^\s<>"'）)\]]+)/g;
  return text.replace(urlRe, (url) => {
    let href = url;
    let trailing = '';
    // 剥离被误捕获的句末标点（。.，,；;：: 等），保留在链接之外
    if (/[.,;:。，；：]\s*$/.test(href)) {
      trailing = href.slice(-1);
      href = href.slice(0, -1);
    }
    const label = href.length > 50 ? href.slice(0, 47) + '…' : href;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>${trailing}`;
  });
}

function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first, then apply markdown patterns
  let html = escapeHtml(text);

  // 先把代码块/行内代码抽离为占位符，避免其中的 URL 被误链、也避免 markdown 破坏其内容
  const codeStore = [];
  const stash = (fragment) => {
    const idx = codeStore.push(fragment) - 1;
    return `%%CB${idx}%%`;
  };

  // Code blocks (processed first so inner content is safe)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmedCode = code.trimEnd();
    const escapedCode = escapeHtml(trimmedCode);
    const escapedLang = lang ? escapeHtml(lang) : '';
    const langBadge = lang ? `<span class="md-code-lang">${escapedLang}</span>` : '';

    // Mermaid 代码块：渲染为流程图而非普通代码
    if (lang === 'mermaid') {
      return stash(`<div class="mermaid">${escapedCode}</div>`);
    }

    return stash(`<div class="md-code-block">`
      + `<div class="md-code-header">${langBadge}<button class="md-copy-btn" title="复制">📋</button></div>`
      + `<pre><code>${escapedCode}</code></pre>`
      + `<button class="cmd-send-btn" title="发送该命令到当前终端">▶ 发送到终端</button>`
      + `</div>`);
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_, code) => stash(`<code class="md-inline-code">${code}</code>`));

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, (_, t) => t.trim() ? `<em>${t}</em>` : `*${t}*`);

  // Horizontal rules (---)
  html = html.replace(/^---$/gm, '<hr class="md-hr">');

  // 链接可点击（代码已抽离、输入已转义 ⇒ XSS 安全）
  html = linkify(html);

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  // 还原代码块
  html = html.replace(/%%CB(\d+)%%/g, (_, i) => codeStore[Number(i)] || '');

  return html;
}

class ChatPanel extends HTMLElement {
  constructor() {
    super();
    /** @type {boolean} */
    this.open = false;
    /** @type {Array} */
    this.messages = [];
    /** @type {boolean} */
    this.sending = false;
    /** @type {AbortController|null} */
    this._abortController = null;

    // DOM refs — set in connectedCallback
    this.el = null;
    this.msgsEl = null;
    this.input = null;
    this.sendBtn = null;
    this.toggleBtn = null;
    this.closeBtn = null;
    this.clearBtn = null;
    this.resizeHandle = null;
    this.terminalToggleBtn = null;
    this.exportBtn = null;
    this.mermaidPreviewEl = null;
    this._mermaidPreviewTimer = null;

    this._unsubs = [];
    /** @type {string} */
    this._lastTerminalHash = '';
    /** @type {string[]|null} */
    this._lastTerminalLines = null;
    /** @type {string[]|null} */
    this._pendingTerminalLines = null;
    /** @type {boolean} */
    this._terminalContextEnabled = true;
    /** @type {Array<{name:string, durMs:number, status:string}>} */
    this._activeToolCalls = [];
    /** @type {{input_tokens?:number, output_tokens?:number, prompt_tokens?:number, completion_tokens?:number, total_tokens?:number}|null} */
    this._lastUsage = null;
    /** @type {AgentSessionRenderer|null} */
    this._agentRenderer = null;

    // ── AI 讨论模式状态 ──
    this._discussEnabled = false;     // 开关是否打开
    this._discussPartner = '';        // 选定的主 CLI Agent（兼容旧字段）
    this._discussPartners = [];       // 多选：参与讨论的全部 CLI Agent id
    this._discussMaxTurns = 6;        // 最多回合
    this._discussActive = false;      // 当前是否正在渲染某发言方气泡
    this._activeDiscussBubble = null; // 当前发言方气泡 DOM
    this._discussText = '';           // 当前气泡累积文本
    this._discussPendingMsg = null;   // 待落盘的消息对象
    this._agentNameMap = new Map();   // id -> displayName（用于多选按钮文案）
    this._noAgents = false;           // 是否已确认无任何可用 CLI Agent（用于「去安装」引导）
  }

  // ── Lifecycle ──

  connectedCallback() {
    this.el = document.getElementById('chat-drawer');
    this.msgsEl = document.getElementById('chat-messages');
    this.input = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('chat-input'));
    this.sendBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('chat-send-btn'));
    this.toggleBtn = document.getElementById('chat-toggle-btn');
    this.closeBtn = document.getElementById('chat-close-btn');
    this.clearBtn = document.getElementById('chat-clear-btn');
    this.terminalToggleBtn = document.getElementById('chat-terminal-toggle');
    this.exportBtn = document.getElementById('chat-export-btn');
    this.resizeHandle = document.getElementById('chat-resize-handle');

    if (!this.el) {
      console.warn('[ChatPanel] #chat-drawer not found');
      return;
    }

    this._setupEvents();
    this._setupDiscussControls();
    this._restoreState();
    this._patchQCLI();
    this._initMemory();

    // Subscribe to stores — sync component state to store FIRST so the
    // immediate callback on subscribe() doesn't falsely toggle() back
    const Q = qcli();
    if (Q.chatStore) {
      Q.chatStore.setState({ open: this.open });
      this._unsubs.push(Q.chatStore.subscribe((s) => {
        if (s.open !== this.open) this.toggle();
        if (s.sending !== this.sending) this.sending = s.sending;
      }));
    }
  }

  disconnectedCallback() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }

  // ── QCLI namespace patch (deferred, runs after app.js) ──

  _patchQCLI() {
    Promise.resolve().then(() => {
      const Q = window.QCLI || {};
      Q.ChatUI = Q.ChatUI || {};
      if (!Q.ChatUI._patched) {
        Q.ChatUI.sendChatMessage = () => this.sendMessage();
        Q.ChatUI.toggleChat = () => this.toggle();
        Q.ChatUI.clearChatHistory = () => this.clearHistory();
        Q.ChatUI.appendMessageToDOM = (msg, animate) => this.appendToDOM(msg, animate);
        Q.ChatUI.showThinkingIndicator = () => this.showThinking();
        Q.ChatUI.removeThinkingIndicator = () => this.removeThinking();
        Q.ChatUI.scrollChatToBottom = () => this.scrollToBottom();
        // Agent 事件 → 委托给 AgentSessionRenderer
        if (!this._agentRenderer) {
          this._agentRenderer = new AgentSessionRenderer(this);
        }
        Q.ChatUI.onAgentMetric = (data) => this._agentRenderer.onAgentMetric(data);
        Q.ChatUI._patched = true;
      }
    });
  }

  // ── Mermaid 实时预览 ──

  /** 初始化预览面板 DOM */
  _initMermaidPreview() {
    if (this.mermaidPreviewEl) return;
    this.mermaidPreviewEl = document.createElement('div');
    this.mermaidPreviewEl.className = 'mermaid-preview-panel hidden';
    this.mermaidPreviewEl.innerHTML = `
      <div class="mermaid-preview-header">
        <span class="mermaid-preview-title">📐 Mermaid 预览</span>
        <button class="mermaid-preview-close" title="关闭预览">✕</button>
      </div>
      <div class="mermaid-preview-body"></div>
    `;
    // 插入到聊天消息区和输入区之间
    if (this.msgsEl && this.msgsEl.parentElement) {
      this.msgsEl.parentElement.insertBefore(this.mermaidPreviewEl, this.input?.closest('.chat-input-area') || this.msgsEl.nextSibling);
    } else if (this.el) {
      this.el.appendChild(this.mermaidPreviewEl);
    }

    // 关闭按钮
    const closeBtn = this.mermaidPreviewEl.querySelector('.mermaid-preview-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._clearMermaidPreview());
    }
  }

  /** 从文本中提取 mermaid 代码 */
  _extractMermaidCode(text) {
    const regex = /```mermaid\n?([\s\S]*?)```/i;
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  /** 防抖检测 Mermaid 代码并渲染预览 */
  _checkMermaidPreview() {
    if (this._mermaidPreviewTimer) {
      clearTimeout(this._mermaidPreviewTimer);
    }
    this._mermaidPreviewTimer = setTimeout(() => {
      this._mermaidPreviewTimer = null;
      this._doMermaidPreview();
    }, 300);
  }

  /** 实际渲染预览 */
  _doMermaidPreview() {
    if (!this.input || !this.mermaidPreviewEl) return;
    const text = this.input.value;
    const code = this._extractMermaidCode(text);
    const body = this.mermaidPreviewEl.querySelector('.mermaid-preview-body');
    if (!body) return;

    if (!code) {
      this._clearMermaidPreview();
      return;
    }

    // 显示预览面板
    this.mermaidPreviewEl.classList.remove('hidden');

    // 渲染 Mermaid
    body.innerHTML = `<div class="mermaid-preview-content"><div class="mermaid">${this._escapeHtml(code)}</div></div>`;

    // 使用现有 MermaidRenderer 渲染
    requestAnimationFrame(() => {
      if (window.QCLI?.MermaidRenderer) {
        window.QCLI.MermaidRenderer.renderAll();
      }
    });
  }

  /** 清空并隐藏预览 */
  _clearMermaidPreview() {
    if (this.mermaidPreviewEl) {
      this.mermaidPreviewEl.classList.add('hidden');
      const body = this.mermaidPreviewEl.querySelector('.mermaid-preview-body');
      if (body) body.innerHTML = '';
    }
  }

  /** HTML 转义 */
  _escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  }

  // ── AI 讨论模式工具栏（🤝 开关 + 多选 CLI Agent + 回合数）──
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
          const Q = qcli();
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
  }

  // ── Event setup ──

  _setupEvents() {
    // 初始化 Mermaid 预览面板
    Promise.resolve().then(() => this._initMermaidPreview());
    const Q = qcli();

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.toggle());
    }
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => {
        if (this.sending) {
          this.stopGeneration();
        } else {
          this.sendMessage();
        }
      });
    }

    // 拖拽放入 Mermaid 图表到聊天输入区
    const inputArea = this.el?.querySelector('.chat-input-area');
    if (inputArea) {
      inputArea.addEventListener('dragover', (e) => {
        // 只接受携带 mermaid 数据的拖放
        if (e.dataTransfer.types.includes('text/x-mermaid')) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          inputArea.classList.add('chat-input-droptarget');
        }
      });
      inputArea.addEventListener('dragleave', (e) => {
        // 防止子元素边界导致闪烁：仅当真正离开 inputArea 时才移除高亮
        if (!inputArea.contains(e.relatedTarget)) {
          inputArea.classList.remove('chat-input-droptarget');
        }
      });
      inputArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        inputArea.classList.remove('chat-input-droptarget');
        const source = e.dataTransfer.getData('text/x-mermaid');
        if (!source || !this.input) return;

        // 构造 mermaid 代码块文本
        const mermaidBlock = '```mermaid\n' + source + '\n```';

        // 插入到光标位置，前后加空行
        const start = this.input.selectionStart;
        const end = this.input.selectionEnd;
        const before = this.input.value.substring(0, start);
        const after = this.input.value.substring(end);
        const prefix = (before.trim() ? '\n\n' : '');
        const suffix = (after.trim() ? '\n\n' : '');
        this.input.value = before + prefix + mermaidBlock + suffix + after;

        // 触发 input 事件让预览面板更新
        this.input.dispatchEvent(new Event('input'));
        this.input.focus();

        // 打开聊天面板（如果尚未打开）
        if (!this.open) this.toggle();

        if (Q.showToast) Q.showToast('✅ 图表已拖入聊天输入区', 'success');
      });
    }

    // Event delegation: send-to-terminal + copy buttons inside chat messages
    if (this.msgsEl) {
      this.msgsEl.addEventListener('click', (e) => {
        const cmdBtn = e.target.closest('.cmd-send-btn');
        if (cmdBtn) {
          // Find the code text from the preceding <pre><code>
          const pre = cmdBtn.parentElement?.querySelector('pre code');
          if (pre) {
            const cmd = pre.textContent;
            const Q = qcli();
            if (Q.wsSend && Q.Tabs?.activeTabId) {
              Q.wsSend({ type: 'input', data: cmd + '\n', tabId: Q.Tabs.activeTabId });
              if (Q.showToast) Q.showToast('已发送到终端', 'info');
            }
          }
          return;
        }
        const copyBtn = e.target.closest('.md-copy-btn');
        if (copyBtn) {
          const pre = copyBtn.closest('.md-code-block')?.querySelector('pre code');
          if (pre) {
            navigator.clipboard.writeText(pre.textContent).catch(() => {});
            copyBtn.textContent = '✅';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
          }
        }
      });
    }
    if (this.terminalToggleBtn) {
      this.terminalToggleBtn.addEventListener('click', () => this._toggleTerminalContext());
    }
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.clearHistory());
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this.exportChat());
    }
    // ── Drag resize via resize handle ──
    if (this.resizeHandle) {
      let isResizing = false;
      let resizeRAF = null;

      const getTerminalContainer = () =>
        document.getElementById('terminal-container') || this.el.parentElement;

      const onMouseMove = (e) => {
        if (!isResizing) return;
        if (resizeRAF) return;
        resizeRAF = requestAnimationFrame(() => {
          resizeRAF = null;
          const container = getTerminalContainer();
          const containerRect = container.getBoundingClientRect();
          let newHeight = containerRect.bottom - e.clientY;
          if (newHeight < 120) newHeight = 120;
          if (newHeight > containerRect.height * 0.95) newHeight = containerRect.height * 0.95;
          this._applyHeight(Math.round(newHeight));
        });
      };

      const onMouseUp = () => {
        if (!isResizing) return;
        isResizing = false;
        if (resizeRAF) {
          cancelAnimationFrame(resizeRAF);
          resizeRAF = null;
        }
        this.resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this._refitTerminal();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      this.resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        this.resizeHandle.classList.add('active');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    }

    if (this.input) {
      this.input.addEventListener('input', () => {
        this._autoResize();
        this._checkMermaidPreview();
      });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (this.sending) {
            this.stopGeneration();
          } else {
            this.sendMessage();
          }
        }
        if (e.key === 'Escape' && this.open) {
          e.preventDefault();
          if (this.sending) {
            this.stopGeneration();
          } else {
            this.toggle();
            const term = qcli().Tabs?.term || qcli().term;
            if (term && typeof term.focus === 'function') {
              try { term.focus(); } catch (_) { /* term may be disposed — non-critical; user will refocus manually */ }
            }
          }
        }
      });
    }
  }

  // ── Restore persisted state ──

  // ── Terminal Context Toggle ──

  _toggleTerminalContext() {
    this._terminalContextEnabled = !this._terminalContextEnabled;
    safeStorage.set('qcli-terminal-context', this._terminalContextEnabled ? '1' : '0');
    this._updateTerminalToggleUI();
    const Q = qcli();
    const msg = this._terminalContextEnabled
      ? (Q.__?.('chat.terminalOn') || '终端上下文已启用')
      : (Q.__?.('chat.terminalOff') || '终端上下文已禁用');
    if (Q.showToast) Q.showToast(msg, 'info');
  }

  _updateTerminalToggleUI() {
    if (!this.terminalToggleBtn) return;
    const Q = qcli();
    if (this._terminalContextEnabled) {
      this.terminalToggleBtn.classList.add('active');
      this.terminalToggleBtn.title = Q.__?.('chat.terminalOn') || '终端上下文：已启用';
    } else {
      this.terminalToggleBtn.classList.remove('active');
      this.terminalToggleBtn.title = Q.__?.('chat.terminalOff') || '终端上下文：已禁用';
    }
  }

  _restoreState() {
    this._applyHeight(this._getSavedHeight());
    const ctxSaved = safeStorage.get('qcli-terminal-context');
    if (ctxSaved === '0') {
      this._terminalContextEnabled = false;
    }
    this._updateTerminalToggleUI();
    this._loadHistory();
    const wasOpen = safeStorage.get('qcli-chat-open');
    if (wasOpen === '1') {
      this.toggle();
    }
  }

  _getSavedHeight() {
    const saved = safeStorage.get('qcli-chat-height');
    if (saved) {
      const h = parseInt(saved, 10);
      if (h >= 120) return h;
    }
    return 280;
  }

  _applyHeight(height) {
    if (this.el) this.el.style.height = height + 'px';
    safeStorage.set('qcli-chat-height', String(height));
    this._refitTerminal();
  }

  _refitTerminal() {
    const Q = qcli();
    requestAnimationFrame(() => {
      // tabs.js sets Q.Tabs.fitAddon to the real FitAddon instance (or null)
      const fa = Q.Tabs?.fitAddon || Q.fitAddon;
      if (fa && typeof fa.fit === 'function') {
        try { fa.fit(); } catch (e) { console.debug('[ChatPanel] fitAddon.fit:', e?.message); }
        const state = Q.state;
        if (state && state.launched) {
          const dims = fa.proposeDimensions();
          if (dims && Q.wsSend) {
            Q.wsSend({ type: 'resize', cols: dims.cols, rows: dims.rows, tabId: Q.Tabs?.activeTabId });
          }
        }
      }
    });
  }

  _loadHistory() {
    // Memory subsystem takes over session persistence server-side. When enabled,
    // the current session's messages are loaded via Q.MemorySession.init()
    // (which fires onSessionChange). Legacy localStorage is kept only as the
    // fallback for when the subsystem is disabled (MEMORY_ENABLED=false).
    const Q = qcli();
    if (Q.MemorySession && Q.MemorySession.enabled) return;
    const msgs = safeStorage.getJSON('qcli-chat-history');
    if (Array.isArray(msgs) && msgs.length > 0) {
      this.messages = msgs;
      const welcome = this.msgsEl?.querySelector('.welcome-msg');
      if (welcome) welcome.remove();
      this.renderAll();
    }
  }

  _saveHistory() {
    // When the memory subsystem owns persistence, do nothing here — the server
    // stores messages. Otherwise keep the legacy localStorage backup.
    const Q = qcli();
    if (Q.MemorySession && Q.MemorySession.enabled) return;
    const toSave = this.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    safeStorage.setJSON('qcli-chat-history', toSave.slice(-50));
  }

  // Stable per-message id so the server can idempotently merge re-sent history.
  _genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // Apply a server session's messages to the panel (called on load / switch).
  _applySession(id, msgs) {
    const arr = Array.isArray(msgs) ? msgs : [];
    this.messages = arr.map(m => ({
      id: (m && m.id) || this._genId(),
      role: (m && m.role) || 'assistant',
      content: (m && m.content != null) ? String(m.content) : '',
    }));
    // Always re-render, even for an empty session — otherwise the stale DOM
    // from the previously-viewed session lingers in the panel.
    this.renderAll();
    if (this.messages.length === 0 && this.msgsEl && !this.msgsEl.querySelector('.welcome-msg')) {
      const Q = qcli();
      this.msgsEl.innerHTML = `
        <div class="chat-message welcome-msg">
          <div class="msg-avatar ai-avatar">🤖</div>
          <div class="msg-content">
            <div class="msg-sender">${Q.__?.('chat.sender.ai') || "AI Assistant"}</div>
            <div class="msg-bubble ai-bubble">${Q.__?.('chat.welcome') || "Hello! I'm your AI assistant. How can I help you?"}</div>
          </div>
        </div>`;
    }
    this.scrollToBottom();
  }

  // Hook the memory subsystem: subscribe to session switches and restore the
  // current session's messages.
  //
  // IMPORTANT: <chat-panel> is in the static HTML, so the browser upgrades it
  // (fires connectedCallback) synchronously during customElements.define —
  // which runs while chat-panel.js is being evaluated. At that exact moment
  // memory/session-store.js may NOT have run yet, so window.QCLI.MemorySession
  // is still undefined and a naive `if (!M) return;` would silently leave the
  // panel permanently unsubscribed (titles persist via the list, but clicking
  // a session never switches content and refresh never restores it).
  //
  // So we poll briefly for MemorySession instead of bailing out.
  _initMemory() {
    if (this._memoryInitStarted) return;
    this._memoryInitStarted = true;

    const wire = () => {
      const M = qcli().MemorySession;
      if (!M) return false;
      if (this._memoryWired) return true;
      this._memoryWired = true;
      M.onSessionChange((id, msgs) => this._applySession(id, msgs));
      M.init().catch((e) => console.warn('[ChatPanel] MemorySession init failed:', e && e.message));
      // Belt-and-suspenders: if the store already finished activating (e.g. the
      // session list initialized it first), force a restore now so the current
      // conversation shows even if we missed the initial sessionChange event.
      if (M.ready && M.enabled && M.currentId) {
        M.loadMessages(M.currentId)
          .then((msgs) => this._applySession(M.currentId, msgs))
          .catch(() => {});
      }
      return true;
    };

    if (!wire()) {
      const t = setInterval(() => { if (wire()) clearInterval(t); }, 30);
      // Give up after 5s so we never leak a timer if something is badly broken.
      setTimeout(() => clearInterval(t), 5000);
    }
  }

  // ── Textarea auto-resize ──

  _autoResize() {
    if (!this.input) return;
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
  }

  // ── Public: Toggle drawer ──

  toggle() {
    const Q = qcli();
    this.open = !this.open;
    if (this.el) this.el.classList.toggle('hidden', !this.open);
    if (this.toggleBtn) this.toggleBtn.classList.toggle('active', this.open);

    this._refitTerminal();

    if (this.open && this.input) {
      setTimeout(() => this.input.focus(), 100);
    }

    if (this.open) {
      this._applyHeight(this._getSavedHeight());
    }

    safeStorage.set('qcli-chat-open', this.open ? '1' : '0');

    // Sync to store
    if (Q.chatStore) Q.chatStore.setState({ open: this.open });
  }

  // ── Public: Send message ──

  sendMessage() {
    const Q = qcli();
    const text = this.input?.value.trim();
    if (!text || this.sending) return;

    this.sending = true;
    this._abortController = new AbortController();
    this._activeToolCalls = [];
    if (this.input) {
      this.input.value = '';
      this.input.style.height = 'auto';
    }
    // 清空 Mermaid 预览
    this._clearMermaidPreview();
    if (this.sendBtn) {
      this.sendBtn.textContent = '■';
      this.sendBtn.classList.add('stop-btn');
      this.sendBtn.title = '停止生成';
      this.sendBtn.disabled = false;
    }

    // Add user message
    const userMsg = { id: this._genId(), role: 'user', content: text };
    this.messages.push(userMsg);
    this.appendToDOM(userMsg);
    this._saveHistory();
    this.scrollToBottom();

    // Show thinking indicator
    this.showThinking();
    this.scrollToBottom();

    // Sync sending state to store
    if (Q.chatStore) Q.chatStore.setState({ sending: true });

    // Capture the abort controller for this request in the closure
    // so onDone/onError can detect if THIS specific request was aborted
    // (prevents race conditions when user aborts and immediately sends a new message)
    const requestController = this._abortController;

    // Real AI API or mock fallback
        const api = Q.ChatAPI;
        if (api) {
          api.isConfigured().then(async (configured) => {
            if (!configured) {
              this._mockResponse();
              return;
            }

            // Resolve (or create) the server-backed session so messages persist
            // across refresh/restart, not just in localStorage.
            let sessionId = null;
            try {
              const M = Q.MemorySession;
              if (M && M.enabled) {
                const firstUser = this.messages.find(m => m.role === 'user');
                sessionId = await M.ensureCurrent({ title: firstUser ? firstUser.content.slice(0, 40) : '新会话' });
              }
            } catch (e) {
              console.warn('[ChatPanel] ensure session failed:', e && e.message);
            }

            const msgs = this.messages.slice(-50).map(m => ({ id: m.id, role: m.role, content: m.content }));
        let fullResponse = '';

        // ── Read terminal buffer for AI context (incremental diff) ──
        let terminalContext = '';
        let currentTerminalHash = '';
        let contextChanged = false;
        if (this._terminalContextEnabled) {
          const term = Q.Tabs?.term;
          if (term && term.buffer) {
            try {
              const buffer = term.buffer.active;
              const totalLines = buffer.length;
              const maxLines = 100;
              const start = Math.max(0, totalLines - maxLines);
              const currentLines = [];
              for (let y = start; y < totalLines; y++) {
                const line = buffer.getLine(y);
                if (line) currentLines.push(line.translateToString());
              }
              const fullText = currentLines.join('\n');
              // Hash for change detection
              const trimmed = fullText.trim();
              currentTerminalHash = trimmed
                ? trimmed.slice(0, 50) + '|' + trimmed.slice(-50) + '|' + trimmed.length
                : '';
              contextChanged = currentTerminalHash && currentTerminalHash !== this._lastTerminalHash;

              if (contextChanged && this._lastTerminalLines && this._lastTerminalLines.length > 0) {
                // Incremental diff: find first changed line scanning from the bottom up
                const oldLines = this._lastTerminalLines;
                const newLines = currentLines;
                let diffIndex = 0; // 0-based index in newLines where change starts
                const minLen = Math.min(oldLines.length, newLines.length);

                for (let i = 1; i <= minLen; i++) {
                  if (oldLines[oldLines.length - i] !== newLines[newLines.length - i]) {
                    diffIndex = newLines.length - i;
                    break;
                  }
                }

                // Include 3 lines of context before the change
                const contextStart = Math.max(0, diffIndex - 3);
                const deltaLines = newLines.slice(contextStart);
                const deltaSize = deltaLines.length;

                // Only use delta if it's significantly smaller than full content
                if (contextStart > 0 && deltaSize < newLines.length * 0.7) {
                  const header = `[... 以上 ${contextStart} 行未变化，已省略 ...]`;
                  terminalContext = header + '\n' + deltaLines.join('\n');
                } else {
                  terminalContext = fullText;
                }
              } else {
                // First time or unchanged: send full context
                terminalContext = fullText;
              }

              // Save snapshot for next comparison (only read, not yet "committed")
              this._pendingTerminalLines = currentLines;
            } catch (e) { /* terminal buffer not available */ }
          }
        }

        api.sendMessage({
          messages: msgs,
          sessionId: sessionId || undefined,
          terminalContext: terminalContext || undefined,
          terminalContextChanged: contextChanged,
          signal: requestController?.signal,
          discuss: this._discussEnabled,
          partner: this._discussPartner,
          partners: this._discussPartners,
          maxTurns: this._discussMaxTurns,
          onDiscuss: (evt) => this._handleDiscussEvent(evt),
          onToolCall: (evt) => {
            if (evt.type === 'start') {
              for (const n of evt.names || []) {
                this._activeToolCalls.push({ name: n, durMs: 0, status: 'running' });
                this._appendToolCallRow(n);
              }
            } else if (evt.type === 'end') {
              const tc = this._activeToolCalls.find(t => t.name === evt.name && t.status === 'running');
              if (tc) {
                tc.durMs = evt.durMs ?? 0;
                tc.status = 'done';
                this._updateToolCallRow(evt.name, evt.durMs ?? 0, evt.truncated, evt.result);
              }
            }
          },
          onStatus: (msg) => {
            const indicator = document.getElementById('thinking-indicator');
            if (!indicator) return;
            const bubble = indicator.querySelector('.msg-bubble');
            if (!bubble) return;
            const statusEl = bubble.querySelector('.thinking-status');
            if (!statusEl) return;
            // 工具调用类状态（🔧/✅ 开头）已由工具列表项呈现，避免重复显示
            if (msg.startsWith('🔧') || msg.startsWith('✅')) return;
            statusEl.textContent = msg;
            statusEl.classList.add('visible');
          },
          onToken: (token) => {
            // 讨论模式：token 直接追加到「当前发言方气泡」，而非思考指示器
            if (this._discussActive && this._activeDiscussBubble) {
              this._discussText += token;
              const bubble = this._activeDiscussBubble;
              bubble.innerHTML = renderMarkdown(this._discussText) + '<span class="typing-cursor"></span>';
              requestAnimationFrame(() => {
                if (window.QCLI?.MermaidRenderer) window.QCLI.MermaidRenderer.renderAll();
              });
              this.scrollToBottom();
              return;
            }
            fullResponse += token;
            const indicator = document.getElementById('thinking-indicator');
            if (indicator) {
              const bubble = indicator.querySelector('.msg-bubble');
              if (bubble) {
                // 首个 token 到达：保持 thinking class 不变（整个 agentic 过程
                // 都在"思考"态），仅追加流式文本容器 + 更新标题为"生成中"
                let textContainer = bubble.querySelector('.stream-text');
                if (!textContainer) {
                  textContainer = document.createElement('div');
                  textContainer.className = 'stream-text';
                  bubble.appendChild(textContainer);
                  // 标题从"深度思考中"切换为"生成回复中"
                  const titleEl = bubble.querySelector('.thinking-title');
                  if (titleEl) titleEl.textContent = '📝 生成回复中…';
                }
                textContainer.innerHTML = renderMarkdown(fullResponse) + '<span class="typing-cursor"></span>';
                // 渲染 Mermaid 流程图
                requestAnimationFrame(() => {
                  if (window.QCLI?.MermaidRenderer) {
                    window.QCLI.MermaidRenderer.renderAll();
                  }
                });
                this.scrollToBottom();
              }
            }
          },
          onUsage: (usage) => {
            this._lastUsage = usage;
          },
          onToolLive: (evt) => {
            // Agent 实时事件：在思考指示器里展示进度，减少“卡住/断开”错觉
            const indicator = document.getElementById('thinking-indicator');
            if (!indicator) return;
            const bubble = indicator.querySelector('.msg-bubble');
            const statusEl = bubble?.querySelector?.('.thinking-status');
            if (!statusEl) return;
            statusEl.classList.add('visible');
            const ev = evt?.ev;
            if (ev === 'agent_callback') {
              statusEl.textContent = `💬 ${evt.agent || 'Agent'} 求助：${(evt.question || '').slice(0, 120)}`;
            } else if (ev === 'agent_output') {
              const tail = (evt.data || '').slice(-160).replace(/\n+/g, ' ');
              statusEl.textContent = `📜 ${evt.agent || 'Agent'}：${tail}`;
            } else if (ev === 'agent_start') {
              statusEl.textContent = `⚡ ${evt.agent || 'Agent'} 已启动`;
            } else if (ev === 'agent_done') {
              statusEl.textContent = `✅ ${evt.agent || 'Agent'} 完成`;
            }
          },
          onDone: () => {
            // 讨论模式：各发言气泡已在 discuss_end 时落盘，这里不再追加空 assistant 消息
            if (this._discussActive) {
              this._discussActive = false;
              this._activeDiscussBubble = null;
              this._discussText = '';
              this._endSending();
              if (this.input) this.input.focus();
              return;
            }

            // Check if THIS specific request was aborted by the user
            // requestController is captured in closure — even if a new message
            // has been sent, this closure's controller still reflects this request's state
            if (requestController?.signal.aborted) {
              // Aborted: discard pending snapshot + don't save empty message
              this._pendingTerminalLines = null;
              this.removeThinking();
              this._endSending();
              if (this.input) this.input.focus();
              return;
            }

            // Successfully completed: commit terminal snapshot
            if (currentTerminalHash) {
              this._lastTerminalHash = currentTerminalHash;
            }
            if (this._pendingTerminalLines) {
              this._lastTerminalLines = this._pendingTerminalLines;
              this._pendingTerminalLines = null;
            }
            let displayContent = fullResponse;
            // Append token usage badge
            if (this._lastUsage) {
              const u = this._lastUsage;
              let usageStr = '';
              // Anthropic format: input_tokens + output_tokens
              if (u.input_tokens !== undefined) {
                usageStr = `\n\n— Tokens: ${u.input_tokens}→${u.output_tokens || '?'} (in→out)`;
              }
              // OpenAI format: prompt_tokens + completion_tokens + total_tokens
              if (u.total_tokens !== undefined) {
                usageStr = `\n\n— Tokens: ${u.total_tokens} total (${u.prompt_tokens || '?'}→${u.completion_tokens || '?'})`;
              }
              if (usageStr) {
                displayContent += usageStr;
              }
              this._lastUsage = null;
            }

            // ── 工具调用摘要：将本轮工具调用记录追加到最终消息中 ──
            // removeThinking() 会删除包含工具列表的整个 thinking 面板，
            // 若不在此处摘取摘要，所有工具调用痕迹将永久丢失。
            if (this._activeToolCalls && this._activeToolCalls.length > 0) {
              const tools = this._activeToolCalls;
              const lines = tools.map(t => {
                const meta = this._toolMeta(t.name);
                const icon = t.status === 'done' ? '✅' : '⏳';
                return `${icon} ${meta.label} (${t.name})${t.durMs ? ` · ${t.durMs}ms` : ''}`;
              });
              displayContent += `\n\n---\n🔧 **工具调用** (${tools.length}):\n${lines.join('\n')}`;
            }

            const aiMsg = { id: this._genId(), role: 'assistant', content: displayContent };

            // ── 升级 thinking 面板为最终 ai 气泡（不删除重建）──
            // 保留同一个 DOM 节点：位置不变、不闪跳，流式过程中实时展示的
            // 工具列表得以延续到完成态，而不是「面板消失 + 新消息突然出现」。
            // 仅在此时（而非首个 token 时）切换 class：thinking → ai-bubble。
            const indicator = document.getElementById('thinking-indicator');
            let upgraded = false;
            if (indicator) {
              const bubbleEl = indicator.querySelector('.msg-bubble');
              if (bubbleEl) {
                // 更新标题：深度思考中/生成回复中 → ✅ 完成
                const titleEl = bubbleEl.querySelector('.thinking-title');
                if (titleEl) titleEl.textContent = '✅ 完成';
                // 停止动画点
                const dots = bubbleEl.querySelectorAll('.thinking-dot');
                dots.forEach(d => { d.style.animation = 'none'; d.style.opacity = '0.4'; });
                // 折叠箭头改为收起态（面板展开显示完整结果）
                const chevron = bubbleEl.querySelector('.thinking-chevron');
                if (chevron) chevron.textContent = '▾';
                // 切换 class：思考中 → 完成态
                bubbleEl.classList.remove('thinking');
                bubbleEl.classList.add('ai-bubble');
                // 将用量摘要 + 工具调用摘要追加到流式文本容器末尾
                // （displayContent = 流式文本 + 用量行 + 工具摘要，而 .stream-text 目前只有流式文本部分）
                const streamText = bubbleEl.querySelector('.stream-text');
                if (streamText) {
                  // 移除 typing-cursor（已完成态不需要）
                  const cursor = streamText.querySelector('.typing-cursor');
                  if (cursor) cursor.remove();
                  // 追加用量行和工具摘要（如果 displayContent 比纯文本多的话）
                  if (displayContent.length > fullResponse.length) {
                    const extra = displayContent.slice(fullResponse.length);
                    const summaryDiv = document.createElement('div');
                    summaryDiv.className = 'completion-summary';
                    summaryDiv.innerHTML = renderMarkdown(extra);
                    streamText.appendChild(summaryDiv);
                  }
                }
                indicator.id = ''; // 取消 thinking 标识，避免后续 removeThinking 误删
                upgraded = true;
              }
            }
            // 兜底：若面板不存在（异常路径）则按原流程新建气泡
            if (!upgraded) {
              this.appendToDOM(aiMsg);
            }

            this.messages.push(aiMsg);
            this._saveHistory();
            this.scrollToBottom();
            this._endSending();

            // Session list (title/count) reflects the new message.
            if (Q.MemorySession && Q.MemorySession.enabled) Q.MemorySession.refreshList().catch(() => {});

            // Persist the FULL turn (incl. the AI reply) so a refresh / restart
            // restores the whole conversation, not just the user side. The chat
            // route only stores user messages before streaming begins.
            if (Q.MemorySession && Q.MemorySession.enabled && sessionId) {
              Q.MemorySession.append(sessionId, this.messages.slice(-50)).catch(() => {});
            }

            // ── 语音输出：AI 回复后自动朗读 ──
            if (window.QCLI?.VoiceOutput?.speakAIResponse) {
              window.QCLI.VoiceOutput.speakAIResponse(fullResponse);
            }

            if (this.input) this.input.focus();
          },
          onError: (err) => {
            this.removeThinking();

            // Structured error from chat-api.js
            if (typeof err === 'object' && err !== null && err.type) {
              const friendlyMessages = {
                'timeout': '⏱️ ' + (Q.__?.('chat.timeout') || '响应超时，服务器长时间无数据返回，请重试'),
                'stream_error': '🔌 ' + (Q.__?.('chat.streamError') || '流式响应异常，连接中断'),
                'rate_limit': '⏳ ' + (err.message || (Q.__?.('chat.rateLimit') || 'API 调用频率受限（额度/限流），请稍后重试或升级套餐')),
              };
              const toastMsg = friendlyMessages[err.type] || '⚠️ ' + (err.message || '未知错误');
              if (Q.showToast) Q.showToast(toastMsg, err.type === 'timeout' ? 'info' : 'error');

              // Also show error in the chat area as a visible message
              const errorMsg = { role: 'assistant', content: '❌ ' + toastMsg };
              this.messages.push(errorMsg);
              this.appendToDOM(errorMsg);
              this._saveHistory();
              this.scrollToBottom();
            } else if (err === 'NEEDS_KEY') {
              if (Q.showUploadStatus) Q.showUploadStatus(Q.__?.('ai.needsKey') || 'Please configure AI key in settings', 'info');
            } else {
              // Legacy string error — show as Toast + visible message
              const toastMsg = '⚠️ ' + (Q.__?.('chat.error') || '请求出错') + ': ' + err;
              if (Q.showUploadStatus) Q.showUploadStatus(toastMsg, 'error');
              const errorMsg = { role: 'assistant', content: '❌ ' + toastMsg };
              this.messages.push(errorMsg);
              this.appendToDOM(errorMsg);
              this._saveHistory();
              this.scrollToBottom();
            }

            // Note: snapshot NOT updated on error — so retry will re-send terminal context
            this._pendingTerminalLines = null;
            this._endSending();
            if (this.input) this.input.focus();
          },
        });
      });
    } else {
      this._mockResponse();
    }
  }

  _mockResponse() {
    const Q = qcli();
    this.removeThinking();
    const mockResponses = [
      Q.__?.('chat.response1') || 'Hello! How can I help you today?',
      Q.__?.('chat.response2') || 'That\'s an interesting question. Let me think about that...',
      Q.__?.('chat.response3') || 'I can help you with that CLI task.',
      Q.__?.('chat.response4') || 'Here\'s what I found...',
    ];
    const aiMsg = {
      role: 'assistant',
      content: mockResponses[Math.floor(Math.random() * mockResponses.length)],
    };
    this.messages.push(aiMsg);
    this.appendToDOM(aiMsg);
    this._saveHistory();
    this.scrollToBottom();
    this._endSending();
    if (this.input) this.input.focus();
    if (Q.showUploadStatus) Q.showUploadStatus(Q.__?.('ai.needsKey') || 'Configure AI key in settings', 'info');
  }

  _endSending() {
    this.sending = false;
    this._abortController = null;
    if (this.sendBtn) {
      this.sendBtn.textContent = '➤';
      this.sendBtn.classList.remove('stop-btn');
      this.sendBtn.title = '发送';
      this.sendBtn.disabled = false;
    }
    const Q = qcli();
    if (Q.chatStore) Q.chatStore.setState({ sending: false });
  }

  // ── Public: Stop generation ──

  stopGeneration() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this.removeThinking();
    this._endSending();
    if (this.input) this.input.focus();
  }

  // ── Public: Clear history ──

  clearHistory() {
    const Q = qcli();
    if (!confirm(Q.__?.('chat.clearConfirm') || 'Clear all messages?')) return;

    this.messages = [];
    if (this.msgsEl) {
      this.msgsEl.innerHTML = `
        <div class="chat-message welcome-msg">
          <div class="msg-avatar ai-avatar">🤖</div>
          <div class="msg-content">
            <div class="msg-sender">${Q.__?.('chat.sender.ai') || 'AI Assistant'}</div>
            <div class="msg-bubble ai-bubble">${Q.__?.('chat.welcome') || 'Hello! I\'m your AI assistant. How can I help you?'}</div>
          </div>
        </div>
      `;
    }
    this._saveHistory();

    // Memory mode: a "clear" starts a NEW session but keeps the old one in
    // the list (nothing is lost). The old session remains restorable.
    if (Q.MemorySession && Q.MemorySession.enabled) {
      Q.MemorySession.create().catch(() => {});
    }
  }

  // ── Public: Export chat ──

  exportChat() {
    if (this.messages.length === 0) return;
    const lines = ['# Hesi 聊天记录导出', '', `> 导出时间：${new Date().toLocaleString()}`, '', '---', ''];
    for (const m of this.messages) {
      const role = m.role === 'user' ? '👤 **You**' : '🟦 **AI 助手**';
      lines.push(role);
      lines.push('');
      lines.push(m.content || '（空消息）');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    const md = lines.join('\n');
    // 用 text/plain + .md 扩展名确保 Windows 浏览器不会忽略扩展名
    const blob = new Blob([md], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `hesi-chat-${dateStr}.md`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 延迟清理，确保浏览器已触发下载
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ── Public: Rendering ──

  renderAll() {
    if (!this.msgsEl) return;
    this.msgsEl.innerHTML = '';
    for (const msg of this.messages) {
      this.appendToDOM(msg, false);
    }
    this.scrollToBottom();
  }

  // ── AI 讨论模式：把每一轮发言渲染成独立、带标签的气泡 ──
  _handleDiscussEvent(evt) {
    if (!this.msgsEl) return;
    if (evt.type === 'start') {
      // 新发言方开始：移除思考指示器，开一个带标签的新气泡
      this.removeThinking();
      const Q = qcli();
      const div = document.createElement('div');
      div.className = 'chat-message discuss-message discuss-' + (evt.speaker || 'ai');
      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar discuss-avatar ' + (evt.speaker === 'cli' ? 'cli-avatar' : evt.speaker === 'summary' ? 'summary-avatar' : 'ai-avatar');
      avatar.textContent = evt.speaker === 'cli' ? '🟩' : evt.speaker === 'summary' ? '📋' : '🟦';
      div.appendChild(avatar);
      const content = document.createElement('div');
      content.className = 'msg-content';
      const sender = document.createElement('div');
      sender.className = 'msg-sender discuss-sender';
      const roundTxt = evt.round ? ` · 第 ${evt.round} 轮` : '';
      sender.textContent = (evt.label || 'AI 助手') + roundTxt;
      content.appendChild(sender);
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble discuss-bubble';
      content.appendChild(bubble);
      div.appendChild(content);
      this.msgsEl.appendChild(div);
      this._discussActive = true;
      this._activeDiscussBubble = bubble;
      this._discussText = '';
      this._discussPendingMsg = { role: evt.speaker === 'cli' ? 'tool' : 'assistant', content: '', _speaker: evt.speaker, _label: evt.label };
      this.scrollToBottom();
    } else if (evt.type === 'end') {
      // 发言结束：把气泡最终内容落盘到消息历史
      if (this._activeDiscussBubble) {
        this._activeDiscussBubble.innerHTML = renderMarkdown(this._discussText || '（无内容）');
        requestAnimationFrame(() => { if (window.QCLI?.MermaidRenderer) window.QCLI.MermaidRenderer.renderAll(); });
      }
      if (this._discussPendingMsg) {
        this._discussPendingMsg.content = this._discussText || '（无内容）';
        this.messages.push(this._discussPendingMsg);
      }
      this._discussActive = false;
      this._activeDiscussBubble = null;
      this._discussText = '';
      this._discussPendingMsg = null;
      this._saveHistory();
      this.scrollToBottom();
    } else if (evt.type === 'stats') {
      // 讨论结束后的 token 消耗报告（圆桌 vs 单模型 成本可见）
      const s = evt.stats || {};
      const agents = s.agents || 0;
      const rounds = s.rounds || 0;
      const cliEst = s.cliEstTokens || 0;
      const cliChars = s.cliOutputChars || 0;
      const div = document.createElement('div');
      div.className = 'chat-message discuss-message discuss-stats';
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble discuss-stats-bubble';
      bubble.innerHTML = `<div class="discuss-stats-title">💱 本次讨论 token 消耗</div>`
        + `<div class="discuss-stats-row">AI 助手 / 汇总（API 精确）：输入 <b>${s.aiInputTokens || 0}</b> · 输出 <b>${s.aiOutputTokens || 0}</b></div>`
        + `<div class="discuss-stats-row">CLI Agent（${agents} 个 · ${rounds} 轮）：估算输出 ≈ <b>${cliEst}</b> token（${cliChars} 字符，其内部消耗未计入）</div>`
        + `<div class="discuss-stats-hint">提示：多 Agent 圆桌会随「Agent 数 × 轮数」近似超线性放大 token，质量提升并非免费。</div>`;
      div.appendChild(bubble);
      this.msgsEl.appendChild(div);
      this._saveHistory();
      this.scrollToBottom();
    }
  }

  appendToDOM(msg, animate = true) {
    if (!this.msgsEl) return;
    const Q = qcli();
    const div = document.createElement('div');
    div.className = 'chat-message' + (msg.role === 'user' ? ' user-message' : '');
    if (!animate) div.style.animation = 'none';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar' + (msg.role === 'assistant' ? ' ai-avatar' : '');
    avatar.textContent = msg.role === 'user' ? '\ud83d\udc64' : '\ud83e\udd16';
    div.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = msg.role === 'user' ? (Q.__?.('chat.sender.you') || 'You') : (Q.__?.('chat.sender.ai') || 'AI');
    content.appendChild(sender);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + (msg.role === 'user' ? 'user-bubble' : 'ai-bubble');
    if (msg.role === 'assistant') {
      bubble.innerHTML = renderMarkdown(msg.content);
      // 渲染 Mermaid 流程图
      requestAnimationFrame(() => {
        if (window.QCLI?.MermaidRenderer) {
          window.QCLI.MermaidRenderer.renderAll();
        }
      });
    } else {
      bubble.textContent = msg.content;
    }
    content.appendChild(bubble);

    div.appendChild(content);
    this.msgsEl.appendChild(div);
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      if (this.msgsEl) this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
    });
  }

  showThinking() {
    if (!this.msgsEl) return;
    const Q = window.QCLI || {};
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.id = 'thinking-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar ai-avatar';
    avatar.textContent = '\ud83e\udd16';
    div.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'msg-content';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = Q.__?.('chat.sender.ai') || 'AI';
    content.appendChild(sender);

    // 深度思考面板：标题 + 工具调用列表 + 系统状态行（WorkBuddy 风格）
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble thinking';

    // 标题行（可点击折叠）：动画点 + "深度思考中" + 折叠箭头
    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.title = '点击折叠/展开';

    const dotsContainer = document.createElement('span');
    dotsContainer.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'thinking-dot';
      dotsContainer.appendChild(dot);
    }
    header.appendChild(dotsContainer);

    const titleEl = document.createElement('span');
    titleEl.className = 'thinking-title';
    titleEl.textContent = '🤔 深度思考中…';
    header.appendChild(titleEl);

    const chevron = document.createElement('span');
    chevron.className = 'thinking-chevron';
    chevron.textContent = '▾'; // ▾
    header.appendChild(chevron);

    bubble.appendChild(header);

    // 折叠主体：工具列表 + 系统状态行
    const body = document.createElement('div');
    body.className = 'thinking-body';

    // 工具调用列表容器（每次工具调用追加一行，完成后更新状态）
    const listEl = document.createElement('div');
    listEl.className = 'tool-call-list';
    listEl.id = 'tool-call-list';

    // 占位文字：工具列表为空时显示，首个工具到达时移除
    const placeholder = document.createElement('div');
    placeholder.className = 'tool-call-placeholder';
    placeholder.textContent = '⏳ 等待工具调用…';
    listEl.appendChild(placeholder);

    body.appendChild(listEl);

    // 保存列表元素引用，避免多消息并发时 getElementById 命中错误节点
    this._toolCallListEl = listEl;

    // 系统状态行（重试/续传/生成回答/超时 等）
    const statusEl = document.createElement('span');
    statusEl.className = 'thinking-status';
    statusEl.textContent = '';
    body.appendChild(statusEl);

    bubble.appendChild(body);

    // 点击标题折叠/展开主体
    const toggle = () => {
      const collapsed = bubble.classList.toggle('collapsed');
      chevron.textContent = collapsed ? '▸' : '▾'; // ▸ / ▾
      this.scrollToBottom();
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    content.appendChild(bubble);
    div.appendChild(content);
    this.msgsEl.appendChild(div);

    // 重置当前轮的工具调用追踪
    this._activeToolCalls = [];

    // 刷新任何在 thinking-indicator 创建前到达的缓冲 Agent 事件
    // 顺序执行微任务让 DOM 先完成渲染，再播放缓冲事件
    Promise.resolve().then(() => {
      if (this._agentRenderer) this._agentRenderer.flushAgentBuffer();
    });
  }

  // ── 工具调用列表渲染（深度思考面板内）──
  // 工具名 → 语义化图标 + 动作标签（纯前端映射，零额外请求）
  _toolMeta(name) {
    const MAP = {
      exec_terminal: { icon: '💻', label: '执行命令' },
      get_self_info: { icon: 'ℹ️', label: '读取系统信息' },
      browser_info: { icon: '🌐', label: '浏览器信息' },
      browser_ping: { icon: '🌐', label: '浏览器连接测试' },
      browser_accessibility: { icon: '♿', label: '可访问性审计' },
      list_clis: { icon: '🔌', label: '列出 CLI' },
      list_agents: { icon: '🤖', label: '列出智能体' },
      list_workflows: { icon: '🔄', label: '列出工作流' },
      agent_poll: { icon: '📡', label: '轮询智能体' },
      search_files: { icon: '🔍', label: '搜索文件' },
      search_web: { icon: '🔍', label: '搜索网络' },
      read_file: { icon: '📄', label: '读取文件' },
      write_file: { icon: '✏️', label: '写入文件' },
      edit_file: { icon: '✏️', label: '编辑文件' },
    };
    if (MAP[name]) return MAP[name];
    if (name && name.startsWith('search')) return { icon: '🔍', label: '搜索' };
    if (name && (name.startsWith('edit') || name.startsWith('write'))) return { icon: '✏️', label: '编辑文件' };
    if (name && name.startsWith('read')) return { icon: '📄', label: '读取文件' };
    if (name && name.startsWith('list')) return { icon: '📋', label: '列出' };
    return { icon: '🔧', label: name };
  }

  _appendToolCallRow(name) {
    const list = this._toolCallListEl;
    if (!list) return;
    // 首个工具到达时移除占位文字
    const ph = list.querySelector('.tool-call-placeholder');
    if (ph) ph.remove();
    const meta = this._toolMeta(name);
    const row = document.createElement('div');
    row.className = 'tool-call-item running';
    row.dataset.toolName = name;

    const icon = document.createElement('span');
    icon.className = 'tci-icon';
    icon.textContent = meta.icon;

    const textWrap = document.createElement('span');
    textWrap.className = 'tci-text';

    const nm = document.createElement('span');
    nm.className = 'tci-name';
    nm.textContent = meta.label;

    const detail = document.createElement('span');
    detail.className = 'tci-detail';
    detail.textContent = name;

    textWrap.appendChild(nm);
    textWrap.appendChild(detail);

    const state = document.createElement('span');
    state.className = 'tci-state';
    state.textContent = '运行中…';

    row.appendChild(icon);
    row.appendChild(textWrap);
    row.appendChild(state);
    list.appendChild(row);
    this.scrollToBottom();
  }

  _updateToolCallRow(name, durMs, truncated, result) {
    const list = this._toolCallListEl;
    if (!list) return;
    const row = list.querySelector(`[data-tool-name="${CSS.escape(name)}"]`);
    if (!row) return;
    row.classList.remove('running');
    row.classList.add('done');
    const state = row.querySelector('.tci-state');
    if (state) {
      state.textContent = `✓ 完成 · ${durMs}ms${truncated ? '（结果较长已省略）' : ''}`;
    }
    // 工具结果预览（用 textContent 渲染，防 XSS；只追加一次）
    if (result && !row.querySelector('.tool-preview')) {
      const pre = document.createElement('pre');
      pre.className = 'tool-preview';
      pre.textContent = result;
      row.appendChild(pre);
    }
    this.scrollToBottom();
  }

  removeThinking() {
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
    // 清理 Agent 实时会话状态（已重构为由 AgentSessionRenderer 托管）
    if (this._agentRenderer && typeof this._agentRenderer.clear === 'function') {
      this._agentRenderer.clear();
    }
  }


}

customElements.define('chat-panel', ChatPanel);

export default ChatPanel;
