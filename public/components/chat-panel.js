/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

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
import { renderMarkdown } from './message-render.js';
import { buildBenefitBar } from './benefit-bar.js';
import { computeSavings } from './savings-icon.js';
import { computeContextUsage } from './context-usage.js';
import { mountCategoryChips, getActiveCategory } from './category-chips.js';
import { mermaidPreviewMixin } from './chat/mermaid-preview.js';
import { discussControlsMixin } from './chat/discuss-controls.js';
import { planControlsMixin } from './chat/plan-controls.js';
import { planStreamMixin } from './chat/plan-stream.js';
import { planStepBubbleMixin } from './chat/plan-step-bubble.js';
import { attachmentsMixin } from './chat/attachments.js';
import { historySessionMixin } from './chat/history-session.js';
import { sidePanelsMixin } from './chat/side-panels.js';
import { metricsSavingsMixin } from './chat/metrics-savings.js';
import { messageDomMixin } from './chat/message-dom.js';
import { terminalContextMixin } from './chat/terminal-context.js';
import { nextTip } from './chat/thinking-tips.js';

/** @typedef {import('../types').QCLI} QCLI */
/** @typedef {{role:string, content:string}} ChatMessage */
/** @typedef {{name:string, durMs:number, status:string}} ToolCallInfo */
/** @typedef {{type:string, names?:string[], name?:string, durMs?:number}} ToolCallEvent */

// ============================================================
// Markdown renderer — lightweight, no external deps
// ============================================================

/** @returns {QCLI} */
function qcli() { return /** @type {QCLI} */ (window.QCLI || {}); }

