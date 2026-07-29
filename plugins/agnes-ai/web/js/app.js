/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/* ============================================
   Agnes AI 全能平台 - 核心应用
   ============================================ */

// ============================================
// 状态管理
// ============================================
const State = {
  apiKey: '',
  baseUrl: '/api/plugins/agnes-ai/proxy/v1',
  apiBaseUrl: 'https://apihub.agnes-ai.com/v1',
  chatModel: 'agnes-v4-flash',
  imageModel: 'agnes-image-2.0-flash',
  videoModel: 'agnes-video-v2.0',
  temperature: 0.7,
  defaultImageSize: '1024x768',
  videoResolution: '720p',
  isGenerating: {
    chat: false,
    image: false,
    video: false
  },
  videoTasks: new Map(), // id -> task info
  chatHistory: [],
  imageHistory: [],
};

// ============================================
// DOM 引用缓存
// ============================================
const DOM = {};

function cacheDom() {
  DOM.settingsOverlay = document.getElementById('settingsOverlay');
  DOM.settingsPanel = document.getElementById('settingsPanel');
  DOM.settingsClose = document.getElementById('settingsClose');
  DOM.openSettings = document.getElementById('openSettings');
  DOM.apiKey = document.getElementById('apiKey');
  DOM.apiBaseUrl = document.getElementById('apiBaseUrl');
  DOM.chatModel = document.getElementById('chatModel');
  DOM.imageModel = document.getElementById('imageModel');
  DOM.videoModel = document.getElementById('videoModel');
  DOM.temperature = document.getElementById('temperature');
  DOM.temperatureValue = document.getElementById('temperatureValue');
  DOM.imageSize = document.getElementById('imageSize');
  DOM.videoResolution = document.getElementById('videoResolution');
  DOM.saveSettings = document.getElementById('saveSettings');
  DOM.clearAllData = document.getElementById('clearAllData');
  DOM.toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  DOM.toastContainer = document.getElementById('toastContainer');
  DOM.connectionStatus = document.getElementById('connectionStatus');

  // Chat
  DOM.chatMessages = document.getElementById('chatMessages');
  DOM.chatInput = document.getElementById('chatInput');
  DOM.sendMessage = document.getElementById('sendMessage');
  DOM.clearChat = document.getElementById('clearChat');

  // Image
  DOM.imagePrompt = document.getElementById('imagePrompt');
  DOM.imageSizeSelect = document.getElementById('imageSizeSelect');
  DOM.imageCount = document.getElementById('imageCount');
  DOM.imageStyle = document.getElementById('imageStyle');
  DOM.generateImage = document.getElementById('generateImage');
  DOM.imageGallery = document.getElementById('imageGallery');
  DOM.imageLoading = document.getElementById('imageLoading');
  DOM.clearImageHistory = document.getElementById('clearImageHistory');

  // Video
  DOM.videoPrompt = document.getElementById('videoPrompt');
  DOM.videoFrames = document.getElementById('videoFrames');
  DOM.videoFps = document.getElementById('videoFps');
  DOM.generateVideo = document.getElementById('generateVideo');
  DOM.videoTasks = document.getElementById('videoTasks');
  DOM.clearVideoHistory = document.getElementById('clearVideoHistory');

  // Image ref dropzone (will be wired in ImageUpload.init)
  DOM.imageRefDropzone = document.getElementById('imageRefDropzone');
  DOM.videoRefDropzone = document.getElementById('videoRefDropzone');

  // Prompt Library
  DOM.promptPanel = document.getElementById('promptPanel');
  DOM.promptOverlay = document.getElementById('promptOverlay');
  DOM.promptClose = document.getElementById('promptClose');
  DOM.openPrompts = document.getElementById('openPrompts');
  DOM.promptSearch = document.getElementById('promptSearch');
  DOM.promptTabs = document.getElementById('promptTabs');
  DOM.templateList = document.getElementById('templateList');
  DOM.saveTemplateName = document.getElementById('saveTemplateName');
  DOM.saveTemplateCategory = document.getElementById('saveTemplateCategory');
  DOM.saveTemplateTags = document.getElementById('saveTemplateTags');
  DOM.saveTemplateBtn = document.getElementById('saveTemplateBtn');

  // Skills Square
  DOM.skillsSearch = document.getElementById('skillsSearch');
  DOM.skillsTabs = document.getElementById('skillsTabs');
  DOM.skillsGrid = document.getElementById('skillsGrid');
  DOM.skillStatTotal = document.getElementById('skillStatTotal');
  DOM.deployPanel = document.getElementById('deployPanel');
  DOM.deployClose = document.getElementById('deployClose');
  DOM.deployCloseBtn = document.getElementById('deployCloseBtn');
  DOM.deployMessage = document.getElementById('deployMessage');
  DOM.deployProgressFill = document.getElementById('deployProgressFill');
  DOM.deployLog = document.getElementById('deployLog');
  DOM.deployPanelFooter = document.getElementById('deployPanelFooter');
  DOM.deployQuickstartBtn = document.getElementById('deployQuickstartBtn');
  DOM.skillsUpdateAllBtn = document.getElementById('skillsUpdateAllBtn');
  DOM.deployHistoryBtn = document.getElementById('deployHistoryBtn');
  DOM.deployHistoryPanel = document.getElementById('deployHistoryPanel');
  DOM.dhCount = document.getElementById('dhCount');
  DOM.dhBody = document.getElementById('dhBody');
  DOM.dhLoading = document.getElementById('dhLoading');
  DOM.dhEmpty = document.getElementById('dhEmpty');
  DOM.dhList = document.getElementById('dhList');
  DOM.dhClearBtn = document.getElementById('dhClearBtn');
  DOM.dhCloseBtn = document.getElementById('dhCloseBtn');
  DOM.dhDetailPanel = document.getElementById('dhDetailPanel');
  DOM.dhBackBtn = document.getElementById('dhBackBtn');
  DOM.dhDetailTitle = document.getElementById('dhDetailTitle');
  DOM.dhDetailBody = document.getElementById('dhDetailBody');
  DOM.dhDetailClose = document.getElementById('dhDetailClose');

  // Storyboard
  DOM.storyConcept = document.getElementById('storyConcept');
  DOM.storySceneCount = document.getElementById('storySceneCount');
  DOM.storyStyle = document.getElementById('storyStyle');
  DOM.storyResolution = document.getElementById('storyResolution');
  DOM.storyFrames = document.getElementById('storyFrames');
  DOM.storyFps = document.getElementById('storyFps');
  DOM.generateStoryboard = document.getElementById('generateStoryboard');
  DOM.storyboardEditor = document.getElementById('storyboardEditor');
  DOM.editorSummary = document.getElementById('editorSummary');
  DOM.sceneList = document.getElementById('sceneList');
  DOM.addSceneBtn = document.getElementById('addSceneBtn');
  DOM.generateAllVideos = document.getElementById('generateAllVideos');
  DOM.sceneProgress = document.getElementById('sceneProgress');
  DOM.progressCounter = document.getElementById('progressCounter');
  DOM.progressGlobalFill = document.getElementById('progressGlobalFill');
  DOM.sceneProgressList = document.getElementById('sceneProgressList');
  DOM.storyboardResult = document.getElementById('storyboardResult');
  DOM.resultScenes = document.getElementById('resultScenes');
  DOM.downloadAllVideos = document.getElementById('downloadAllVideos');
  DOM.clearStoryboard = document.getElementById('clearStoryboard');

  // Prompt Optimizer
  DOM.optimizeImagePrompt = document.getElementById('optimizeImagePrompt');
  DOM.optimizeVideoPrompt = document.getElementById('optimizeVideoPrompt');
  DOM.imageOptimizerResult = document.getElementById('imageOptimizerResult');
  DOM.videoOptimizerResult = document.getElementById('videoOptimizerResult');
  DOM.imageOptimizerBody = document.getElementById('imageOptimizerBody');
  DOM.videoOptimizerBody = document.getElementById('videoOptimizerBody');
  DOM.imageOptimizerApplyCN = document.getElementById('imageOptimizerApplyCN');
  DOM.imageOptimizerApplyEN = document.getElementById('imageOptimizerApplyEN');
  DOM.videoOptimizerApplyCN = document.getElementById('videoOptimizerApplyCN');
  DOM.videoOptimizerApplyEN = document.getElementById('videoOptimizerApplyEN');
  DOM.imageOptimizerDiscard = document.getElementById('imageOptimizerDiscard');
  DOM.videoOptimizerDiscard = document.getElementById('videoOptimizerDiscard');
  DOM.imageOptimizerClose = document.getElementById('imageOptimizerClose');
  DOM.videoOptimizerClose = document.getElementById('videoOptimizerClose');

  // Storyboard Assistant
  DOM.storyboardTutorBtn = document.getElementById('storyboardTutorBtn');
  DOM.storyboardAssistant = document.getElementById('storyboardAssistant');
  DOM.saClose = document.getElementById('saClose');
  DOM.saMessages = document.getElementById('saMessages');
  DOM.saSuggestScenes = document.getElementById('saSuggestScenes');
  DOM.saImprovePrompts = document.getElementById('saImprovePrompts');
  DOM.saReview = document.getElementById('saReview');
  DOM.saTiming = document.getElementById('saTiming');
  DOM.saSteps = document.getElementById('saSteps');
}

// ============================================
// Toast 通知系统
// ============================================
function showToast(message, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// 设置管理
// ============================================
async function loadSettings() {
  // API Key 与后端 API 地址存于 Hesi 后端（插件配置接口），浏览器不持久化明文 Key。
  try {
    const resp = await fetch('/api/plugins/agnes-ai/config');
    if (resp.ok) {
      const cfg = await resp.json();
      if (cfg.apiKey) State.apiKey = cfg.apiKey;
      if (cfg.apiBaseUrl) State.apiBaseUrl = cfg.apiBaseUrl;
    }
  } catch (e) {
    console.warn('[Agnes] 读取插件配置失败:', e);
  }
  applySettingsToUI();
}

async function saveSettingsToStorage() {
  // 仅把 Key + 后端 API 地址同步到 Hesi 后端；其它模型/温度等偏好仍留前端。
  try {
    await fetch('/api/plugins/agnes-ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: State.apiKey, apiBaseUrl: State.apiBaseUrl }),
    });
  } catch (e) {
    console.warn('[Agnes] 保存插件配置失败:', e);
  }
}

function applySettingsToUI() {
  DOM.apiKey.value = State.apiKey || '';
  DOM.apiBaseUrl.value = State.apiBaseUrl || 'https://apihub.agnes-ai.com/v1';
  DOM.chatModel.value = State.chatModel;
  DOM.imageModel.value = State.imageModel;
  DOM.videoModel.value = State.videoModel;
  DOM.temperature.value = State.temperature;
  DOM.temperatureValue.textContent = State.temperature;
  DOM.imageSize.value = State.defaultImageSize;
  DOM.videoResolution.value = State.videoResolution;
  updateConnectionStatus();
}