// renderMarkdown + linkify were extracted to ./message-render.js (P2.1).

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
    this.blackboardBtn = null;
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
    /** @type {number|null} */
    this._thinkingTipInterval = null;
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

    // ── ⚡ 自动执行（Plan）模式状态（P2）──
    this._planEnabled = false;        // 开关是否打开
    this._planAgentId = 'ai';         // 执行方：'ai' 或外部 CLI agent id
    this._planTurnActive = false;     // 本轮是否为自动执行回合（onDone 分流用）
    this._planCard = null;            // 当前执行总览条 DOM 句柄
    this._planStepRows = null;        // stepId -> 总览清单行 DOM
    this._planStepBubbles = null;     // stepId -> 步骤气泡句柄（P1：并入对话时间线）
    this._planActiveBubble = null;    // 当前活跃步骤气泡（增量输出归属）
    this._planStepSeq = 0;            // 步骤序号计数（无 index 时兜底）
    this._planTotalSteps = 0;         // 计划总步数（进度分母）
    this._planDoneCount = 0;          // 已到终态步数（进度分子）

    // ── 多模态附件（对话框发送给 AI 的图片/视频/文本文件）──
    this.pendingAttachments = [];     // 待发送附件（短 URL + 元数据，不含 base64）
    this.attachBtn = null;
    this.fileInput = null;
    this.attachPreviewEl = null;
    this.verifyBtn = null;
    this._verifyMode = false;     // 核查模式（verify-first）：开启后 AI 先取证再作答
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
    this.blackboardBtn = document.getElementById('chat-blackboard-btn');
    this.roundtableBtn = document.getElementById('chat-roundtable-btn');
    this.planBtn = null; // P7：抽屉已移除
    this.savingsBtn = document.getElementById('chat-savings-btn');
    this.contextBtn = document.getElementById('chat-context-btn'); // P0.6 占用率圆环
    this.resizeHandle = document.getElementById('chat-resize-handle');
    this.attachBtn = document.getElementById('chat-attach-btn');
    this.fileInput = document.getElementById('chat-file-input');
    this.attachPreviewEl = document.getElementById('chat-attachments');
    this.verifyBtn = document.getElementById('chat-verify-btn');
    // 核查模式（verify-first）：从 localStorage 恢复开关状态并同步按钮高亮
    this._verifyMode = localStorage.getItem('qcli-verify-mode') === '1';
    if (this.verifyBtn) {
      this.verifyBtn.classList.toggle('active', this._verifyMode);
      this.verifyBtn.addEventListener('click', () => this._toggleVerifyMode());
    }

    // ── 会话级 token 节省记账（M5 后续增强 → 持久化到 session.turnMetrics，单一数据源）──
    this._roundUsed = 0;    // 本轮实际消耗 tokens（来自 onUsage 累加）
    this._roundSaved = 0;   // 本轮估算节省 tokens（来自 agent_metrics）
    this._roundMetrics = { cacheRead: 0, cacheWrite: 0, toolReuse: 0, exp: 0, skills: 0 }; // 本轮 agent_metrics 字段累计
    this._sessionSavings = { saved: 0, used: 0 }; // 当前会话累计（从 turnMetrics 种子化 + 本轮累加）
    this._pendingRollbackSeq = null; // 回滚改良（P2）：挂起的回滚检查点 seq

    if (!this.el) {
      console.warn('[ChatPanel] #chat-drawer not found');
      return;
    }

    this._setupEvents();
    this._setupDiscussControls();
    this._setupPlanControls();
    this._restoreState();
    this._patchQCLI();
    this._initCategoryChips();
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
        Q.ChatUI.sendChatMessage = (text) => { if (typeof text === 'string' && this.input) this.input.value = text; this.sendMessage(); };
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

  // ── Mermaid 实时预览：已抽离到 ./chat/mermaid-preview.js（mixin + 纯函数）──

  // ── AI 讨论模式工具栏（🤝 开关 + 多选 CLI Agent + 回合数）──
  // ── 圆桌/讨论控件：已抽离到 ./chat/discuss-controls.js（mixin）──

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

    // ── 附件按钮：选择文件并上传 ──
    if (this.attachBtn && this.fileInput) {
      this.attachBtn.addEventListener('click', () => this.fileInput.click());
      this.fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) this._handleFiles(files);
        e.target.value = ''; // 允许重复选择同一文件
      });
    }

    // 拖拽放入 Mermaid 图表到聊天输入区
    const inputArea = this.el?.querySelector('.chat-input-area');
    if (inputArea) {
      inputArea.addEventListener('dragover', (e) => {
        // 接受 mermaid 文本拖放 + 普通文件拖放
        const hasMermaid = e.dataTransfer.types.includes('text/x-mermaid');
        const hasFiles = e.dataTransfer.types.includes('Files');
        if (hasMermaid || hasFiles) {
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
        // 普通文件拖入 → 上传为附件（复用 _handleFiles，与 📎 选择同源）
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this._handleFiles(e.dataTransfer.files);
          return;
        }
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

      // 粘贴上传：Ctrl+V 图片/视频/文件 → 走 _handleFiles（与 📎 选择同源）
      inputArea.addEventListener('paste', (e) => this._onPaste(e));
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
    if (this.blackboardBtn) {
      this.blackboardBtn.addEventListener('click', () => this.toggleBlackboardPanel());
      // ⚠️ ✕ 收起按钮不能在此绑定：#blackboard-embed 在 body 末尾，
      // bundle.js 同步加载（无 defer）执行到这里时该节点尚未解析，getElementById 为 null。
      // 改为 toggleBlackboardPanel() 内首次展开时懒绑定。
    }
    if (this.roundtableBtn) {
      this.roundtableBtn.addEventListener('click', () => this.toggleMahjongPanel(undefined, 'hearth'));
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

  // ── 终端上下文开关/UI：已抽离到 ./chat/terminal-context.js（mixin）──

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

  // ── 终端 fit/resize：已抽离到 ./chat/terminal-context.js（mixin）──

  // ── 历史/会话/回滚/历史面板：已抽离到 ./chat/history-session.js（mixin）──

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

  // ── 分类 Chips（对话模式选择条，两级小功能）──
  // 组件内部封装全部状态/持久化；发消息时由 getActiveCategory() 实时读取当前选择，
  // 故此处仅负责挂载，不再缓存 this.category（避免同标签页切换后发送值滞后）。
  _initCategoryChips() {
    const el = document.getElementById('category-chips');
    if (el) mountCategoryChips(el);
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

  // ── 多模态附件：已抽离到 ./chat/attachments.js（纯函数 compressImage + mixin）──

  // ── 核查模式（verify-first）开关 ──
  _toggleVerifyMode() {
    this._verifyMode = !this._verifyMode;
    localStorage.setItem('qcli-verify-mode', this._verifyMode ? '1' : '0');
    if (this.verifyBtn) this.verifyBtn.classList.toggle('active', this._verifyMode);
  }

  async sendMessage() {
    const Q = qcli();
    let text = this.input?.value.trim();
    const hasAttachments = this.pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || this.sending) return;
    if (!text) text = ''; // 允许纯附件发送（不带文字）

    // 回滚改良（P2）：确认发送后才回滚到目标轮之前。
    // 必须在置 sending=true 之前 await，否则 rollbackSession 的 sending 守卫会拦截。
    const pendingSeq = this._pendingRollbackSeq;
    this._pendingRollbackSeq = null;
    this._clearEditBanner();
    if (pendingSeq != null) {
      await this.rollbackSession(pendingSeq); // 恢复该轮之前状态（内部 _applySession 重载 messages）
    }

    this.sending = true;
    this._abortController = new AbortController();
    this._activeToolCalls = [];
    if (this.input) {
      this.input.value = '';
      this.input.style.height = 'auto';
    }
    // 先捕获待发送附件（务必在清空之前），随后随 userMsg 一起发出
    const outAttachments = hasAttachments ? this.pendingAttachments.slice() : [];
    // 清空待发送附件（已随 userMsg 发出）
    this.pendingAttachments = [];
    this._renderPendingAttachments();
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
    if (hasAttachments) userMsg.attachments = outAttachments;
    this.messages.push(userMsg);
    this.appendToDOM(userMsg);
    this._saveHistory();
    // 同步快照：防止 MemorySession 会话恢复（_applySession）在后续异步回调中
    // 整体覆盖 this.messages，导致向 /api/chat 发出空 messages 数组（首次对话必现报错）。
    const requestMsgs = this.messages.slice(-50).map(m => {
      const o = { id: m.id, role: m.role, content: m.content };
      if (Array.isArray(m.attachments) && m.attachments.length) o.attachments = m.attachments;
      return o;
    });
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
                this._sessionId = sessionId || this._sessionId;
              }
            } catch (e) {
              console.warn('[ChatPanel] ensure session failed:', e && e.message);
            }

            const msgs = requestMsgs;
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

        // M5 (v0.3.1): 新一轮开始时移除上一轮回合收益条，避免其残留在消息流中间
        const _oldBenefit = this.msgsEl?.querySelector('.hesi-round-benefit');
        if (_oldBenefit) _oldBenefit.remove();

        // 重置本轮节省记账（M5 后续增强）
        this._roundUsed = 0;
        this._roundSaved = 0;
        this._roundMetrics = { cacheRead: 0, cacheWrite: 0, toolReuse: 0, exp: 0, skills: 0 };

        // 流式朗读缓冲（B-core：增量分句边生成边读）
        this._ttsBuffer = '';
        this._ttsStreamed = false;

        // 自动执行回合标记（onDone/onError 分流；讨论优先时不生效，与后端一致）
        // P6：允许同时勾选讨论和自动执行→协作工作流（讨论→方案→实施）
        this._planTurnActive = !!this._planEnabled;

        api.sendMessage({
          messages: msgs,
          category: getActiveCategory() || undefined,
          verifyMode: this._verifyMode,
          sessionId: sessionId || undefined,
          terminalContext: terminalContext || undefined,
          terminalContextChanged: contextChanged,
          signal: requestController?.signal,
          discuss: this._discussEnabled,
          partner: this._discussPartner,
          partners: this._discussPartners,
          maxTurns: this._discussMaxTurns,
          onDiscuss: (evt) => this._handleDiscussEvent(evt),
          planMode: this._planEnabled,
          planAgentId: this._planAgentId,
          fullAccess: !!this._planFullAccess,
          onPlan: (evt) => this._handlePlanEvent(evt),
          // Fix #3: 协作流（planMode）下，业务级 error（如"未配置 API Key"）
          // 走 onError 但不 cancel reader，让 plan_error / plan_done 继续到达前端。
          keepStreamOnError: !!this._planEnabled,
          onToolCall: (evt) => {
            // 普通对话轮：工具调用改为随流内联折叠块（精确落在触发句下方）。
            // 计划/讨论等独立编排通道仍走旧面板列表，避免改动其专用渲染。
            const inChat = !this._planTurnActive && !this._discussActive;
            if (evt.type === 'start') {
              for (const n of evt.names || []) {
                this._activeToolCalls.push({ name: n, durMs: 0, status: 'running' });
                if (inChat) this._appendInlineTool(n, fullResponse.length);
                else this._appendToolCallRow(n);
              }
            } else if (evt.type === 'end') {
              const tc = this._activeToolCalls.find(t => t.name === evt.name && t.status === 'running');
              if (tc) {
                tc.durMs = evt.durMs ?? 0;
                tc.status = 'done';
                if (inChat) this._updateInlineTool(evt.name, evt.durMs ?? 0, evt.truncated, evt.result);
                else this._updateToolCallRow(evt.name, evt.durMs ?? 0, evt.truncated, evt.result);
              }
            }
          },
          onReasoning: (c) => {
            // L1 (v0.7.4): 推理流透传渲染。首 chunk 到达时展开灰块并标记"真推理中"。
            const indicator = document.getElementById('thinking-indicator');
            if (!indicator) return;
            const bubble = indicator.querySelector('.msg-bubble');
            if (!bubble) return;
            const rEl = bubble.querySelector('.thinking-reasoning');
            if (!rEl) return;
            if (!this._reasoningStarted) {
              this._reasoningStarted = true;
              rEl.hidden = false;
              rEl.classList.remove('collapsed');
              const rHeader = rEl.querySelector('.tr-header');
              if (rHeader) rHeader.textContent = '🧠 推理过程（点击折叠）';
              const titleEl = bubble.querySelector('.thinking-title');
              if (titleEl) titleEl.textContent = '🧠 推理中…';
            }
            const body = rEl.querySelector('.tr-body');
            if (body) body.appendChild(document.createTextNode(c));
            this.scrollToBottom();
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
            this._ttsStreamOnToken(token);
            const indicator = document.getElementById('thinking-indicator');
            if (indicator) {
              const bubble = indicator.querySelector('.msg-bubble');
              if (bubble) {
                // 首个 token 到达：保持 thinking class 不变（整个 agentic 过程
                // 都在"思考"态），仅追加流式文本容器 + 更新标题为"生成中"。
                // 采用「分段流式文本」：每次工具调用会把当前段冻结、在其后插入
                // 内联折叠工具块，再开新段接后续文字 → 工具记录精确落在触发句下方，
                // 且不会被整段 innerHTML 重绘覆盖。
                const seg = this._ensureStreamSeg(bubble);
                if (seg) {
                  // 仅渲染当前活跃段对应的「增量文本」（已冻结段不再重绘）
                  const newText = fullResponse.slice(this._frozenLen);
                  seg.innerHTML = renderMarkdown(newText) + '<span class="typing-cursor"></span>';
                  // 渲染 Mermaid 流程图
                  requestAnimationFrame(() => {
                    if (window.QCLI?.MermaidRenderer) {
                      window.QCLI.MermaidRenderer.renderAll();
                    }
                  });
                  this.scrollToBottom();
                }
              }
            }
          },
          onUsage: (usage) => {
            this._lastUsage = usage;
            // 累加本轮实际消耗 tokens（input+output / prompt+completion）
            const used = (usage.input_tokens ?? usage.prompt_tokens ?? 0)
              + (usage.output_tokens ?? usage.completion_tokens ?? 0);
            if (used > 0) this._roundUsed += used;
          },
          onAgentMetrics: (m) => {
            this.renderRoundBenefit(m);
            // 累加本轮估算节省 tokens（与 M5 收益条同一估算口径）
            const saved = (m.cacheReadTokens || 0)
              + (m.toolCacheHits || 0) * 800
              + (m.experienceHits || 0) * 1500;
            this._roundSaved += saved;
            // 累加本轮各分项，供 _buildTurnMetric 持久化完整收益
            const rm = this._roundMetrics || (this._roundMetrics = {});
            rm.cacheRead = (rm.cacheRead || 0) + (m.cacheReadTokens || 0);
            rm.cacheWrite = (rm.cacheWrite || 0) + (m.cacheCreationTokens || 0);
            rm.toolReuse = (rm.toolReuse || 0) + (m.toolCacheHits || 0);
            rm.exp = (rm.exp || 0) + (m.experienceHits || 0);
            rm.skills = (rm.skills || 0) + (m.skillsInjected || 0);
            rm.compactCount = (rm.compactCount || 0) + (m.compactCount || 0);
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
            // 自动执行模式：执行卡片已在 plan_done/error/cancelled 时落盘，
            // 这里不再追加空 assistant 消息（与讨论模式同款分流）。
            if (this._planTurnActive) {
              this._planTurnActive = false;
              // 兜底：后端异常早退未发终态 → 收掉悬空卡片，避免永远停在「执行中」
              if (this._planCard) this._finishPlanCard({ ok: false, status: 'interrupted' }, true);
              this.removeThinking();
              this._endSending();
              if (this.input) this.input.focus();
              // 指标联动：自动执行结束也刷新缓存命中/上下文占用圆环
              if (sessionId) this._recordTurnMetrics(sessionId);
              return;
            }

            // 讨论模式：各发言气泡已在 discuss_end 时落盘，这里不再追加空 assistant 消息
            if (this._discussActive) {
              this._discussActive = false;
              this._activeDiscussBubble = null;
              this._discussText = '';
              this._endSending();
              if (this.input) this.input.focus();
              // 指标联动：讨论结束刷新上下文占用圆环（savings 已由 discuss_stats 更新）
              if (sessionId) this._recordTurnMetrics(sessionId);
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
            // 不再在消息末尾追加 "— Tokens: ..." 行。
            // 会话级 token/缓存/上下文信息已由顶部「提示环」（context-usage /
            // savings-icon）统一展示，每条消息末尾的用量行显得冗余且干扰阅读。
            // 若后续需要单轮精确用量，可从 memory timeline 或 hover 详情中查看。
            this._lastUsage = null;

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
                // 完成态：移除各分段流式文本里的 typing-cursor（已完成态不需要）。
                // 注意：工具调用已随流呈现为内联折叠块（.inline-tool），
                // 不再把工具/用量摘要作为独立块追加到末尾（消除"输出完留大空白再 dump"）。
                // displayContent 仍保留一份紧凑工具记录供刷新/历史回溯，但不渲染进实时气泡。
                bubbleEl.querySelectorAll('.stream-text .typing-cursor').forEach(c => c.remove());
                indicator.id = ''; // 取消 thinking 标识，避免后续 removeThinking 误删
                this._clearThinkingTipInterval();
                // 完成后淡出小贴士，避免占据完成态气泡空间
                const tipEl = bubbleEl.querySelector('.thinking-tip');
                if (tipEl) {
                  tipEl.style.transition = 'opacity 0.3s ease';
                  tipEl.style.opacity = '0';
                  window.setTimeout(() => { if (tipEl) tipEl.remove(); }, 300);
                }
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
              Q.MemorySession.append(sessionId, this.messages.slice(-50))
                .then(() => fetch('/api/memory/sessions/' + encodeURIComponent(sessionId)))
                .then((r) => (r && r.ok ? r.json() : null))
                .then((s) => {
                  if (!s || !Array.isArray(s.messages)) return;
                  // 回滚改良：服务端已为该轮（及历史）assistant 消息打 seq，但本地
                  // 直播流消息对象无 seq，导致气泡下方不渲染「重新编辑/重新生成」按钮。
                  // 此处按消息 id 把服务端 seq 回灌到本地 assistant 消息，再局部重渲染
                  // 使其出现（刷新页面也会自然带出 seq，这里补上「直播流即时可见」）。
                  const seqById = new Map();
                  for (const m of s.messages) if (m && m.id != null) seqById.set(m.id, m.seq);
                  let changed = false;
                  for (const m of this.messages) {
                    if (Number.isInteger(seqById.get(m.id)) && m.seq !== seqById.get(m.id)) {
                      m.seq = seqById.get(m.id);
                      changed = true;
                    }
                  }
                  if (changed) this.renderAll();
                })
                .catch(() => {});
            }

            // ── 会话级节省记账（M5 后续增强）：持久化本轮收益 + 累加图标 ──
            if (sessionId) {
              this._recordTurnMetrics(sessionId);
            }

            // ── 语音输出：流式增量朗读（B-core），余量在 onDone flush ──
            if (window.QCLI?.VoiceOutput) {
              const VO = window.QCLI.VoiceOutput;
              if (this._ttsBuffer && this._ttsBuffer.trim()) {
                VO.speakSentence(this._ttsBuffer.trim());
                this._ttsBuffer = '';
              } else if (!this._ttsStreamed) {
                VO.speakAIResponse(fullResponse);
              }
            }

            if (this.input) this.input.focus();
          },
          onError: (err) => {
            this.removeThinking();
            // 自动执行回合出错：先收掉悬空执行卡片，避免永远停在「执行中」
            if (this._planTurnActive) {
              this._planTurnActive = false;
              if (this._planCard) this._finishPlanCard({ ok: false, status: 'error' }, true);
            }

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
            // 错误轮也累加已发生的消耗（若有），保证百分比不漏计
            if (sessionId) {
              this._recordTurnMetrics(sessionId);
            }
          },
        });
      });
    } else {
      this._mockResponse();
    }
  }

  // ── 回滚改良（P2）：消息内「重新编辑 / 重新生成」──
  // 取该 AI 消息之前最近的 user 消息文本（即产生它的那一轮提问）。
  _userTextBefore(msg) {
    const idx = this.messages.indexOf(msg);
    const start = idx >= 0 ? idx : this.messages.length;
    for (let i = start - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m && m.role === 'user') {
        const c = m.content;
        return typeof c === 'string' ? c : (c && typeof c === 'object' ? (c.text || '') : '');
      }
    }
    return null;
  }

  // 取与 msg 同一轮的用户提问文本：msg 为用户消息时直接取其 content；
  // msg 为 AI 消息时回退用 _userTextBefore 向前查找。
  _userTextFor(msg) {
    if (!msg) return null;
    if (msg.role === 'user') {
      const c = msg.content;
      return typeof c === 'string' ? c : (c && typeof c === 'object' ? (c.text || '') : '');
    }
    return this._userTextBefore(msg);
  }

  // ✎ 重新编辑：预填输入框 + 挂起回滚，发送后才回滚（不发送不回滚）。
  _startEditMode(msg) {
    if (this.sending || msg.seq == null) return;
    const userText = this._userTextFor(msg);
    if (userText == null) return;
    this._pendingRollbackSeq = msg.seq;
    if (this.input) { this.input.value = userText; this.input.focus(); }
    this._showEditBanner(msg.seq);
  }

  // ↺ 重新生成：回滚到该轮之前并用原提问重发（一步到位）。
  _regenerate(msg) {
    if (this.sending || msg.seq == null) return;
    const userText = this._userTextFor(msg);
    if (userText == null) return;
    this._pendingRollbackSeq = msg.seq;
    if (this.input) this.input.value = userText;
    this.sendMessage(); // 内部先 rollback 再发原提问
  }

  _showEditBanner(seq) {
    this._clearEditBanner();
    const banner = document.createElement('div');
    banner.className = 'chat-edit-banner';
    banner.dataset.role = 'edit-banner';
    const label = document.createElement('span');
    label.className = 'chat-edit-banner-label';
    label.textContent = `✎ 正在重新编辑第 #${seq} 轮 · 发送后回滚到该轮之前`;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chat-edit-banner-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => this._cancelEditMode());
    banner.appendChild(label);
    banner.appendChild(cancel);
    const inputArea = this.el?.querySelector('.chat-input-area');
    if (inputArea && inputArea.parentElement) inputArea.parentElement.insertBefore(banner, inputArea);
    else (this.el || document.getElementById('chat-drawer'))?.appendChild(banner);
  }

  _clearEditBanner() {
    const stray = this.el?.querySelector('[data-role="edit-banner"]');
    if (stray) stray.remove();
  }

  _cancelEditMode() {
    this._pendingRollbackSeq = null;
    this._clearEditBanner();
    if (this.input) this.input.value = '';
  }

  /** 流式 token 到达时增量分句，批量朗读（"边生成边读"，减少句间网络间隙）。 */
  _ttsStreamOnToken(token) {
    if (!window.QCLI?.VoiceOutput) return;
    if (this._ttsBuffer == null) this._ttsBuffer = '';
    this._ttsBuffer += token;
    const s = this._ttsBuffer;
    // 找到最后一个句末标点
    let lastB = -1;
    let sentCount = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s[i];
      if (c === '。' || c === '！' || c === '？' || c === '!' || c === '?') {
        if (lastB === -1) lastB = i;
        sentCount++;
      }
    }
    if (lastB === -1) return; // 无句末标点，继续积累
    const after = s.slice(lastB + 1).trim();
    if (after.length === 0) return; // 等下一句开始再 flush，避免过早截断末句
    // 批量策略：≥2 句 或 ≥80 字符才 flush（减少网络间隙）；
    // 超 300 字符时即使单句也强制在边界处 flush（安全兜底，防 OOM 且不切断半句话）
    const complete = s.slice(0, lastB + 1);
    if (sentCount < 2 && complete.length < 80 && complete.length < 300) return;
    this._ttsBuffer = after;
    this._ttsStreamed = true;
    window.QCLI.VoiceOutput.speakSentence(complete);
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

  // ── Public: 黑板嵌入面板开合（iframe 零逻辑重复；收起清空 src 停轮询）──

  // ── 侧边面板（黑板/圆桌/抽屉缩放/导出）：已抽离到 ./chat/side-panels.js（mixin）──

  // ── Public: Rendering ──
  // ── 渲染/DOM：已抽离到 ./chat/message-dom.js（mixin）──

  // ── 指标/节省展示：已抽离到 ./chat/metrics-savings.js（mixin）──
  // ── 指标/节省展示：已抽离到 ./chat/metrics-savings.js（mixin）──

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

    // 深度思考面板：工具调用列表（上）+ 实时状态行（下，始终可见）
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble thinking';

    // 折叠主体：工具调用列表
    const body = document.createElement('div');
    body.className = 'thinking-body';

    // 工具调用列表容器（每次工具调用追加一行，完成后更新状态）。
    // 注意：普通对话轮的工具调用已改为随流内联折叠块（.inline-tool），
    // 此面板列表仅计划/讨论等独立通道使用；故不再预置占位文字，
    // 避免普通对话轮里残留"⏳ 等待工具调用…"空提示。
    const listEl = document.createElement('div');
    listEl.className = 'tool-call-list';
    listEl.id = 'tool-call-list';

    body.appendChild(listEl);

    // 保存列表元素引用，避免多消息并发时 getElementById 命中错误节点
    this._toolCallListEl = listEl;

    bubble.appendChild(body);

    // L1 (v0.7.4): 推理流渲染区（默认折叠、灰色小字、可滚动）。
    // 首个 reasoning chunk 到达时 unhide 并标记"真推理中"（见 onReasoning handler）。
    const reasoningEl = document.createElement('div');
    reasoningEl.className = 'thinking-reasoning collapsed';
    reasoningEl.hidden = true;
    const rHeader = document.createElement('div');
    rHeader.className = 'tr-header';
    rHeader.setAttribute('role', 'button');
    rHeader.setAttribute('tabindex', '0');
    rHeader.textContent = '🧠 推理过程（点击展开）';
    rHeader.addEventListener('click', () => {
      reasoningEl.classList.toggle('collapsed');
      rHeader.textContent = reasoningEl.classList.contains('collapsed')
        ? '🧠 推理过程（点击展开）'
        : '🧠 推理过程（点击折叠）';
    });
    const rBody = document.createElement('div');
    rBody.className = 'tr-body';
    reasoningEl.appendChild(rHeader);
    reasoningEl.appendChild(rBody);
    bubble.appendChild(reasoningEl);
    this._reasoningEl = reasoningEl;
    this._reasoningBodyEl = rBody;
    this._reasoningStarted = false;

    // 底部状态条（可点击折叠工具列表）：动画点 + "深度思考中" + 状态 + 折叠箭头
    // 放在气泡最下方，流式内容增长时始终可见，避免"不知道是否说完"。
    const footer = document.createElement('div');
    footer.className = 'thinking-footer';
    footer.setAttribute('role', 'button');
    footer.setAttribute('tabindex', '0');
    footer.title = '点击折叠/展开';

    const dotsContainer = document.createElement('span');
    dotsContainer.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'thinking-dot';
      dotsContainer.appendChild(dot);
    }
    footer.appendChild(dotsContainer);

    const titleEl = document.createElement('span');
    titleEl.className = 'thinking-title';
    titleEl.textContent = '🤔 深度思考中…';
    footer.appendChild(titleEl);

    // 系统状态行（重试/续传/生成回答/超时 等）
    const statusEl = document.createElement('span');
    statusEl.className = 'thinking-status';
    statusEl.textContent = '';
    footer.appendChild(statusEl);

    // 滚动小贴士：生成过程中循环展示，缓解等待焦虑
    const tipEl = document.createElement('span');
    tipEl.className = 'thinking-tip';
    tipEl.textContent = nextTip();
    footer.appendChild(tipEl);

    const chevron = document.createElement('span');
    chevron.className = 'thinking-chevron';
    chevron.textContent = '▾'; // ▾
    footer.appendChild(chevron);

    bubble.appendChild(footer);

    // 启动小贴士轮播：4 秒切换一条，带淡入淡出
    this._clearThinkingTipInterval();
    this._thinkingTipInterval = window.setInterval(() => {
      if (!tipEl) return;
      tipEl.style.opacity = '0';
      window.setTimeout(() => {
        tipEl.textContent = nextTip();
        tipEl.style.opacity = '0.85';
      }, 300);
    }, 4000);

    // 点击底部状态条折叠/展开工具列表主体
    const toggle = () => {
      const collapsed = bubble.classList.toggle('collapsed');
      chevron.textContent = collapsed ? '▸' : '▾'; // ▸ / ▾
      this.scrollToBottom();
    };
    footer.addEventListener('click', toggle);
    footer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });

    content.appendChild(bubble);
    div.appendChild(content);
    this.msgsEl.appendChild(div);

    // 重置当前轮的工具调用追踪 + 分段流式文本状态
    this._activeToolCalls = [];
    this._streamSegs = [];
    this._frozenLen = 0;

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

  // ── 分段流式文本：支持在工具调用处插入内联折叠块而不被整段 innerHTML 覆盖 ──
  // 获取/创建当前活跃的分段流式文本容器（始终位于 footer 之前）。
  // 首个 token 时创建首段，并把标题从"深度思考中"切到"生成回复中"。
  _ensureStreamSeg(bubble) {
    if (!bubble) {
      const indicator = document.getElementById('thinking-indicator');
      bubble = indicator?.querySelector('.msg-bubble');
    }
    if (!bubble) return null;
    if (this._streamSegs.length === 0) {
      const seg = document.createElement('div');
      seg.className = 'stream-text';
      const footer = bubble.querySelector('.thinking-footer');
      if (footer) bubble.insertBefore(seg, footer);
      else bubble.appendChild(seg);
      this._streamSegs.push(seg);
      const titleEl = bubble.querySelector('.thinking-title');
      if (titleEl) titleEl.textContent = '📝 生成回复中…';
    }
    return this._streamSegs[this._streamSegs.length - 1];
  }

  // 工具调用开始：冻结当前文本段（记录已渲染长度），在其后插入内联折叠工具块，
  // 再开新段接后续文字 → 工具块精确落在触发它的句子下方。
  _appendInlineTool(name, frozenLen) {
    const indicator = document.getElementById('thinking-indicator');
    const bubble = indicator?.querySelector('.msg-bubble');
    if (!bubble) return;
    // 冻结已渲染文本长度，后续 token 只渲染增量到新段，不覆盖已落地的内联块
    this._frozenLen = frozenLen;
    const active = this._ensureStreamSeg(bubble);
    if (!active) return;
    const meta = this._toolMeta(name);

    const block = document.createElement('div');
    block.className = 'inline-tool running';
    block.dataset.toolName = name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'it-header';
    btn.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span'); icon.className = 'it-icon'; icon.textContent = meta.icon;
    const nm = document.createElement('span'); nm.className = 'it-name'; nm.textContent = meta.label;
    const detail = document.createElement('span'); detail.className = 'it-detail'; detail.textContent = name;
    const state = document.createElement('span'); state.className = 'it-state'; state.textContent = '运行中…';
    const chev = document.createElement('span'); chev.className = 'it-chevron'; chev.textContent = '▸';
    btn.append(icon, nm, detail, state, chev);

    const body = document.createElement('div');
    body.className = 'it-body';
    body.hidden = true;

    block.append(btn, body);
    active.after(block);

    // 新文本段接在工具块之后，保证「工具 → 后续文字」顺序正确
    const newSeg = document.createElement('div');
    newSeg.className = 'stream-text';
    block.after(newSeg);
    this._streamSegs.push(newSeg);

    // 默认折叠：点击头展开/收起结果预览
    btn.addEventListener('click', () => {
      const open = block.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', String(open));
      chev.textContent = open ? '▾' : '▸';
      body.hidden = !open;
    });
    this.scrollToBottom();
  }

  // 工具调用结束：更新内联块状态 + 追加结果预览（textContent 防 XSS）
  _updateInlineTool(name, durMs, truncated, result) {
    const indicator = document.getElementById('thinking-indicator');
    const bubble = indicator?.querySelector('.msg-bubble');
    if (!bubble) return;
    const block = bubble.querySelector(`.inline-tool[data-tool-name="${CSS.escape(name)}"]`);
    if (!block) return;
    block.classList.remove('running');
    block.classList.add('done');
    const state = block.querySelector('.it-state');
    if (state) state.textContent = `✓ 完成 · ${durMs}ms${truncated ? '（结果较长已省略）' : ''}`;
    if (result && !block.querySelector('.tool-preview')) {
      const pre = document.createElement('pre');
      pre.className = 'tool-preview';
      pre.textContent = result;
      block.querySelector('.it-body').appendChild(pre);
    }
    this.scrollToBottom();
  }

  /** 清理小贴士轮播定时器 */
  _clearThinkingTipInterval() {
    if (this._thinkingTipInterval) {
      window.clearInterval(this._thinkingTipInterval);
      this._thinkingTipInterval = null;
    }
  }

  removeThinking() {
    this._clearThinkingTipInterval();
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
    // 清理 Agent 实时会话状态（已重构为由 AgentSessionRenderer 托管）
    if (this._agentRenderer && typeof this._agentRenderer.clear === 'function') {
      this._agentRenderer.clear();
    }
  }


}

// ── 原型 mixin 装配（从 chat/ 子模块挂回 ChatPanel.prototype）──
Object.assign(ChatPanel.prototype, mermaidPreviewMixin, discussControlsMixin, planControlsMixin, planStreamMixin, planStepBubbleMixin, attachmentsMixin, historySessionMixin, sidePanelsMixin, metricsSavingsMixin, messageDomMixin, terminalContextMixin);

customElements.define('chat-panel', ChatPanel);

export default ChatPanel;