function updateConnectionStatus() {
  const status = DOM.connectionStatus;
  const dot = status.querySelector('.status-dot');
  const text = status.querySelector('.status-text');

  if (State.apiKey) {
    dot.className = 'status-dot checking';
    text.textContent = '验证中...';
    checkApiConnection();
  } else {
    dot.className = 'status-dot';
    text.textContent = '未配置';
  }
}

async function checkApiConnection() {
  const dot = DOM.connectionStatus.querySelector('.status-dot');
  const text = DOM.connectionStatus.querySelector('.status-text');

  try {
    const resp = await fetch(`${State.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${State.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (resp.ok) {
      dot.className = 'status-dot connected';
      text.textContent = '已连接';
    } else {
      dot.className = 'status-dot';
      text.textContent = '连接失败';
    }
  } catch (e) {
    dot.className = 'status-dot';
    text.textContent = '离线模式';
  }
}

// ============================================
// 导航
// ============================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const viewName = item.dataset.view;
      switchView(viewName);
    });
  });
}

function switchView(viewName) {
  // Update nav
  document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${viewName}"]`).classList.add('active');

  // Update views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${viewName}-view`).classList.add('active');
}

// ============================================
// API 层
// ============================================
const API = {
  // --- Chat ---
  async sendChatMessage(messages) {
    const resp = await fetch(`${State.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${State.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: State.chatModel,
        messages,
        temperature: State.temperature,
        stream: false
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`API 错误 (${resp.status}): ${err}`);
    }

    return resp.json();
  },

  // --- Image ---
  async generateImage(prompt, options = {}) {
    const size = options.size || State.defaultImageSize;
    const n = options.n || 1;
    const style = options.style || '';
    const refImage = options.refImage || '';

    const fullPrompt = style ? `${prompt}, ${style} style` : prompt;

    const body = {
      model: State.imageModel,
      prompt: fullPrompt,
      n,
      size,
      extra_body: {
        response_format: 'b64_json'
      }
    };

    // Add reference image for image-to-image
    if (refImage) {
      body.extra_body.image = [refImage];
    }

    const resp = await fetch(`${State.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${State.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`API 错误 (${resp.status}): ${err}`);
    }

    return resp.json();
  },

  // --- Video ---
  async createVideoTask(prompt, options = {}) {
    const refImage = options.refImage || '';
    const frames = options.frames || 49;
    const fps = options.fps || 16;

    const body = {
      model: State.videoModel,
      prompt,
      num_frames: frames,
      frame_rate: fps,
    };

    if (refImage) {
      body.image_url = refImage;
    }

    const resp = await fetch(`${State.baseUrl}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${State.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`API 错误 (${resp.status}): ${err}`);
    }

    return resp.json();
  },

  async queryVideoTask(videoId) {
    const resp = await fetch(`${State.baseUrl.replace('/v1', '')}/agnesapi?video_id=${videoId}`, {
      headers: {
        'Authorization': `Bearer ${State.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`查询错误 (${resp.status}): ${err}`);
    }

    return resp.json();
  }
};

// ============================================
// 聊天模块
// ============================================
const ChatModule = {
  init() {
    DOM.sendMessage.addEventListener('click', () => this.sendMessage());
    DOM.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    DOM.clearChat.addEventListener('click', () => this.clearChat());

    // Auto-resize textarea
    DOM.chatInput.addEventListener('input', () => {
      DOM.chatInput.style.height = 'auto';
      DOM.chatInput.style.height = `${Math.min(DOM.chatInput.scrollHeight, 120)  }px`;
    });

    this.loadHistory();
  },

  loadHistory() {
    const saved = localStorage.getItem('agnes_chat_history');
    if (saved) {
      try {
        State.chatHistory = JSON.parse(saved);
        this.renderMessages();
      } catch (e) {
        console.warn('Failed to load chat history');
      }
    }
  },

  saveHistory() {
    localStorage.setItem('agnes_chat_history', JSON.stringify(State.chatHistory));
  },

  addMessage(role, content) {
    State.chatHistory.push({ role, content });
    this.saveHistory();
  },

  renderMessages() {
    // Clear all but welcome
    const welcome = DOM.chatMessages.querySelector('.welcome-message');
    DOM.chatMessages.innerHTML = '';

    if (State.chatHistory.length === 0 && welcome) {
      DOM.chatMessages.appendChild(welcome);
      return;
    }

    // Remove welcome if there are messages
    State.chatHistory.forEach(msg => {
      this.renderMessage(msg.role, msg.content);
    });
  },

  renderMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '✦';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const sender = document.createElement('div');
    sender.className = 'message-sender';
    sender.textContent = role === 'user' ? '你' : 'Agnes AI';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = this.formatMarkdown(content);

    contentDiv.appendChild(sender);
    contentDiv.appendChild(textDiv);
    div.appendChild(avatar);
    div.appendChild(contentDiv);

    this.appendMessageElement(div);
  },

  formatMarkdown(text) {
    // Escape HTML
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (must be before inline code)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langLabel = lang ? `<span>${lang}</span>` : '<span>code</span>';
      const escapedCode = this.escapeHtml(code.trim());
      return `<div class="code-header">${langLabel}<button class="copy-btn" data-code="${btoa(code.trim())}">📋 复制</button></div><pre><code>${escapedCode}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;">');

    // Headings (must be before <p> wrapping)
    html = html.replace(/^### (.+)$/gm, '</p><h3>$1</h3><p>');
    html = html.replace(/^## (.+)$/gm, '</p><h2>$1</h2><p>');
    html = html.replace(/^# (.+)$/gm, '</p><h1>$1</h1><p>');

    // Horizontal rule
    html = html.replace(/^---$/gm, '</p><hr><p>');

    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '</p><blockquote>$1</blockquote><p>');

    // Unordered list items
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

    // Ordered list items
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ul> or <ol>
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
      return `</p><ul>${  match  }</ul><p>`;
    });

    // Paragraph breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');

    return `<p>${html}</p>`;
  },

  initCopyButtons() {
    // 使用事件委托，只绑定一次监听器
    if (!this._copyDelegated) {
      this._copyDelegated = true;
      DOM.chatMessages.addEventListener('click', (e) => {
        const btn = e.target.closest('.copy-btn');
        if (!btn) return;
        const code = atob(btn.dataset.code);
        navigator.clipboard.writeText(code).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✅ 已复制';
          setTimeout(() => btn.textContent = orig, 1500);
        }).catch(() => {
          // 降级方案
          const textarea = document.createElement('textarea');
          textarea.value = code;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          btn.textContent = '✅ 已复制';
          setTimeout(() => btn.textContent = '📋 复制', 1500);
        });
      });
    }
  },

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  scrollToBottom() {
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  },

  appendMessageElement(div) {
    DOM.chatMessages.appendChild(div);
    // Init copy buttons for code blocks
    this.initCopyButtons();
    this.scrollToBottom();
  },

  async sendMessage() {
    const text = DOM.chatInput.value.trim();
    if (!text || State.isGenerating.chat) return;

    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }

    // Show user message
    this.addMessage('user', text);
    this.renderMessage('user', text);
    DOM.chatInput.value = '';
    DOM.chatInput.style.height = 'auto';

    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.innerHTML = `
      <div class="message-avatar">✦</div>
      <div class="message-content">
        <div class="message-sender">Agnes AI</div>
        <div class="message-text">
          <div class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
    DOM.chatMessages.appendChild(typingDiv);
    this.scrollToBottom();
    this.initCopyButtons();

    State.isGenerating.chat = true;
    DOM.sendMessage.disabled = true;

    try {
      const messages = State.chatHistory.map(m => ({
        role: m.role,
        content: m.content
      }));

      const data = await API.sendChatMessage(messages);
      const reply = data.choices[0].message.content;

      // Remove typing indicator
      typingDiv.remove();

      this.addMessage('assistant', reply);
      this.renderMessage('assistant', reply);
    } catch (err) {
      typingDiv.remove();
      showToast(`对话失败: ${err.message}`, 'error');

      // Show error message
      this.renderMessage('assistant', `😔 抱歉，出错了: ${err.message}`);
    } finally {
      State.isGenerating.chat = false;
      DOM.sendMessage.disabled = false;
      DOM.chatInput.focus();
    }
  },

  clearChat() {
    State.chatHistory = [];
    this.saveHistory();
    this.renderMessages();
    showToast('对话已清空', 'info');
  }
};

// ============================================
// 图片上传工具 (拖拽 + 点击)
// ============================================
const ImageUpload = {
  instances: new Map(),

  /**
   * 初始化一个 dropzone
   * @param {string|HTMLElement} el - 元素 ID 或 DOM 元素
   * @param {object} opts
   * @param {function} opts.onChange - (dataUrl, file) => {} 当图片变化时
   * @returns {{ getImage: () => string|null, clear: () => void, setImage: (url) => void, element: HTMLElement }}
   */
  init(el, opts = {}) {
    const dropzone = typeof el === 'string' ? document.getElementById(el) : el;
    if (!dropzone) return null;

    const state = { dataUrl: null, fileName: '', fileSize: 0 };

    // Elements
    const preview = dropzone.querySelector('.dz-preview');
    const previewImg = preview?.querySelector('img');
    const nameEl = preview?.querySelector('.dz-name');
    const sizeEl = preview?.querySelector('.dz-size');
    const removeBtn = preview?.querySelector('.dz-remove');

    // Create hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
    fileInput.className = 'dz-hidden-input';
    dropzone.appendChild(fileInput);

    const updateUI = () => {
      if (state.dataUrl) {
        dropzone.classList.add('has-image');
        if (previewImg) previewImg.src = state.dataUrl;
        if (nameEl) nameEl.textContent = state.fileName || '参考图片';
        if (sizeEl) sizeEl.textContent = state.fileSize ? ImageUpload.formatSize(state.fileSize) : '';
      } else {
        dropzone.classList.remove('has-image');
        if (previewImg) previewImg.src = '';
      }
    };

    const loadFile = (file) => {
      if (!file || !file.type.startsWith('image/')) {
        showToast('请选择图片文件 (JPG/PNG/WebP)', 'error');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast('图片大小不能超过 10MB', 'error');
        return;
      }
      state.fileName = file.name;
      state.fileSize = file.size;

      const reader = new FileReader();
      reader.onload = (e) => {
        state.dataUrl = e.target.result;
        updateUI();
        if (opts.onChange) opts.onChange(state.dataUrl, file);
      };
      reader.readAsDataURL(file);
    };

    // Drag & Drop events
    let dragCounter = 0;

    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (dragCounter === 1) {
        dropzone.classList.add('dragover');
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter === 0) {
        dropzone.classList.remove('dragover');
      }
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropzone.classList.remove('dragover');

      const files = e.dataTransfer?.files;
      if (files?.length > 0) {
        loadFile(files[0]);
      }
    });

    // Click to open file picker (only when no image)
    dropzone.addEventListener('click', (e) => {
      // Don't trigger if clicking remove button
      if (e.target.closest('.dz-remove')) return;
      // Don't trigger if has image (prevent accidental re-pick)
      if (state.dataUrl) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length > 0) {
        loadFile(fileInput.files[0]);
      }
      fileInput.value = ''; // Allow re-selecting same file
    });

    // Remove button
    removeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      state.dataUrl = null;
      state.fileName = '';
      state.fileSize = 0;
      updateUI();
      if (opts.onChange) opts.onChange(null, null);
    });

    const instance = {
      getImage: () => state.dataUrl,
      clear: () => {
        state.dataUrl = null;
        state.fileName = '';
        state.fileSize = 0;
        updateUI();
      },
      setImage: (url) => {
        state.dataUrl = url;
        state.fileName = '参考图片';
        state.fileSize = 0;
        updateUI();
      },
      element: dropzone
    };

    this.instances.set(dropzone.id || dropzone, instance);
    return instance;
  },

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes  } B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)  } KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)  } MB`;
  }
};

// ============================================
// 制图模块
// ============================================
const ImageModule = {
  refUpload: null,

  init() {
    DOM.generateImage.addEventListener('click', () => this.generate());
    DOM.clearImageHistory.addEventListener('click', () => this.clearHistory());
    DOM.imageSizeSelect.value = State.defaultImageSize;
    this.loadHistory();

    // Init dropzone
    this.refUpload = ImageUpload.init('imageRefDropzone', {
      onChange: () => {} // stored in refUpload
    });
  },

  loadHistory() {
    const saved = localStorage.getItem('agnes_image_history');
    if (saved) {
      try {
        State.imageHistory = JSON.parse(saved);
        this.renderGallery();
      } catch (e) {
        console.warn('Failed to load image history');
      }
    }
  },

  saveHistory() {
    localStorage.setItem('agnes_image_history', JSON.stringify(State.imageHistory));
  },

  async generate() {
    const prompt = DOM.imagePrompt.value.trim();
    if (!prompt || State.isGenerating.image) return;

    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }

    const size = DOM.imageSizeSelect.value;
    const n = parseInt(DOM.imageCount.value);
    const style = DOM.imageStyle.value;

    State.isGenerating.image = true;
    DOM.generateImage.disabled = true;
    DOM.imageLoading.style.display = 'flex';

    try {
      // Get reference image if any (for image-to-image)
      const refImage = this.refUpload?.getImage() || '';

      const data = await API.generateImage(prompt, { size, n, style, refImage });
      const images = [];

      if (data.data && data.data.length > 0) {
        data.data.forEach((item, index) => {
          let imgUrl = item.url;
          if (item.b64_json) {
            imgUrl = `data:image/png;base64,${item.b64_json}`;
          }
          const imageEntry = {
            url: imgUrl,
            prompt: style ? `${prompt} (${style})` : prompt,
            size,
            timestamp: Date.now(),
            id: `${Date.now()  }-${  index}`
          };
          images.push(imageEntry);
        });
      }

      State.imageHistory.unshift(...images);
      this.saveHistory();
      this.renderGallery();
      showToast(`成功生成 ${images.length} 张图片`, 'success');
    } catch (err) {
      showToast(`生成失败: ${err.message}`, 'error');
    } finally {
      State.isGenerating.image = false;
      DOM.generateImage.disabled = false;
      DOM.imageLoading.style.display = 'none';

      // Try URL format if b64_json failed
      if (!State.isGenerating.image) {
        // This is already handled
      }
    }
  },

  renderGallery() {
    DOM.imageGallery.innerHTML = '';

    if (State.imageHistory.length === 0) {
      DOM.imageGallery.innerHTML = `
        <div class="gallery-empty">
          <div class="empty-icon">🎨</div>
          <h3>还没有生成任何图片</h3>
          <p>输入描述并点击生成按钮开始创作</p>
        </div>
      `;
      return;
    }

    State.imageHistory.forEach(img => {
      const card = document.createElement('div');
      card.className = 'image-card';

      const imgEl = document.createElement('img');
      imgEl.src = img.url;
      imgEl.alt = img.prompt;
      imgEl.loading = 'lazy';
      imgEl.addEventListener('click', () => this.previewImage(img.url));

      const info = document.createElement('div');
      info.className = 'image-card-info';

      const promptSpan = document.createElement('span');
      promptSpan.className = 'image-card-prompt';
      promptSpan.title = img.prompt;
      promptSpan.textContent = img.prompt;

      const actions = document.createElement('div');
      actions.className = 'image-card-actions';

      const downloadBtn = document.createElement('button');
      downloadBtn.title = '下载';
      downloadBtn.innerHTML = '⬇️';
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadImage(img.url, img.prompt);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.title = '删除';
      deleteBtn.innerHTML = '🗑️';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteImage(img.id);
      });

      actions.appendChild(downloadBtn);
      actions.appendChild(deleteBtn);
      info.appendChild(promptSpan);
      info.appendChild(actions);
      card.appendChild(imgEl);
      card.appendChild(info);
      DOM.imageGallery.appendChild(card);
    });
  },

  async downloadImage(url, filename) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `agnes-${filename.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('图片已下载', 'success');
    } catch (err) {
      showToast('下载失败，尝试右键保存', 'error');
      window.open(url, '_blank');
    }
  },

  previewImage(url) {
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    const img = document.createElement('img');
    img.src = url;
    modal.appendChild(img);

    const close = () => modal.remove();
    const escHandler = (e) => {
      if (e.key === 'Escape') close();
    };

    modal.addEventListener('click', close);
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);

    // Clean up listener when modal is removed
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal)) {
        document.removeEventListener('keydown', escHandler);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  },

  deleteImage(id) {
    State.imageHistory = State.imageHistory.filter(img => img.id !== id);
    this.saveHistory();
    this.renderGallery();
  },

  clearHistory() {
    State.imageHistory = [];
    this.saveHistory();
    this.renderGallery();
    showToast('图片历史已清空', 'info');
  }
};

// ============================================
// 视频生成模块
// ============================================
const VideoModule = {
  pollingIntervals: new Map(),
  refUpload: null,

  init() {
    DOM.generateVideo.addEventListener('click', () => this.startGeneration());
    DOM.clearVideoHistory.addEventListener('click', () => this.clearHistory());
    this.loadHistory();

    // Init dropzone
    this.refUpload = ImageUpload.init('videoRefDropzone', {
      onChange: () => {}
    });
  },

  loadHistory() {
    const saved = localStorage.getItem('agnes_video_history');
    if (saved) {
      try {
        const tasks = JSON.parse(saved);
        tasks.forEach(task => {
          State.videoTasks.set(task.id, task);
        });
        this.renderTasks();
      } catch (e) {
        console.warn('Failed to load video history');
      }
    }
  },

  saveHistory() {
    const tasks = Array.from(State.videoTasks.values());
    localStorage.setItem('agnes_video_history', JSON.stringify(tasks));
  },

  async startGeneration() {
    const prompt = DOM.videoPrompt.value.trim();
    if (!prompt || State.isGenerating.video) return;

    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }

    const frames = parseInt(DOM.videoFrames.value);
    const fps = parseInt(DOM.videoFps.value);
    const refImage = this.refUpload?.getImage() || '';

    // Validate frames: 8n + 1 rule
    const validFrames = [9, 17, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97];
    const closestFrames = validFrames.reduce((prev, curr) =>
      Math.abs(curr - frames) < Math.abs(prev - frames) ? curr : prev
    );

    State.isGenerating.video = true;
    DOM.generateVideo.disabled = true;
    DOM.generateVideo.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-width:2px;"></span> 提交中...';

    try {
      const data = await API.createVideoTask(prompt, {
        refImage,
        frames: closestFrames,
        fps
      });

      const taskId = data.video_id || data.id || Date.now().toString();
      const task = {
        id: taskId,
        prompt,
        frames: closestFrames,
        fps,
        refImage,
        status: 'pending',
        resultUrl: null,
        createdAt: Date.now(),
        progress: 0,
      };

      State.videoTasks.set(taskId, task);
      this.saveHistory();
      this.renderTasks();
      showToast('视频任务已提交，正在处理...', 'info');

      // Start polling
      this.startPolling(taskId);
    } catch (err) {
      showToast(`提交失败: ${err.message}`, 'error');
    } finally {
      State.isGenerating.video = false;
      DOM.generateVideo.disabled = false;
      DOM.generateVideo.innerHTML = '<span class="btn-icon">✨</span> 生成视频';
    }
  },

  startPolling(taskId) {
    if (this.pollingIntervals.has(taskId)) return;

    const poll = async () => {
      const task = State.videoTasks.get(taskId);
      if (!task || task.status === 'completed' || task.status === 'failed') {
        this.stopPolling(taskId);
        return;
      }

      // If card no longer in DOM, skip update
      const cardInDom = document.getElementById(`task-${taskId(task.id)}`);
      if (!cardInDom) {
        this.stopPolling(taskId);
        return;
      }

      try {
        task.status = 'processing';
        this.updateTaskCard(taskId);

        const data = await API.queryVideoTask(taskId);

        if (data.status === 'completed' || data.status === 'success' || data.video_url) {
          task.status = 'completed';
          task.progress = 100;
          task.resultUrl = data.video_url || data.url || data.output?.video_url || '';
          this.saveHistory();
          this.updateTaskCard(taskId);
          this.stopPolling(taskId);
          showToast('🎬 视频生成完成！', 'success');
        } else if (data.status === 'failed' || data.error) {
          task.status = 'failed';
          this.saveHistory();
          this.updateTaskCard(taskId);
          this.stopPolling(taskId);
          showToast(`视频生成失败: ${data.error || '未知错误'}`, 'error');
        } else {
          // Still processing, update progress based on elapsed time
          const elapsed = (Date.now() - task.createdAt) / 1000;
          task.progress = Math.min(Math.floor(elapsed / 3), 90);
          this.updateTaskCard(taskId);
        }
      } catch (err) {
        // Don't stop polling on network errors, just retry
        console.warn('Polling error:', err.message);
        task.retryCount = (task.retryCount || 0) + 1;
        if (task.retryCount > 60) { // ~10 minutes of retries
          task.status = 'failed';
          this.updateTaskCard(taskId);
          this.stopPolling(taskId);
          showToast('⏰ 视频生成超时，请稍后重试', 'error');
        }
      }
    };

    // Poll every 10 seconds
    this.pollingIntervals.set(taskId, setInterval(poll, 10000));
    // Also run immediately
    setTimeout(poll, 2000);
  },

  stopPolling(taskId) {
    if (this.pollingIntervals.has(taskId)) {
      clearInterval(this.pollingIntervals.get(taskId));
      this.pollingIntervals.delete(taskId);
    }
  },

  updateTaskCard(taskId) {
    const task = State.videoTasks.get(taskId);
    if (!task) return;

    const card = document.getElementById(`task-${taskId}`);
    if (card) {
      const newCard = this.createTaskCard(task);
      card.replaceWith(newCard);
    }
  },

  createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'video-task-card';
    card.id = `task-${taskId(task.id)}`;

    // Header with status
    const header = document.createElement('div');
    header.className = 'task-header';

    const statusLabel = {
      'pending': '排队中',
      'processing': '生成中',
      'completed': '已完成',
      'failed': '失败'
    };

    const statusEl = document.createElement('div');
    statusEl.className = `task-status ${task.status}`;
    statusEl.innerHTML = `
      <span class="task-status-dot"></span>
      ${statusLabel[task.status] || task.status}
    `;

    const taskIdEl = document.createElement('span');
    taskIdEl.className = 'task-id';
    taskIdEl.textContent = `ID: ${task.id.slice(0, 12)}...`;

    header.appendChild(statusEl);
    header.appendChild(taskIdEl);

    // Prompt
    const promptEl = document.createElement('div');
    promptEl.className = 'task-prompt';
    promptEl.textContent = task.prompt;

    // Progress bar (for pending/processing)
    let progressEl = null;
    if (task.status === 'pending' || task.status === 'processing') {
      progressEl = document.createElement('div');
      progressEl.className = 'task-progress-bar';
      const fill = document.createElement('div');
      fill.className = 'task-progress-fill';
      fill.style.width = `${task.progress || 0}%`;
      progressEl.appendChild(fill);
    }

    // Result (for completed)
    let resultEl = null;
    if (task.status === 'completed' && task.resultUrl) {
      resultEl = document.createElement('div');
      resultEl.className = 'task-result';

      if (task.resultUrl.match(/\.(mp4|webm|mov|avi)$/i) || task.resultUrl.includes('video')) {
        const video = document.createElement('video');
        video.src = task.resultUrl;
        video.controls = true;
        video.autoplay = false;
        video.preload = 'metadata';
        resultEl.appendChild(video);
      } else {
        // Show as image if not video URL
        const img = document.createElement('img');
        img.src = task.resultUrl;
        img.alt = task.prompt;
        img.style.width = '100%';
        img.style.maxHeight = '400px';
        img.style.borderRadius = '8px';
        img.style.objectFit = 'contain';
        resultEl.appendChild(img);
      }

      // Download button
      const actions = document.createElement('div');
      actions.className = 'task-actions';
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'btn btn-secondary';
      downloadBtn.innerHTML = '⬇️ 下载视频';
      downloadBtn.addEventListener('click', () => {
        window.open(task.resultUrl, '_blank');
      });
      actions.appendChild(downloadBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-ghost';
      deleteBtn.textContent = '🗑️ 删除';
      deleteBtn.addEventListener('click', () => {
        this.deleteTask(task.id);
      });
      actions.appendChild(deleteBtn);

      resultEl.appendChild(actions);
    }

    // Failed state
    if (task.status === 'failed') {
      const actions = document.createElement('div');
      actions.className = 'task-actions';
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-secondary';
      retryBtn.innerHTML = '🔄 重试';
      retryBtn.addEventListener('click', () => {
        this.deleteTask(task.id);
        DOM.videoPrompt.value = task.prompt;
        showToast('请调整后重新生成', 'info');
      });
      actions.appendChild(retryBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-ghost';
      deleteBtn.textContent = '🗑️ 删除';
      deleteBtn.addEventListener('click', () => {
        this.deleteTask(task.id);
      });
      actions.appendChild(deleteBtn);

      resultEl = document.createElement('div');
      resultEl.appendChild(actions);
    }

    card.appendChild(header);
    card.appendChild(promptEl);
    if (progressEl) card.appendChild(progressEl);
    if (resultEl) card.appendChild(resultEl);

    return card;
  },

  renderTasks() {
    DOM.videoTasks.innerHTML = '';

    if (State.videoTasks.size === 0) {
      DOM.videoTasks.innerHTML = `
        <div class="tasks-empty">
          <div class="empty-icon">🎬</div>
          <h3>还没有生成任何视频</h3>
          <p>输入描述并点击生成按钮开始创作</p>
        </div>
      `;
      return;
    }

    const tasks = Array.from(State.videoTasks.values()).reverse();
    tasks.forEach(task => {
      const card = this.createTaskCard(task);
      DOM.videoTasks.appendChild(card);
    });

    // Resume polling for pending/processing tasks
    tasks.forEach(task => {
      if (task.status === 'pending' || task.status === 'processing') {
        this.startPolling(task.id);
      }
    });
  },

  deleteTask(id) {
    this.stopPolling(id);
    State.videoTasks.delete(id);
    this.saveHistory();
    this.renderTasks();
  },

  clearHistory() {
    // Stop all polling
    this.pollingIntervals.forEach((interval) => clearInterval(interval));
    this.pollingIntervals.clear();
    State.videoTasks.clear();
    this.saveHistory();
    this.renderTasks();
    showToast('视频历史已清空', 'info');
  }
};

// Helper to handle task IDs with dots
function taskId(id) {
  return id.replace(/\./g, '-');
}

// ============================================
// 设置面板
// ============================================
function initSettings() {
  DOM.openSettings.addEventListener('click', () => {
    DOM.settingsPanel.classList.add('open');
    DOM.settingsOverlay.classList.add('open');
  });

  DOM.settingsClose.addEventListener('click', closeSettings);
  DOM.settingsOverlay.addEventListener('click', closeSettings);

  DOM.temperature.addEventListener('input', () => {
    DOM.temperatureValue.textContent = DOM.temperature.value;
  });

  DOM.saveSettings.addEventListener('click', () => {
    State.apiKey = DOM.apiKey.value.trim();
    State.apiBaseUrl = DOM.apiBaseUrl.value.trim();
    // 注意：State.baseUrl 固定为 Hesi 本地代理地址，不在此处修改
    State.chatModel = DOM.chatModel.value.trim();
    State.imageModel = DOM.imageModel.value.trim();
    State.videoModel = DOM.videoModel.value.trim();
    State.temperature = parseFloat(DOM.temperature.value);
    State.defaultImageSize = DOM.imageSize.value;
    State.videoResolution = DOM.videoResolution.value;

    saveSettingsToStorage();
    updateConnectionStatus();
    closeSettings();
    showToast('设置已保存', 'success');
  });

  DOM.clearAllData.addEventListener('click', () => {
    if (confirm('确定要清除所有数据吗？这将删除所有对话、图片和视频历史记录。')) {
      localStorage.clear();
      State.chatHistory = [];
      State.imageHistory = [];
      State.videoTasks.clear();
      State.apiKey = '';
      applySettingsToUI();
      ChatModule.renderMessages();
      ImageModule.renderGallery();
      VideoModule.renderTasks();
      showToast('所有数据已清除', 'info');
    }
  });

  DOM.toggleKeyVisibility.addEventListener('click', () => {
    const input = DOM.apiKey;
    if (input.type === 'password') {
      input.type = 'text';
      DOM.toggleKeyVisibility.textContent = '🙈';
    } else {
      input.type = 'password';
      DOM.toggleKeyVisibility.textContent = '👁️';
    }
  });
}

function closeSettings() {
  DOM.settingsPanel.classList.remove('open');
  DOM.settingsOverlay.classList.remove('open');
}

// ============================================
// 键盘快捷键
// ============================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape to close settings
    if (e.key === 'Escape' && DOM.settingsPanel.classList.contains('open')) {
      closeSettings();
    }

    // Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+4 to switch views
    if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const viewMap = {
        '1': 'chat',
        '2': 'image',
        '3': 'video',
        '4': 'storyboard'
      };

      // Ctrl+6 to open prompt library
      if (e.key === '6') {
        e.preventDefault();
        PromptLibrary.open();
        return;
      }
      if (viewMap[e.key]) {
        e.preventDefault();
        switchView(viewMap[e.key]);
      }
    }
  });
}

// ============================================
// 故事板模块 - 多场景视频生成
// ============================================
const StoryboardModule = {
  scenes: [],
  sceneResults: [],
  isGenerating: false,
  abortController: null,

  init() {
    DOM.generateStoryboard.addEventListener('click', () => this.generateStoryboard());
    DOM.addSceneBtn.addEventListener('click', () => this.addEmptyScene());
    DOM.generateAllVideos.addEventListener('click', () => this.generateAllVideos());
    DOM.downloadAllVideos.addEventListener('click', () => this.downloadAll());
    DOM.clearStoryboard.addEventListener('click', () => this.clearAll());
    this.loadHistory();
  },

  loadHistory() {
    const saved = localStorage.getItem('agnes_storyboard_history');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.scenes = data.scenes || [];
        this.sceneResults = data.results || [];
        if (this.scenes.length > 0) {
          this.showEditor();
          this.renderScenes();
          if (this.sceneResults.length > 0) {
            this.showResults();
          }
        }
      } catch (e) {
        console.warn('Failed to load storyboard history');
      }
    }
  },

  saveHistory() {
    localStorage.setItem('agnes_storyboard_history', JSON.stringify({
      scenes: this.scenes,
      results: this.sceneResults
    }));
  },

  async generateStoryboard() {
    const concept = DOM.storyConcept.value.trim();
    if (!concept) {
      showToast('请先输入创意概念', 'error');
      return;
    }
    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }

    const sceneCount = parseInt(DOM.storySceneCount.value);
    const style = DOM.storyStyle.value;
    const resolution = DOM.storyResolution.value;

    DOM.generateStoryboard.disabled = true;
    DOM.generateStoryboard.innerHTML = '<span class="spinner" style="width:20px;height:20px;border-width:2px;"></span> AI 正在构思故事板...';

    try {
      const systemPrompt = `你是一个专业的影视故事板编剧。请根据用户的创意概念，生成一个包含 ${sceneCount} 个场景的故事板。

返回格式要求（严格JSON数组，不要任何其他文字）：
[
  {
    "scene": 1,
    "title": "场景标题",
    "description": "场景的文学性描述，包含时间、地点、氛围、角色动作",
    "visualPrompt": "用于AI视频生成的详细英文视觉提示词，包含风格(${style})、镜头语言、色彩、光影",
    "dialogue": "场景旁白/台词（中文）",
    "duration": 3
  }
]

每个场景的 visualPrompt 必须包含视觉风格、镜头运动、色彩基调和氛围。duration 的单位是秒。`;

      const resp = await API.sendChatMessage([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `创意概念: ${concept}\n风格: ${style}\n画面比例: ${resolution}\n场景数: ${sceneCount}` }
      ]);

      let content = resp.choices[0].message.content;
      // Extract JSON array from response
      const jsonMatch = content.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('AI 返回的格式不正确');
      }

      this.scenes = parsed.map((s, i) => ({
        id: `${Date.now()  }-${  i}`,
        scene: i + 1,
        title: s.title || `场景 ${i + 1}`,
        description: s.description || s.visualPrompt || '',
        visualPrompt: s.visualPrompt || s.description || '',
        dialogue: s.dialogue || '',
        duration: s.duration || 3,
        status: 'pending',
        resultUrl: null
      }));

      this.sceneResults = [];
      this.saveHistory();
      this.showEditor();
      this.renderScenes();

      DOM.storyboardEditor.scrollIntoView({ behavior: 'smooth' });
      showToast(`🎬 故事板已生成，共 ${this.scenes.length} 个场景`, 'success');
    } catch (err) {
      showToast(`故事板生成失败: ${err.message}`, 'error');
    } finally {
      DOM.generateStoryboard.disabled = false;
      DOM.generateStoryboard.innerHTML = '<span class="btn-icon">🤖</span> 生成故事板';
    }
  },

  showEditor() {
    DOM.storyboardEditor.style.display = 'block';
    DOM.sceneProgress.style.display = 'none';
    DOM.storyboardResult.style.display = 'none';
  },

  renderScenes() {
    DOM.sceneList.innerHTML = '';

    // Clean up stale ImageUpload instances from old (now detached) DOM elements
    ImageUpload.instances.forEach((inst, key) => {
      if (key instanceof HTMLElement && !document.body.contains(key)) {
        ImageUpload.instances.delete(key);
      }
    });

    this.scenes.forEach((scene, index) => {
      const card = this.createSceneCard(scene, index);
      DOM.sceneList.appendChild(card);
    });

    DOM.editorSummary.textContent = `${this.scenes.length} 个场景 · 总时长约 ${this.scenes.reduce((sum, s) => sum + (s.duration || 3), 0)} 秒`;
  },

  createSceneCard(scene, index) {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.dataset.sceneId = scene.id;

    const statusMap = {
      'pending': '⏳ 待生成',
      'processing': '🔄 生成中',
      'completed': '✅ 已完成',
      'failed': '❌ 失败'
    };

    // Header
    const header = document.createElement('div');
    header.className = 'scene-card-header';
    header.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });

    header.innerHTML = `
      <div class="scene-number">
        <span class="num-badge">${index + 1}</span>
        <span>${this.escapeHtml(scene.title)}</span>
        <span class="scene-status-badge ${scene.status}">${statusMap[scene.status] || '⏳ 待生成'}</span>
      </div>
      <div class="scene-actions">
        <span class="collapse-icon">▼</span>
        <button class="delete-scene" title="删除场景" data-index="${index}">🗑️</button>
      </div>
    `;

    // Body
    const body = document.createElement('div');
    body.className = 'scene-card-body';

    body.innerHTML = `
      <div class="scene-field">
        <label>🎯 场景标题</label>
        <input type="text" class="scene-title-input" value="${this.escapeHtml(scene.title)}" data-index="${index}">
      </div>
      <div class="scene-field">
        <label>📝 场景描述（文学脚本）</label>
        <textarea class="scene-desc-input" rows="2" data-index="${index}">${this.escapeHtml(scene.description)}</textarea>
      </div>
      <div class="scene-field">
        <label>🎬 视频生成提示词 (Visual Prompt)</label>
        <textarea class="scene-visual-input scene-visual" rows="3" data-index="${index}">${this.escapeHtml(scene.visualPrompt)}</textarea>
      </div>
      <div class="scene-field">
        <label>🎙️ 旁白/台词</label>
        <input type="text" class="scene-dialogue-input" value="${this.escapeHtml(scene.dialogue)}" data-index="${index}" placeholder="留空则不生成配音">
      </div>
      <div class="scene-field-row">
        <div class="scene-field">
          <label>⏱️ 时长 (秒)</label>
          <input type="number" class="scene-duration-input" value="${scene.duration || 3}" min="2" max="10" data-index="${index}">
        </div>
        <div class="scene-field">
          <label>🖼️ 参考图片</label>
          <div class="dropzone dropzone-inline scene-ref-dropzone" data-scene-id="${scene.id}">
            <div class="dz-icon">🖼️</div>
            <div class="dz-text">拖拽或点击</div>
            <div class="dz-preview">
              <img src="" alt="preview">
              <div class="dz-info">
                <div class="dz-name"></div>
              </div>
              <button class="dz-remove" type="button">✕</button>
            </div>
          </div>
        </div>
      </div>
    `;

    card.appendChild(header);
    card.appendChild(body);

    // Wire up events
    card.querySelector('.delete-scene').addEventListener('click', (e) => {
      e.stopPropagation();
      this.deleteScene(index);
    });

    card.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('change', () => this.syncSceneData());
      el.addEventListener('input', () => this.syncSceneData());
    });

    // Init the scene's ref image dropzone
    const sceneDropzone = card.querySelector('.scene-ref-dropzone');
    if (sceneDropzone) {
      const dz = ImageUpload.init(sceneDropzone, {
        onChange: (dataUrl) => {
          scene.refImage = dataUrl || '';
          this.saveHistory();
        }
      });
      // Restore previously uploaded image
      if (scene.refImage) {
        dz.setImage(scene.refImage);
      }
    }

    return card;
  },

  syncSceneData() {
    const cards = DOM.sceneList.querySelectorAll('.scene-card');
    cards.forEach((card, i) => {
      if (i < this.scenes.length) {
        const scene = this.scenes[i];
        scene.title = card.querySelector('.scene-title-input')?.value || scene.title;
        scene.description = card.querySelector('.scene-desc-input')?.value || scene.description;
        scene.visualPrompt = card.querySelector('.scene-visual-input')?.value || scene.visualPrompt;
        scene.dialogue = card.querySelector('.scene-dialogue-input')?.value || scene.dialogue;
        scene.duration = parseFloat(card.querySelector('.scene-duration-input')?.value) || scene.duration;
        scene.refImage = card.querySelector('.scene-ref-input')?.value || '';
      }
    });
    this.saveHistory();
    DOM.editorSummary.textContent = `${this.scenes.length} 个场景 · 总时长约 ${this.scenes.reduce((sum, s) => sum + (s.duration || 3), 0)} 秒`;
  },

  addEmptyScene() {
    this.scenes.push({
      id: `${Date.now()  }-${  this.scenes.length}`,
      scene: this.scenes.length + 1,
      title: `场景 ${this.scenes.length + 1}`,
      description: '',
      visualPrompt: '',
      dialogue: '',
      duration: 3,
      refImage: '',
      status: 'pending',
      resultUrl: null
    });
    this.renderScenes();
    this.saveHistory();
    // Scroll to bottom
    setTimeout(() => {
      DOM.sceneList.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  },

  deleteScene(index) {
    if (this.scenes.length <= 1) {
      showToast('至少保留一个场景', 'error');
      return;
    }
    this.scenes.splice(index, 1);
    this.scenes.forEach((s, i) => s.scene = i + 1);
    this.renderScenes();
    this.saveHistory();
  },

  async generateAllVideos() {
    this.syncSceneData();

    const pendingScenes = this.scenes.filter(s => s.status !== 'completed');
    if (pendingScenes.length === 0) {
      showToast('所有场景视频已生成', 'info');
      return;
    }

    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }

    this.isGenerating = true;
    DOM.generateAllVideos.disabled = true;
    DOM.generateAllVideos.innerHTML = '<span class="spinner" style="width:18px;height:18px;border-width:2px;"></span> 批量生成中...';

    // Reset pending scenes
    this.scenes.forEach(s => {
      if (s.status !== 'completed') {
        s.status = 'pending';
        s.resultUrl = null;
      }
    });

    // Show progress view
    DOM.storyboardEditor.style.display = 'none';
    DOM.sceneProgress.style.display = 'block';
    DOM.storyboardResult.style.display = 'none';

    this.renderProgress();
    this.sceneResults = [];

    const fps = parseInt(DOM.storyFps?.value) || 16;
    const frames = parseInt(DOM.storyFrames?.value) || 49;

    for (let i = 0; i < this.scenes.length; i++) {
      const scene = this.scenes[i];

      // Skip already completed
      if (scene.status === 'completed') continue;

      scene.status = 'processing';
      this.updateProgressItem(i, 'processing', '生成中...');
      this.updateGlobalProgress();

      try {
        const prompt = scene.visualPrompt || scene.description;
        if (!prompt.trim()) {
          throw new Error('场景提示词为空');
        }

        const data = await API.createVideoTask(prompt, {
          refImage: scene.refImage || '',
          frames,
          fps
        });

        const videoId = data.video_id || data.id;
        this.updateProgressItem(i, 'processing', '等待渲染...');

        // Poll for result
        const result = await this.pollVideoResult(videoId);

        if (result.status === 'completed' || result.video_url) {
          scene.status = 'completed';
          scene.resultUrl = result.video_url || result.url || result.output?.video_url || '';
          this.updateProgressItem(i, 'done', '✅ 完成');
        } else {
          throw new Error(result.error || '生成失败');
        }
      } catch (err) {
        scene.status = 'failed';
        this.updateProgressItem(i, 'fail', `❌ ${err.message.slice(0, 30)}`);
      }

      this.updateGlobalProgress();
      this.saveHistory();
    }

    // Done
    this.isGenerating = false;
    DOM.generateAllVideos.disabled = false;
    DOM.generateAllVideos.innerHTML = '<span class="btn-icon">🎬</span> 生成所有视频';

    if (this.scenes.some(s => s.status === 'completed')) {
      this.saveHistory();
      this.showResults();
      showToast('🎉 视频生成完成！', 'success');
    } else {
      showToast('所有场景生成失败，请检查提示词', 'error');
      DOM.sceneProgress.style.display = 'none';
      DOM.storyboardEditor.style.display = 'block';
    }
  },

  pollVideoResult(videoId, maxRetries = 60) {
    return new Promise((resolve, reject) => {
      let retries = 0;
      const poll = async () => {
        try {
          const data = await API.queryVideoTask(videoId);
          if (data.status === 'completed' || data.status === 'success' || data.video_url) {
            resolve(data);
          } else if (data.status === 'failed' || data.error) {
            reject(new Error(data.error || '视频生成失败'));
          } else {
            retries++;
            if (retries > maxRetries) {
              reject(new Error('生成超时'));
            } else {
              setTimeout(poll, 8000);
            }
          }
        } catch (err) {
          retries++;
          if (retries > maxRetries) {
            reject(new Error('轮询超时'));
          } else {
            setTimeout(poll, 8000);
          }
        }
      };
      // Start after a short delay
      setTimeout(poll, 3000);
    });
  },

  renderProgress() {
    DOM.sceneProgressList.innerHTML = '';
    this.scenes.forEach((scene, i) => {
      const item = document.createElement('div');
      item.className = 'scene-progress-item';
      item.id = `sp-item-${i}`;
      item.innerHTML = `
        <div class="sp-item-num">${i + 1}</div>
        <div class="sp-item-text">${this.escapeHtml(scene.title)}</div>
        <div class="sp-item-status">⏳ 等待中</div>
      `;
      DOM.sceneProgressList.appendChild(item);
    });
    this.updateGlobalProgress();
  },

  updateProgressItem(index, state, text) {
    const item = document.getElementById(`sp-item-${index}`);
    if (!item) return;
    const num = item.querySelector('.sp-item-num');
    const status = item.querySelector('.sp-item-status');

    num.className = `sp-item-num ${state}`;
    status.className = `sp-item-status ${state}`;
    status.textContent = text || '';
  },

  updateGlobalProgress() {
    const total = this.scenes.length;
    const done = this.scenes.filter(s => s.status === 'completed').length;
    const failed = this.scenes.filter(s => s.status === 'failed').length;
    const completed = done + failed;
    const pct = total > 0 ? (completed / total) * 100 : 0;

    DOM.progressCounter.textContent = `${done} / ${total}`;
    DOM.progressGlobalFill.style.width = `${Math.min(pct, 100)}%`;
  },

  showResults() {
    DOM.sceneProgress.style.display = 'none';
    DOM.storyboardResult.style.display = 'block';
    DOM.storyboardEditor.style.display = 'block';

    DOM.resultScenes.innerHTML = '';

    this.scenes.forEach((scene, i) => {
      if (scene.status !== 'completed' || !scene.resultUrl) return;

      const div = document.createElement('div');
      div.className = 'result-scene';

      // Try to create video element
      const video = document.createElement('video');
      video.src = scene.resultUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.style.width = '100%';
      video.style.maxHeight = '450px';

      const info = document.createElement('div');
      info.className = 'result-scene-info';
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = '⬇️ 下载';
      downloadBtn.addEventListener('click', () => window.open(scene.resultUrl, '_blank'));

      info.innerHTML = `
        <span class="rs-label">🎬 场景 ${i + 1}: ${this.escapeHtml(scene.title)}</span>
        <div class="rs-actions"></div>
      `;
      info.querySelector('.rs-actions').appendChild(downloadBtn);

      div.appendChild(video);
      div.appendChild(info);
      DOM.resultScenes.appendChild(div);
    });

    if (DOM.resultScenes.children.length === 0) {
      DOM.resultScenes.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:20px;">暂无成功生成的视频</p>';
    }
  },

  downloadAll() {
    const completed = this.scenes.filter(s => s.status === 'completed' && s.resultUrl);
    completed.forEach(scene => {
      window.open(scene.resultUrl, '_blank');
    });
    showToast(`已打开 ${completed.length} 个视频下载链接`, 'info');
  },

  clearAll() {
    this.scenes = [];
    this.sceneResults = [];
    DOM.storyboardEditor.style.display = 'none';
    DOM.sceneProgress.style.display = 'none';
    DOM.storyboardResult.style.display = 'none';
    DOM.sceneList.innerHTML = '';
    DOM.storyConcept.value = '';
    DOM.storySceneCount.value = '5';
    DOM.storyStyle.value = '电影质感';
    DOM.storyResolution.value = '16:9';
    DOM.storyFrames.value = '49';
    DOM.storyFps.value = '16';
    this.saveHistory();
    showToast('故事板已清空', 'info');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

// ============================================
// 提示词优化模块 (AI 驱动)
// ============================================
const PromptOptimizer = {
  isOptimizing: false,

  init() {
    DOM.optimizeImagePrompt.addEventListener('click', () => this.optimize('image'));
    DOM.optimizeVideoPrompt.addEventListener('click', () => this.optimize('video'));
    DOM.imageOptimizerApplyCN.addEventListener('click', () => this.applyOptimized('image', 'zh'));
    DOM.imageOptimizerApplyEN.addEventListener('click', () => this.applyOptimized('image', 'en'));
    DOM.videoOptimizerApplyCN.addEventListener('click', () => this.applyOptimized('video', 'zh'));
    DOM.videoOptimizerApplyEN.addEventListener('click', () => this.applyOptimized('video', 'en'));
    DOM.imageOptimizerDiscard.addEventListener('click', () => this.hideResult('image'));
    DOM.videoOptimizerDiscard.addEventListener('click', () => this.hideResult('video'));
    DOM.imageOptimizerClose.addEventListener('click', () => this.hideResult('image'));
    DOM.videoOptimizerClose.addEventListener('click', () => this.hideResult('video'));

    // Tab switching for bilingual display
    this.initTabs('image');
    this.initTabs('video');
  },

  initTabs(type) {
    const panel = type === 'image' ? DOM.imageOptimizerResult : DOM.videoOptimizerResult;
    panel.querySelectorAll('.or-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.or-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const lang = tab.dataset.lang;
        panel.querySelectorAll('.or-lang').forEach(l => {
          l.style.display = l.dataset.lang === lang ? 'block' : 'none';
        });
      });
    });
  },

  parseBilingual(text) {
    // Try to extract CN and EN sections from the AI response
    let zh = '', en = '';

    // Pattern 1: Clearly marked sections like "中文描述：..." and "English Prompt: ..."
    const zhMatch = text.match(/(?:中文描述|中文|🇨🇳)[：:]+([\s\S]*?)(?=(?:英文|English|🇬🇧|──|---|___))/i);
    const enMatch = text.match(/(?:英文|English|🇬🇧)[：:]*\s*([\s\S]*)/i);

    if (zhMatch && enMatch) {
      zh = zhMatch[1].trim();
      en = enMatch[1].trim();
      // Clean up trailing dashes or markers from zh
      zh = zh.replace(/[\n\s]*(──|---|___)<br>.*$/s, '').trim();
    }

    // Pattern 2: If no clear markers, treat as Chinese and translate (fallback: use full text for both)
    if (!zh && !en) {
      // Check if most characters are ASCII (likely English)
      const asciiRatio = (text.match(/[\x00-\x7F]/g) || []).length / text.length;
      if (asciiRatio > 0.7) {
        en = text;
        zh = text;
      } else {
        zh = text;
        en = text;
      }
    }

    return { zh, en };
  },

  async optimize(type) {
    const isImage = type === 'image';
    const textarea = isImage ? DOM.imagePrompt : DOM.videoPrompt;
    const btn = isImage ? DOM.optimizeImagePrompt : DOM.optimizeVideoPrompt;
    const resultPanel = isImage ? DOM.imageOptimizerResult : DOM.videoOptimizerResult;
    const zhPanel = resultPanel.querySelector('.or-lang[data-lang="zh"]');
    const enPanel = resultPanel.querySelector('.or-lang[data-lang="en"]');

    const prompt = textarea.value.trim();
    if (!prompt) {
      showToast('请先输入要优化的提示词', 'error');
      return;
    }
    if (!State.apiKey) {
      showToast('请先在设置中配置 API Key', 'error');
      return;
    }
    if (this.isOptimizing) return;

    this.isOptimizing = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> 优化中...';

    try {
      const style = isImage ? (DOM.imageStyle.value || '无特定风格') : '';
      const systemPrompt = `你是一个专业的 AI 提示词工程师。你的任务是将用户的简单描述优化为高质量的 ${isImage ? '图片生成' : '视频生成'} 提示词。

要求:
1. 保持原始创意核心不变
2. 添加丰富的视觉细节: 光线、色彩、构图、质感、氛围
3. 使用精确的修饰词和艺术术语
4. 如果涉及风格（如${style}），强化风格表现
5. ${isImage ? '推荐适合的构图方式和镜头语言' : '描述画面运动和镜头变化'}

重要: 必须用以下格式输出双语内容（中英文各一版）:

🇨🇳 中文描述:
[这里写中文优化版，约100-200字，包含所有视觉细节的流畅描述]

---

🇬🇧 English Prompt:
[这里写英文优化版，适合直接用于AI ${isImage ? '图片' : '视频'}生成的完整英文提示词]

注意: 中文版和英文版的创意核心一致，但英文版要更贴近AI ${isImage ? '图片' : '视频'}模型的提示词习惯，使用英文视觉术语。`;

      const resp = await API.sendChatMessage([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请优化这个${isImage ? '图片' : '视频'}提示词，输出中英双语:\n\n${prompt}` }
      ]);

      const raw = resp.choices[0].message.content.trim();
      const { zh, en } = this.parseBilingual(raw);

      // Show result
      zhPanel.textContent = zh || raw;
      enPanel.textContent = en || raw;

      // Reset to Chinese tab
      resultPanel.querySelectorAll('.or-tab').forEach(t => t.classList.remove('active'));
      resultPanel.querySelector('.or-tab[data-lang="zh"]').classList.add('active');
      resultPanel.querySelectorAll('.or-lang').forEach(l => {
        l.style.display = l.dataset.lang === 'zh' ? 'block' : 'none';
      });

      resultPanel.style.display = 'block';
      resultPanel._zhText = zh || raw;
      resultPanel._enText = en || raw;
      resultPanel._targetTextarea = textarea;

      showToast('✨ 双语提示词优化完成！', 'success');
    } catch (err) {
      showToast(`优化失败: ${err.message}`, 'error');
    } finally {
      this.isOptimizing = false;
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">✨</span> 优化提示词';
    }
  },

  applyOptimized(type, lang) {
    const resultPanel = type === 'image' ? DOM.imageOptimizerResult : DOM.videoOptimizerResult;
    const target = type === 'image' ? DOM.imagePrompt : DOM.videoPrompt;
    const text = lang === 'en' ? resultPanel._enText : resultPanel._zhText;
    if (text) {
      target.value = text;
      target.focus();
      this.hideResult(type);
      const label = lang === 'en' ? '英文版' : '中文版';
      showToast(`✅ 已采纳${label}提示词`, 'success');
    }
  },

  hideResult(type) {
    const panel = type === 'image' ? DOM.imageOptimizerResult : DOM.videoOptimizerResult;
    panel.style.display = 'none';
    panel._zhText = null;
    panel._enText = null;
    panel._targetTextarea = null;
  }
};

// ============================================
// 故事板 AI 助手（教程 + 优化）
// ============================================
const StoryboardAssistant = {
  _isLoading: false,

  init() {
    DOM.storyboardTutorBtn.addEventListener('click', () => this.togglePanel());
    DOM.saClose.addEventListener('click', () => this.closePanel());
    DOM.saSuggestScenes.addEventListener('click', () => this.suggestScenes());
    DOM.saImprovePrompts.addEventListener('click', () => this.improveAllPrompts());
    DOM.saReview.addEventListener('click', () => this.reviewStoryboard());
    DOM.saTiming.addEventListener('click', () => this.adjustTimingByDialogue());
  },

  togglePanel() {
    const panel = DOM.storyboardAssistant;
    if (panel.style.display === 'block') {
      this.closePanel();
    } else {
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth' });
    }
  },

  closePanel() {
    DOM.storyboardAssistant.style.display = 'none';
  },

  addMessage(text, role = 'ai') {
    const msg = document.createElement('div');
    msg.className = `sa-message sa-message-${role}`;
    msg.innerHTML = `
      <div class="sa-msg-avatar">${role === 'ai' ? '🤖' : '👤'}</div>
      <div class="sa-msg-content">${text}</div>
    `;
    DOM.saMessages.appendChild(msg);
    DOM.saMessages.scrollTop = DOM.saMessages.scrollHeight;
  },

  setStep(stepId) {
    DOM.saSteps.querySelectorAll('.sa-step').forEach(s => {
      s.classList.remove('active', 'done');
      if (s.dataset.step === stepId) s.classList.add('active');
      // Mark previous steps as done
      const steps = ['concept', 'scenes', 'prompts', 'generate'];
      const idx = steps.indexOf(stepId);
      steps.slice(0, idx).forEach(id => {
        const el = DOM.saSteps.querySelector(`[data-step="${id}"]`);
        if (el) { el.classList.add('done'); el.classList.remove('active'); }
      });
    });
  },

  async callAI(systemPrompt, userMessage) {
    if (!State.apiKey) {
      showToast('请先配置 API Key', 'error');
      return null;
    }
    try {
      const resp = await API.sendChatMessage([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]);
      return resp.choices[0].message.content;
    } catch (err) {
      showToast(`AI 请求失败: ${err.message}`, 'error');
      return null;
    }
  },

  async suggestScenes() {
    const concept = DOM.storyConcept.value.trim();
    if (!concept) {
      this.addMessage('请先在概念输入框中写下你的创意想法！', 'ai');
      return;
    }
    if (this._isLoading) return;
    this._isLoading = true;
    this._origSuggestText = DOM.saSuggestScenes.innerHTML;
    DOM.saSuggestScenes.disabled = true;
    DOM.saSuggestScenes.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 分析中...';

    const style = DOM.storyStyle.value;
    this.setStep('scenes');
    this.addMessage(`📖 正在分析你的创意「${concept.slice(0, 40)}...」，我来为你拆解场景...`, 'ai');

    const systemPrompt = `你是一个故事板拆解专家。面对一个创意概念，你要给出场景拆解建议。

输出格式（HTML，不要用markdown）：
<p>首先分析故事的叙事结构，然后逐一建议场景。</p>
<ul>
<li><strong>场景 1 - 标题</strong>：一句话描述</li>
<li><strong>场景 2 - 标题</strong>：一句话描述</li>
</ul>
<p>最后给出一个总体建议。</p>

不要输出JSON，用适合在网页上展示的HTML格式。`;

    const result = await this.callAI(systemPrompt,
      `创意概念: ${concept}\n视觉风格: ${style}\n请为这个故事建议4-6个场景的分镜方案。`
    );

    if (result) {
      this.addMessage(result, 'ai');
      this.addMessage('💡 觉得这些场景不错？点击 "🤖 生成故事板" 按钮自动生成详细场景，或者在编辑器里手动调整。', 'ai');
    }
    this._isLoading = false;
    DOM.saSuggestScenes.disabled = false;
    DOM.saSuggestScenes.innerHTML = this._origSuggestText || '📖 帮我拆解场景';
  },

  async improveAllPrompts() {
    const scenes = StoryboardModule.scenes;
    if (!scenes || scenes.length === 0) {
      this.addMessage('还没有场景需要优化。先生成一个故事板，或者手动添加场景吧！', 'ai');
      return;
    }
    if (this._isLoading) return;
    this._isLoading = true;
    this._origImproveText = DOM.saImprovePrompts.innerHTML;
    DOM.saImprovePrompts.disabled = true;
    DOM.saImprovePrompts.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 优化中...';

    this.setStep('prompts');
    this.addMessage(`✨ 正在优化 ${scenes.length} 个场景的视觉提示词...`, 'ai');

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.visualPrompt) continue;

      this.addMessage(`🔄 优化场景 ${i + 1}: ${scene.title}...`, 'ai');

      const systemPrompt = `你是一个专业的 AI 视频提示词工程师。将用户提供的场景视觉提示词优化得更加丰富和可执行。

要求:
- 用英文写（AI 视频模型对英文响应更好）
- 包含: 镜头运动、光线氛围、色彩基调、视觉风格、主体动作
- 输出纯英文，不要任何解释或标记
- 保持原始创意核心不变
- 输出长度控制在 100-200 词之间`;

      const result = await this.callAI(systemPrompt,
        `原始视觉提示词:\n${scene.visualPrompt}\n\n\n请优化并翻译为英文视觉提示词。`
      );

      if (result) {
        scene.visualPrompt = result.trim();
      }
    }

    StoryboardModule.saveHistory();
    StoryboardModule.renderScenes();
    this.addMessage('✅ 所有场景提示词已优化完成！现在可以点击 🎬 生成所有视频 来生成视频了。', 'ai');
    this._isLoading = false;
    DOM.saImprovePrompts.disabled = false;
    DOM.saImprovePrompts.innerHTML = this._origImproveText || '✨ 优化所有提示词';
  },

  async reviewStoryboard() {
    const scenes = StoryboardModule.scenes;
    if (!scenes || scenes.length === 0) {
      this.addMessage('故事板是空的。请先创建一个故事板再来审阅。', 'ai');
      return;
    }
    if (this._isLoading) return;
    this._isLoading = true;
    this._origReviewText = DOM.saReview.innerHTML;
    DOM.saReview.disabled = true;
    DOM.saReview.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 审阅中...';

    this.addMessage('🔍 正在审阅你的故事板...', 'ai');

    const scenesText = scenes.map((s, i) =>
      `场景 ${i + 1}: ${s.title}\n描述: ${s.description}\n视觉提示词: ${s.visualPrompt}\n旁白: ${s.dialogue}\n时长: ${s.duration}秒`
    ).join('\n\n---\n\n');

    const systemPrompt = `你是一个专业的故事板审阅编辑。分析用户的故事板，给出建设性的反馈。

输出格式（HTML）:
<ul>
<li><strong>优点</strong>：指出亮点</li>
<li><strong>改进建议</strong>：具体可操作的改进点</li>
<li><strong>连贯性</strong>：场景之间的过渡和叙事流</li>
</ul>
<p>最后给出一个总体评分和建议。</p>`;

    const result = await this.callAI(systemPrompt,
      `请审阅以下故事板:\n\n${scenesText}`
    );

    if (result) {
      this.addMessage(result, 'ai');
      this.addMessage('💡 根据审阅建议修改后，别忘了保存！修改好后点击 🎬 生成所有视频。', 'ai');
    }
    this._isLoading = false;
    DOM.saReview.disabled = false;
    DOM.saReview.innerHTML = this._origReviewText || '🔍 审阅故事板';
  },

  async adjustTimingByDialogue() {
    const scenes = StoryboardModule.scenes;
    if (!scenes || scenes.length === 0) {
      this.addMessage('故事板是空的。请先创建一个故事板再来调整时长。', 'ai');
      return;
    }
    if (this._isLoading) return;
    this._isLoading = true;
    this._origTimingText = DOM.saTiming.innerHTML;
    DOM.saTiming.disabled = true;
    DOM.saTiming.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 分析中...';

    this.addMessage('⏱️ 正在根据旁白内容分析每场景最佳时长...', 'ai');

    // First, apply a local naive fallback based on dialogue length
    for (const scene of scenes) {
      const dialogue = scene.dialogue || '';
      // Chinese: ~3.5 chars/sec; English: ~3 words/sec; other: ~3 chars/sec
      const rawDuration = dialogue.length / 3.5;
      // Add 1.5s buffer for pauses/expression, clamp to [2, 10]
      const suggested = Math.max(2, Math.min(10, Math.round(rawDuration + 1.5)));
      scene.duration = suggested;
    }

    // Then call AI to refine the timing with more nuance
    const scenesText = scenes.map((s, i) =>
      `场景 ${i + 1}: "${s.title}"\n旁白: "${s.dialogue || '(无旁白)'}"\n当前时长: ${s.duration}秒`
    ).join('\n\n---\n\n');

    const systemPrompt = `你是一个专业的影视节奏剪辑师。根据每个场景的旁白/台词内容，为每个场景推荐最佳时长。

考虑因素:
- 中文旁白: 朗读速度约每秒3-4个汉字
- 英文旁白: 朗读速度约每秒2.5-3个单词
- 需要预留情感停顿、戏剧张力的时间
- 没有旁白的场景: 根据场景描述复杂度推荐 3-5 秒
- 最短2秒，最长10秒

输出格式（严格的JSON对象，不要任何其他文字）:
{
  "scenes": [
    {"index": 0, "duration": 4, "reason": "简短台词，2秒够用，加1秒缓冲"},
    {"index": 1, "duration": 7, "reason": "情绪转折需要更多时间"}
  ]
}`;

    const result = await this.callAI(systemPrompt,
      `请分析以下每个场景的旁白，推荐最佳时长:\n\n${scenesText}`
    );

    if (result) {
      try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.scenes && Array.isArray(parsed.scenes)) {
            parsed.scenes.forEach(rec => {
              if (rec.index >= 0 && rec.index < scenes.length) {
                const d = Math.max(2, Math.min(10, Math.round(rec.duration)));
                scenes[rec.index].duration = d;
              }
            });
          }
        }
      } catch (e) {
        // Fallback: keep the local naive calculation results
        console.warn('AI timing refinement failed, using local fallback:', e.message);
      }
    }

    StoryboardModule.saveHistory();
    StoryboardModule.renderScenes();

    const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 3), 0);
    this.addMessage(`✅ 已根据旁白调整 ${scenes.length} 个场景的时长！总时长约 ${totalDuration} 秒。<br><br>💡 你可以在场景编辑器中手动微调每个场景的时长。`, 'ai');

    this._isLoading = false;
    DOM.saTiming.disabled = false;
    DOM.saTiming.innerHTML = this._origTimingText || '⏱️ 根据旁白调整时长';
  }
};

// ============================================
// Prompt 模板库
// ============================================
const PromptLibrary = {
  categories: ['image', 'video', 'storyboard', 'custom'],
  activeCategory: 'image',
  builtInTemplates: {
    image: [
      { id: 'img-1', title: '🎨 照片级写实', prompt: '超写实摄影风格，8K分辨率，自然光线，景深效果，细腻纹理，专业级商业摄影', tags: ['写实', '摄影', '专业'] },
      { id: 'img-2', title: '🌅 梦幻风景', prompt: '梦幻般的风景，金色时刻，柔和的晨雾，绚丽的色彩，宽视角，画意摄影风格', tags: ['风景', '梦幻', '色彩'] },
      { id: 'img-3', title: '🤖 赛博朋克城市', prompt: '赛博朋克风格未来城市，霓虹灯光，雨夜，全息广告，摩天大楼，科技感，暗调氛围', tags: ['科幻', '城市', '赛博朋克'] },
      { id: 'img-4', title: '🎎 动漫角色', prompt: '日式动漫风格角色，精致的线条，鲜艳的色彩，大眼睛，表现力强，Studio Ghibli风格', tags: ['动漫', '角色', '二次元'] },
      { id: 'img-5', title: '🖌️ 水彩插画', prompt: '水彩画风格，柔和的边缘，自然的色彩晕染，纸张纹理，艺术感，手绘质感', tags: ['水彩', '插画', '艺术'] },
      { id: 'img-6', title: '🏛️ 古典油画', prompt: '古典油画风格，伦勃朗式用光，厚重的笔触，深色调，博物馆级艺术品，亚麻布纹理', tags: ['油画', '古典', '艺术'] },
      { id: 'img-7', title: '🌌 奇幻世界', prompt: '奇幻史诗场景，浮空岛屿，魔法光效，巨龙，水晶城堡，华丽细节，D&D风格', tags: ['奇幻', '史诗', '游戏'] },
      { id: 'img-8', title: '📱 像素艺术', prompt: '复古像素艺术风格，8-bit游戏画面，有限色彩，方块像素，怀旧，角色精灵', tags: ['像素', '复古', '游戏'] },
      { id: 'img-9', title: '🏺 3D渲染', prompt: 'Pixar风格3D渲染，柔和的材质，全局光照，次表面散射，可爱的角色设计，CGI动画风格', tags: ['3D', '渲染', '卡通'] },
      { id: 'img-10', title: '🌺 中国风国画', prompt: '中国水墨画风格，留白意境，写意山水，宣纸质感，墨色浓淡变化，传统东方美学', tags: ['国风', '水墨', '传统'] },
    ],
    video: [
      { id: 'vid-1', title: '🌄 壮丽日出', prompt: '壮丽的日出景象，金色阳光穿透云层，广角镜头，云海翻涌，电影级调色，史诗般氛围', tags: ['日出', '风景', '电影感'] },
      { id: 'vid-2', title: '🌊 海浪拍岸', prompt: '海浪拍打岩石海岸，慢动作，飞溅的水花，夕阳余晖，电影质感，身临其境的音效感', tags: ['海浪', '慢动作', '自然'] },
      { id: 'vid-3', title: '🏙️ 城市延时', prompt: '城市天际线延时摄影，车流灯光轨迹，霓虹闪烁，云层流动，赛博朋克色调，科技感', tags: ['城市', '延时', '夜景'] },
      { id: 'vid-4', title: '🌲 森林漫步', prompt: '幽静森林中的漫步镜头，丁达尔效应光束穿过树叶，晨露，绿色调，禅意宁静', tags: ['森林', '自然', '宁静'] },
      { id: 'vid-5', title: '🔥 火焰特效', prompt: '绚丽火焰特效，粒子系统，火星飞溅，暖色调，动态感强，慢动作，电影特效风格', tags: ['火焰', '特效', '动态'] },
      { id: 'vid-6', title: '❄️ 雪景飘雪', prompt: '冬日雪景，大片雪花飘落，银装素裹，冷色调，宁静安详，远山若隐若现', tags: ['雪景', '冬季', '宁静'] },
    ],
    storyboard: [
      { id: 'sb-1', title: '🎭 英雄之旅', prompt: '一个普通人的英雄成长故事：从安逸的日常出发，经历挑战与磨砺，最终战胜内心恐惧，守护珍视之人。包含起承转合的完整叙事弧线。', tags: ['英雄', '成长', '叙事'] },
      { id: 'sb-2', title: '💔 科幻悲剧', prompt: '未来世界AI觉醒后的伦理困境：人类与机器的界限模糊，一段跨越种族的友情最终以悲剧收场，引发对生命意义的深刻思考。', tags: ['科幻', '悲剧', '伦理'] },
      { id: 'sb-3', title: '🧙 魔法学院', prompt: '少年进入魔法学院学习，发现古老的预言与自己相关，与伙伴们一起探索禁忌知识，最终面对黑暗势力的威胁。', tags: ['奇幻', '学院', '冒险'] },
      { id: 'sb-4', title: '🌪️ 末日逃生', prompt: '末世废土背景下的生存故事，少数幸存者在荒芜世界中寻找希望，人性的光辉与黑暗在极端环境中交织展现。', tags: ['末日', '生存', '废土'] },
      { id: 'sb-5', title: '🌸 治愈日常', prompt: '都市青年辞去工作回到乡下，在四季更迭中经营一家小店，与形形色色的客人相遇，在平凡生活中找到真正的幸福。', tags: ['治愈', '日常', '温馨'] },
    ]
  },

  userTemplates: [],

  init() {
    this.loadUserTemplates();
    this.renderTabs();
    this.renderTemplates();
    this.bindEvents();
  },

  loadUserTemplates() {
    const saved = localStorage.getItem('agnes_prompt_templates');
    if (saved) {
      try { this.userTemplates = JSON.parse(saved); }
      catch (e) { this.userTemplates = []; }
    }
  },

  saveUserTemplates() {
    localStorage.setItem('agnes_prompt_templates', JSON.stringify(this.userTemplates));
  },

  bindEvents() {
    DOM.openPrompts.addEventListener('click', () => this.open());
    DOM.promptClose.addEventListener('click', () => this.close());
    DOM.promptOverlay.addEventListener('click', () => this.close());

    DOM.promptSearch.addEventListener('input', () => this.renderTemplates());

    DOM.saveTemplateBtn.addEventListener('click', () => this.saveCurrentAsTemplate());

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && DOM.promptPanel.classList.contains('open')) {
        this.close();
      }
    });
  },

  open() {
    DOM.promptPanel.classList.add('open');
    DOM.promptOverlay.classList.add('open');
    DOM.promptSearch.focus();
    this.renderTemplates();
  },

  close() {
    DOM.promptPanel.classList.remove('open');
    DOM.promptOverlay.classList.remove('open');
  },

  renderTabs() {
    DOM.promptTabs.innerHTML = '';
    const tabs = [
      { id: 'image', label: '🎨 制图' },
      { id: 'video', label: '🎬 视频' },
      { id: 'storyboard', label: '📖 故事板' },
      { id: 'custom', label: '💾 我的' },
    ];
    tabs.forEach(t => {
      const btn = document.createElement('button');
      btn.className = `prompt-tab ${t.id === this.activeCategory ? 'active' : ''}`;
      btn.textContent = t.label;
      btn.dataset.cat = t.id;
      btn.addEventListener('click', () => {
        this.activeCategory = t.id;
        this.renderTabs();
        this.renderTemplates();
      });
      DOM.promptTabs.appendChild(btn);
    });
  },

  getCurrentTemplates() {
    const builtIn = this.builtInTemplates[this.activeCategory] || [];
    const custom = this.activeCategory === 'custom'
      ? this.userTemplates
      : this.userTemplates.filter(t => t.category === this.activeCategory);

    if (this.activeCategory === 'custom') return custom;
    return [...builtIn, ...custom];
  },

  renderTemplates() {
    const query = DOM.promptSearch.value.toLowerCase().trim();
    let templates = this.getCurrentTemplates();

    if (query) {
      templates = templates.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.prompt.toLowerCase().includes(query) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }

    DOM.templateList.innerHTML = '';

    if (templates.length === 0) {
      DOM.templateList.innerHTML = `
        <div class="gallery-empty" style="padding:30px 10px;">
          <div class="empty-icon">📭</div>
          <h3>${query ? '没有匹配的模板' : '还没有自定义模板'}</h3>
          <p>${query ? '试试其他关键词' : '在上方输入名称和内容，点击保存'}</p>
        </div>
      `;
      return;
    }

    templates.forEach(t => {
      const card = document.createElement('div');
      card.className = 'template-card';

      const isCustom = t._isUser || this.userTemplates.includes(t);

      card.innerHTML = `
        <div class="tc-header">
          <div class="tc-title">
            ${t.title}
            ${isCustom ? '<span class="tc-badge custom">自定义</span>' : '<span class="tc-badge">内置</span>'}
          </div>
          <div class="tc-actions">
            ${isCustom ? '<button class="tc-delete" title="删除">🗑️</button>' : ''}
          </div>
        </div>
        <div class="tc-preview">${this.escapeHtml(t.prompt)}</div>
        <div class="tc-tags">
          ${(t.tags || []).map(tag => `<span class="tc-tag">${this.escapeHtml(tag)}</span>`).join('')}
        </div>
      `;

      // Apply on click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.tc-delete')) return;
        this.applyTemplate(t, this.activeCategory);
      });

      // Delete handler
      const deleteBtn = card.querySelector('.tc-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteTemplate(t);
        });
      }

      DOM.templateList.appendChild(card);
    });
  },

  applyTemplate(template, category) {
    // Determine current view and apply the prompt to the right field
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;

    const viewId = activeView.id;

    switch (category) {
      case 'image':
      case 'image/prompt':
        if (viewId === 'image-view') {
          DOM.imagePrompt.value = template.prompt;
          DOM.imagePrompt.focus();
          this.close();
          showToast(`✅ 已应用制图模板: ${template.title}`, 'success');
        } else {
          showToast(`请切换到 🎨 制图视图使用此模板`, 'info');
        }
        break;
      case 'video':
      case 'video/prompt':
        if (viewId === 'video-view') {
          DOM.videoPrompt.value = template.prompt;
          DOM.videoPrompt.focus();
          this.close();
          showToast(`✅ 已应用视频模板: ${template.title}`, 'success');
        } else {
          showToast(`请切换到 🎬 视频视图使用此模板`, 'info');
        }
        break;
      case 'storyboard':
        if (viewId === 'storyboard-view') {
          DOM.storyConcept.value = template.prompt;
          DOM.storyConcept.focus();
          this.close();
          showToast(`✅ 已应用故事板模板: ${template.title}`, 'success');
        } else {
          showToast(`请切换到 📖 故事板视图使用此模板`, 'info');
        }
        break;
      case 'custom':
        // Determine by the template's stored category
        this.applyTemplate(template, template.category || 'image');
        break;
      default:
        showToast('请在对应视图中使用此模板', 'info');
    }
  },

  saveCurrentAsTemplate() {
    const name = DOM.saveTemplateName.value.trim();
    const category = DOM.saveTemplateCategory.value;
    const tagsStr = DOM.saveTemplateTags.value.trim();

    if (!name) {
      showToast('请输入模板名称', 'error');
      DOM.saveTemplateName.focus();
      return;
    }

    // Get current prompt from the active view
    const activeView = document.querySelector('.view.active');
    let prompt = '';

    if (activeView) {
      switch (activeView.id) {
        case 'image-view': prompt = DOM.imagePrompt.value.trim(); break;
        case 'video-view': prompt = DOM.videoPrompt.value.trim(); break;
        case 'storyboard-view': prompt = DOM.storyConcept.value.trim(); break;
      }
    }

    if (!prompt) {
      showToast('当前视图的输入框为空，请在输入内容后保存', 'error');
      return;
    }

    const tags = tagsStr ? tagsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];

    const template = {
      id: `user-${  Date.now()}`,
      title: name,
      prompt,
      tags,
      category,
      _isUser: true,
      createdAt: Date.now()
    };

    this.userTemplates.push(template);
    this.saveUserTemplates();

    // Reset save form
    DOM.saveTemplateName.value = '';
    DOM.saveTemplateTags.value = '';

    // Switch to custom tab and refresh
    this.activeCategory = 'custom';
    this.renderTabs();
    this.renderTemplates();

    showToast(`💾 模板「${name}」已保存`, 'success');
    this.close();
  },

  deleteTemplate(template) {
    if (!confirm(`确定删除模板「${template.title}」吗？`)) return;
    this.userTemplates = this.userTemplates.filter(t => t !== template);
    this.saveUserTemplates();
    this.renderTemplates();
    showToast('模板已删除', 'info');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
};

// ============================================
function init() {
  cacheDom();
  loadSettings();
  initNavigation();
  initSettings();
  initKeyboardShortcuts();

  ChatModule.init();
  ImageModule.init();
  VideoModule.init();
  StoryboardModule.init();
  PromptOptimizer.init();
  StoryboardAssistant.init();
  PromptLibrary.init();

  // Focus chat input
  DOM.chatInput.focus();

  console.log('✦ Agnes AI 全能平台已启动');
  console.log('💬 Ctrl+1 对话 | 🎨 Ctrl+2 制图 | 🎬 Ctrl+3 视频 | 📖 Ctrl+4 故事板 | 🏪 Ctrl+5 技能');
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
