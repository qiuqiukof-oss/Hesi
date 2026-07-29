/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Multi-Media Panel — Image Gallery, Video Player, File Preview, AI Image Gen
// Integrates with existing media-preview.js overlay
// Enhanced: progress stages, history management, image comparison view
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage } from './lib/storage.js';
import { escapeHtml } from './escape.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/**
 * Allow only safe image URL schemes before interpolating into `<img src>`.
 * AI-generated / backend content can carry `javascript:` or other hostile
 * schemes; anything not on the allowlist returns '' so the image renders empty
 * instead of executing. Accepts http(s), data:image/*, blob:, and same-origin
 * root-relative paths (but not protocol-relative `//host`).
 * @param {unknown} url
 * @returns {string}
 */
function safeImageUrl(url) {
  const s = String(url == null ? '' : url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  if (/^blob:/i.test(s)) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return '';
}

export const Media = {
  _initialized: false,
  /** @type {Array<{id:string,name:string,path:string,mime:string,size:number,addedAt:number}>} */
  _files: [],
  /** @type {Array<{id:string,url:string,prompt:string,model:string,size:string,createdAt:number,stylePreset?:string,outputFormat?:string,seed?:number}>} */
  _aiImages: [],
  _activeFilter: 'all',
  _activePlayer: null,
  // ── 比较视图 ──
  _compareMode: false,
  _compareSelected: [],
  // ── 历史搜索 ──
  _historyQuery: '',
};

const STORAGE_KEY = 'qcli-media-files';
const AI_IMAGES_KEY = 'qcli-ai-images';
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/bmp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'application/pdf',
];

// ── 生成进度阶段 ──
const GEN_STAGES = [
  { id: 'connecting', label: '连接服务', icon: '🔌' },
  { id: 'generating', label: 'AI 生成中', icon: '🎨' },
  { id: 'processing', label: '处理图片', icon: '🖼️' },
  { id: 'complete', label: '生成完成', icon: '✅' },
];
const GEN_STAGE_IDS = GEN_STAGES.map(s => s.id);

// ============================================================
// Initialization
// ============================================================

function init() {
  if (Media._initialized) return;
  Media._initialized = true;

  // Inject own CSS dynamically (shared utility via Q.injectCSS)
  if (Q.injectCSS) Q.injectCSS('/css/media.css');

  loadFiles();
  loadAIImages();

  console.log('[Media] Initialized');
  console.log('[Media] Open /media.html for standalone page');
}

// ============================================================
// File Persistence
// ============================================================

function loadFiles() {
  const saved = safeStorage.getJSON(STORAGE_KEY);
  if (Array.isArray(saved)) Media._files = saved;
}

function saveFiles() {
  safeStorage.setJSON(STORAGE_KEY, Media._files);
}

function addFile(fileData) {
  Media._files.unshift(fileData);
  saveFiles();
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) renderGallery();
}

function removeFile(id) {
  const removed = Media._files.find(f => f.id === id);
  Media._files = Media._files.filter(f => f.id !== id);
  saveFiles();
  if (removed && Media._activePlayer && !Media._activePlayer.paused) {
    const currentSrc = Media._activePlayer.src;
    const fileName = removed.name;
    if (currentSrc && currentSrc.includes(encodeURIComponent(fileName))) {
      Media._activePlayer.pause();
      Media._activePlayer.src = '';
      Media._activePlayer.classList.add('hidden');
      Media._activePlayer = null;
      const placeholder = document.getElementById('media-player-placeholder');
      if (placeholder) placeholder.classList.remove('hidden');
      const header = document.querySelector('.media-player-header');
      if (header) header.innerHTML = '<span>🎬</span><span>播放器</span>';
    }
  }
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) renderGallery();
}

function clearAllFiles() {
  stopPlayer();
  Media._files = [];
  saveFiles();
  Media._aiImages = [];
  saveAIImages();
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) render();
}

function stopPlayer() {
  if (Media._activePlayer) {
    Media._activePlayer.pause();
    Media._activePlayer.src = '';
    Media._activePlayer.classList.add('hidden');
    Media._activePlayer = null;
  }
  const placeholder = document.getElementById('media-player-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
  const header = document.querySelector('.media-player-header');
  if (header) header.innerHTML = '<span>🎬</span><span>播放器</span>';
}

// ============================================================
// AI Image Persistence
// ============================================================

function loadAIImages() {
  const saved = safeStorage.getJSON(AI_IMAGES_KEY);
  if (Array.isArray(saved)) Media._aiImages = saved;
}

function saveAIImages() {
  safeStorage.setJSON(AI_IMAGES_KEY, Media._aiImages);
}

function addAIImage(imgData) {
  Media._aiImages.unshift({
    id: 'ai-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    ...imgData,
  });
  if (Media._aiImages.length > 200) Media._aiImages = Media._aiImages.slice(0, 200);
  saveAIImages();
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) renderGallery();
}

function removeAIImage(id) {
  // Also remove from compare selection
  Media._compareSelected = Media._compareSelected.filter(i => i !== id);
  Media._aiImages = Media._aiImages.filter(img => img.id !== id);
  saveAIImages();
  const panel = document.getElementById('rp-media');
  if (panel && panel.classList.contains('active')) renderGallery();
}

// ============================================================
// Render
// ============================================================

function render() {
  const panel = document.getElementById('rp-media');
  if (!panel) return;
  panel.innerHTML = buildPanelHTML();
  setupEventListeners(panel);
  renderGallery();
  setupDropZone(panel);
}

function buildPanelHTML() {
  return `
    <div class="media-content" id="media-content">
      <!-- Sub Tabs -->
      <div class="media-source-tabs" id="media-source-tabs">
        <button class="media-source-tab active" data-source="upload">📁 上传</button>
        <button class="media-source-tab" data-source="ai">🎨 AI 生图</button>
      </div>

      <!-- Upload Panel -->
      <div class="media-source-panel active" id="media-source-upload">
        <div class="media-section">
          <div class="media-drop-zone" id="media-drop-zone">
            <div class="media-drop-icon">📁</div>
            <div class="media-drop-text">拖拽文件到此处上传</div>
            <div class="media-drop-hint">或点击选择文件</div>
            <input type="file" id="media-file-input" multiple hidden
              accept="image/*,video/*,application/pdf,.svg" />
          </div>
          <div class="media-upload-progress hidden" id="media-upload-progress">
            <div class="media-upload-progress-bar" id="media-upload-progress-bar"></div>
          </div>
        </div>
        <div class="media-section">
          <div class="media-toolbar">
            <div class="media-filter-tabs" id="media-filter-tabs">
              <button class="media-filter-btn active" data-filter="all">全部</button>
              <button class="media-filter-btn" data-filter="image">图片</button>
              <button class="media-filter-btn" data-filter="video">视频</button>
              <button class="media-filter-btn" data-filter="pdf">文档</button>
            </div>
            <button class="media-action-btn" id="media-upload-btn" title="选择文件上传">📁</button>
            <button class="media-action-btn danger" id="media-clear-btn" title="清除全部">🗑️</button>
            <a href="/media" class="media-standalone-btn" title="新窗口打开" target="_blank">↗</a>
          </div>
        </div>
      </div>

      <!-- AI Generation Panel -->
      <div class="media-source-panel hidden" id="media-source-ai">
        <div class="media-section">
          <div class="ai-gen-form">
            <div class="ai-gen-header">
              <span class="ai-gen-icon">🎨</span>
              <span class="ai-gen-title">AI 图片生成</span>
            </div>
            <div class="ai-gen-input-row">
              <textarea id="ai-gen-prompt" class="ai-gen-prompt" rows="2"
                placeholder="输入图片描述（支持中文）&#10;例如：一只可爱的橘猫坐在编程键盘前，数字艺术风格"></textarea>
              <button id="ai-gen-btn" class="ai-gen-btn">✨ 生成</button>
            </div>
            <details class="collapsible-block" style="margin-bottom:8px;"><summary>⚙️ 高级选项</summary><div class="ai-gen-options">
              <label class="ai-gen-opt">
                <span>模型</span>
                <select id="ai-gen-model">
                  <option value="core">Core（推荐）</option>
                  <option value="ultra">Ultra（高质量）</option>
                  <option value="sd3">SD3（快速）</option>
                </select>
              </label>
              <label class="ai-gen-opt">
                <span>比例</span>
                <select id="ai-gen-ratio">
                  <option value="1:1">1:1 方形</option>
                  <option value="16:9" selected>16:9 横屏</option>
                  <option value="9:16">9:16 竖屏</option>
                  <option value="4:5">4:5 竖版</option>
                  <option value="3:2">3:2 横版</option>
                  <option value="21:9">21:9 宽屏</option>
                </select>
              </label>
              <label class="ai-gen-opt">
                <span>风格</span>
                <select id="ai-gen-style">
                  <option value="none">自动</option>
                  <option value="cinematic">电影感</option>
                  <option value="photographic">摄影</option>
                  <option value="anime">动漫</option>
                  <option value="digital-art">数字艺术</option>
                  <option value="fantasy-art">奇幻</option>
                  <option value="pixel-art">像素</option>
                </select>
              </label>
              <label class="ai-gen-opt">
                <span>格式</span>
                <select id="ai-gen-format">
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            </div>
            </details>
            <!-- ═══ 多阶段进度条 ═══ -->
            <div id="ai-gen-status" class="ai-gen-status hidden">
              <div class="ai-gen-stage-track" id="ai-gen-stage-track">
                ${GEN_STAGES.map((s, i) => `
                  <div class="ai-gen-stage" data-stage="${s.id}">
                    <div class="ai-gen-stage-dot">${s.icon}</div>
                    <div class="ai-gen-stage-label">${s.label}</div>
                    ${i < GEN_STAGES.length - 1 ? '<div class="ai-gen-stage-line"></div>' : ''}
                  </div>
                `).join('')}
              </div>
              <div class="ai-gen-stage-status" id="ai-gen-stage-status"></div>
            </div>
          </div>
        </div>

        <!-- ═══ AI 历史工具栏 ═══ -->
        <div class="media-section">
          <div class="ai-history-toolbar">
            <div class="ai-history-search-wrap">
              <span class="ai-history-search-icon">🔍</span>
              <input type="text" id="ai-history-search" class="ai-history-search"
                placeholder="搜索提示词..." value="${escapeHtml(Media._historyQuery)}" />
            </div>
            <button class="media-action-btn" id="ai-history-export-btn" title="导出历史">📥</button>
            <button class="media-action-btn" id="ai-compare-btn" title="图片对比">🔍</button>
            <button class="media-action-btn" id="ai-refresh-btn" title="刷新">⟳</button>
          </div>
        </div>
      </div>

      <!-- Gallery -->
      <div class="media-section" style="flex:1;min-height:0;">
        <div id="ai-gen-result" class="ai-gen-result hidden"></div>
        <div class="media-gallery" id="media-gallery"></div>
        <div class="media-empty" id="media-empty">
          <div class="media-empty-icon">🎬</div>
          <div class="media-empty-text" id="media-empty-text">暂无媒体文件</div>
          <div class="media-empty-hint">拖拽或点击上传图片、视频、PDF 文件，或在「AI 生图」标签页生成</div>
        </div>
      </div>

      <!-- ═══ 比较面板（浮动）═══ -->
      <div class="ai-compare-bar hidden" id="ai-compare-bar">
        <span class="ai-compare-count" id="ai-compare-count">已选 0 张</span>
        <button class="ai-compare-btn" id="ai-compare-do-btn" disabled>🔄 对比</button>
        <button class="ai-compare-btn secondary" id="ai-compare-cancel-btn">✕ 取消</button>
      </div>

      <!-- Video Player -->
      <div class="media-section">
        <div class="media-section-title">视频播放器</div>
        <div class="media-player-section">
          <div class="media-player-header">
            <span>🎬</span>
            <span>播放器</span>
          </div>
          <div class="media-player-area" id="media-player-area">
            <div class="media-player-placeholder" id="media-player-placeholder">
              <div class="media-player-placeholder-icon">▶</div>
              <span>选择一个视频播放</span>
            </div>
            <video id="media-player" class="hidden" controls playsinline preload="metadata"></video>
          </div>
        </div>
      </div>

      <!-- Info Bar -->
      <div class="media-info-bar" id="media-info-bar">
        <span id="media-file-count">0 个文件</span>
        <span id="media-total-size">0 B</span>
        <div style="flex:1"></div>
        <button class="media-ai-toggle" id="media-ai-toggle">🤖 AI</button>
      </div>

      <!-- AI Panel -->
      <div class="media-ai-panel hidden" id="media-ai-panel">
        <div class="media-ai-response" id="media-ai-response">AI 分析媒体文件，输入问题开始。</div>
        <div class="media-ai-input-row">
          <input type="text" id="media-ai-input" placeholder="例如：总共有多少图片？" />
          <button id="media-ai-send">发送</button>
        </div>
      </div>
    </div>

    <!-- ═══ 比较叠加层（body 子级）═══ -->
    <div class="ai-compare-overlay hidden" id="ai-compare-overlay">
      <div class="ai-compare-overlay-bg"></div>
      <div class="ai-compare-overlay-content">
        <div class="ai-compare-overlay-header">
          <span class="ai-compare-overlay-title">🔄 图片对比</span>
          <button class="ai-compare-overlay-close" id="ai-compare-overlay-close">✕</button>
        </div>
        <div class="ai-compare-overlay-body" id="ai-compare-overlay-body">
          <div class="ai-compare-pane" id="ai-compare-pane-a">
            <div class="ai-compare-pane-placeholder">选择第一张图片</div>
          </div>
          <div class="ai-compare-divider">VS</div>
          <div class="ai-compare-pane" id="ai-compare-pane-b">
            <div class="ai-compare-pane-placeholder">选择第二张图片</div>
          </div>
        </div>
        <div class="ai-compare-overlay-footer" id="ai-compare-overlay-footer">
          <span class="ai-compare-info" id="ai-compare-info">选择两张图片进行对比</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// Gallery Rendering
// ============================================================

function renderGallery() {
  const gallery = document.getElementById('media-gallery');
  const empty = document.getElementById('media-empty');
  const emptyText = document.getElementById('media-empty-text');
  const fileCount = document.getElementById('media-file-count');
  const totalSize = document.getElementById('media-total-size');
  const sourceTabs = document.getElementById('media-source-tabs');
  const activeSource = sourceTabs?.querySelector('.media-source-tab.active')?.dataset?.source || 'upload';
  if (!gallery) return;

  if (activeSource === 'ai') {
    renderAIGallery(gallery, empty, emptyText, fileCount, totalSize);
    return;
  }

  let files = Media._files;
  if (Media._activeFilter !== 'all') {
    files = files.filter(f => {
      const mime = (f.mime || '').toLowerCase();
      if (Media._activeFilter === 'image') return mime.startsWith('image/');
      if (Media._activeFilter === 'video') return mime.startsWith('video/');
      if (Media._activeFilter === 'pdf') return mime === 'application/pdf';
      return true;
    });
  }

  gallery.style.display = '';
  if (files.length === 0) {
    gallery.innerHTML = '';
    if (emptyText) emptyText.textContent = '暂无媒体文件';
    if (empty) empty.style.display = '';
  } else {
    if (empty) empty.style.display = 'none';
    gallery.innerHTML = files.map(f => buildGalleryItem(f)).join('');
  }

  if (fileCount) {
    const total = Media._files.length;
    const filtered = files.length;
    fileCount.textContent = total > 0 && total !== filtered
      ? filtered + ' / ' + total + ' 个文件' : total + ' 个文件';
  }
  if (totalSize) {
    const totalBytes = Media._files.reduce((sum, f) => sum + (f.size || 0), 0);
    totalSize.textContent = formatFileSize(totalBytes);
  }
}

/** AI 图库渲染（支持日期分组 + 搜索） */
function renderAIGallery(gallery, empty, emptyText, fileCount, totalSize) {
  let images = Media._aiImages;
  const query = (Media._historyQuery || '').trim().toLowerCase();

  // 搜索过滤
  if (query) {
    images = images.filter(img => (img.prompt || '').toLowerCase().includes(query));
  }

  if (images.length === 0) {
    gallery.innerHTML = '';
    gallery.style.display = '';
    if (emptyText) emptyText.textContent = query ? `未找到匹配「${escapeHtml(query)}」的图片` : '暂无 AI 生成图片';
    if (empty) empty.style.display = '';
  } else {
    if (empty) empty.style.display = 'none';
    gallery.style.display = 'block';
    const groups = groupImagesByDate(images);
    gallery.innerHTML = renderDateGroupedAIGallery(groups);
  }

  if (fileCount) fileCount.textContent = images.length + ' 张 AI 图片';
  if (totalSize) totalSize.textContent = '';

  // 更新比较栏状态
  updateCompareBar();
}

/** 按日期分组 */
function groupImagesByDate(images) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - now.getDay());
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const groups = { today: [], yesterday: [], thisWeek: [], earlier: [] };

  for (const img of images) {
    const d = new Date(img.createdAt || 0);
    if (d >= today) groups.today.push(img);
    else if (d >= yesterday) groups.yesterday.push(img);
    else if (d >= thisWeek) groups.thisWeek.push(img);
    else groups.earlier.push(img);
  }

  return [
    { key: 'today', label: '今天', items: groups.today },
    { key: 'yesterday', label: '昨天', items: groups.yesterday },
    { key: 'thisWeek', label: '本周', items: groups.thisWeek },
    { key: 'earlier', label: '更早', items: groups.earlier },
  ].filter(g => g.items.length > 0);
}

/** 渲染按日期分组的 AI 图库 */
function renderDateGroupedAIGallery(groups) {
  const compareMode = Media._compareMode;
  return groups.map(group => `
    <div class="ai-history-group">
      <div class="ai-history-group-header">
        <span class="ai-history-group-label">${group.label}</span>
        <span class="ai-history-group-count">${group.items.length} 张</span>
      </div>
      <div class="media-gallery-grid">
        ${group.items.map(img => buildAIImageItem(img, compareMode)).join('')}
      </div>
    </div>
  `).join('');
}

function buildGalleryItem(file) {
  const mime = (file.mime || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf';

  const thumbContent = isImage
    ? `<img src="/api/uploads/${encodeURIComponent(file.name)}?mime=${encodeURIComponent(mime)}" alt="${escapeHtml(file.name)}" loading="lazy" />`
    : isVideo ? `<span class="media-thumb-icon">🎬</span>`
      : isPdf ? `<span class="media-thumb-icon">📄</span>`
        : `<span class="media-thumb-icon">📁</span>`;

  return `
    <div class="media-item" data-file-id="${file.id}" data-mime="${mime}">
      <div class="media-thumb">
        ${thumbContent}
        <div class="media-thumb-overlay"><span>${isVideo ? '▶ 播放' : isImage ? '🔍 预览' : '📁 打开'}</span></div>
      </div>
      <button class="media-delete-btn" data-action="delete" title="删除">✕</button>
      <div class="media-info-row">
        <span class="media-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="media-file-meta">${formatFileSize(file.size)} · ${getFileTypeLabel(mime)}</span>
      </div>
    </div>
  `;
}

/** AI 图片卡片（含比较复选框 + 快速操作） */
function buildAIImageItem(img, compareMode) {
  const date = new Date(img.createdAt || Date.now());
  const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const promptShort = img.prompt ? img.prompt.slice(0, 60) + (img.prompt.length > 60 ? '...' : '') : '';
  const isSelected = Media._compareSelected.includes(img.id);

  // 比较复选框
  const checkboxHtml = compareMode
    ? `<label class="ai-compare-checkbox ${isSelected ? 'checked' : ''}" data-ai-id="${img.id}">
        <input type="checkbox" ${isSelected ? 'checked' : ''} />
        <span class="ai-compare-checkmark">${isSelected ? '✓' : ''}</span>
      </label>`
    : '';

  // 快速操作按钮
  const actionBtns = !compareMode
    ? `<div class="ai-img-actions">
        <button class="ai-img-action" data-action="regenerate" title="同提示词重新生成">🔄</button>
        <button class="ai-img-action" data-action="download" title="下载">⬇</button>
        <button class="ai-img-action" data-action="copy-prompt" title="复制提示词">📋</button>
      </div>`
    : '';

  return `
    <div class="media-item ai-image-item ${isSelected ? 'ai-selected' : ''}" data-ai-id="${img.id}">
      ${checkboxHtml}
      <div class="media-thumb">
        <img src="${escapeHtml(safeImageUrl(img.url))}" alt="${escapeHtml(img.prompt || 'AI generated')}" loading="lazy" />
        <div class="media-thumb-overlay"><span>🔍 预览</span></div>
      </div>
      ${actionBtns}
      <button class="media-delete-btn" data-action="delete-ai" title="删除">✕</button>
      <div class="media-info-row">
        <span class="media-file-name" title="${escapeHtml(img.prompt || '')}">${escapeHtml(promptShort || '(无提示词)')}</span>
        <span class="media-file-meta">${img.model || 'core'} · ${dateStr}</span>
      </div>
    </div>
  `;
}

// ============================================================
// ═══ 生成进度管理 ═══
// ============================================================

function updateGenerationStage(stageId, statusText) {
  const stageTrack = document.getElementById('ai-gen-stage-track');
  if (!stageTrack) return;
  const idx = GEN_STAGE_IDS.indexOf(stageId);
  if (idx === -1) return;

  stageTrack.querySelectorAll('.ai-gen-stage').forEach((el, i) => {
    el.classList.toggle('active', i <= idx);
    el.classList.toggle('done', i < idx);
    el.classList.toggle('current', i === idx);
  });

  const statusEl = document.getElementById('ai-gen-stage-status');
  if (statusEl && statusText) statusEl.textContent = statusText;
}

function showProgressUI() {
  const statusEl = document.getElementById('ai-gen-status');
  const btn = document.getElementById('ai-gen-btn');
  if (statusEl) statusEl.classList.remove('hidden');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }
  updateGenerationStage('connecting', '正在连接 Stability AI 服务...');
}

function hideProgressUI() {
  const statusEl = document.getElementById('ai-gen-status');
  const btn = document.getElementById('ai-gen-btn');
  if (statusEl) statusEl.classList.add('hidden');
  if (btn) { btn.disabled = false; btn.textContent = '✨ 生成'; }
}

// ============================================================
// ═══ AI Image Generation（增强版）═══
// ============================================================

async function generateImage() {
  const promptEl = document.getElementById('ai-gen-prompt');
  const resultEl = document.getElementById('ai-gen-result');

  const prompt = promptEl?.value?.trim();
  if (!prompt) {
    Q.showToast?.('请输入图片描述', 'error');
    promptEl?.focus();
    return;
  }

  const model = document.getElementById('ai-gen-model')?.value || 'core';
  const aspectRatio = document.getElementById('ai-gen-ratio')?.value || '16:9';
  const stylePreset = document.getElementById('ai-gen-style')?.value || 'none';
  const outputFormat = document.getElementById('ai-gen-format')?.value || 'png';

  showProgressUI();
  if (resultEl) resultEl.classList.add('hidden');

  try {
    updateGenerationStage('connecting', '正在连接...');
    // 模拟延迟让用户看到阶段过渡
    await sleep(400);

    updateGenerationStage('generating', 'AI 正在根据描述创作图片...');
    await sleep(200);

    const resp = await fetch('/api/chat/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `Generate an image with these parameters:\n- prompt: ${prompt}\n- model: ${model}\n- aspectRatio: ${aspectRatio}\n- stylePreset: ${stylePreset}\n- outputFormat: ${outputFormat}\n\nUse the generate_image tool to create this image.`,
        }],
        disableTools: false,
      }),
    });

    updateGenerationStage('processing', '正在处理返回的图片数据...');
    await sleep(300);

    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Generation failed');

    const content = data.content || '';
    const urlMatch = content.match(/!\[.*?\]\(([^)]+)\)/);
    const markdownUrl = urlMatch ? urlMatch[1] : null;

    if (markdownUrl) {
      addAIImage({ url: markdownUrl, prompt, model, size: aspectRatio, stylePreset, outputFormat });
      updateGenerationStage('complete', '✅ 生成完成！');

      if (resultEl) {
        resultEl.innerHTML = `
          <div class="ai-gen-success">
            <img src="${escapeHtml(safeImageUrl(markdownUrl))}" alt="${escapeHtml(prompt)}" class="ai-gen-preview-img" />
            <div class="ai-gen-meta">
              <strong>✅ 生成成功</strong>
              <span>${escapeHtml(prompt)}</span>
              <small>${model} · ${aspectRatio} · ${outputFormat}</small>
            </div>
          </div>`;
        resultEl.classList.remove('hidden');
        setTimeout(() => resultEl.classList.add('hidden'), 8000);
      }
      Q.showToast?.('🎨 图片生成成功！', 'success');
    } else {
      const anyUrl = content.match(/https?:\/\/[^\s]+\.(png|jpg|jpeg|webp)/i);
      if (anyUrl) {
        addAIImage({ url: anyUrl[0], prompt, model, size: aspectRatio, stylePreset, outputFormat });
        updateGenerationStage('complete', '✅ 已保存！');
        Q.showToast?.('🎨 图片已保存', 'success');
      } else {
        updateGenerationStage('generating', '⚠️ 未检测到图片 URL，显示原始回复');
        if (resultEl) {
          resultEl.innerHTML = `<pre class="ai-gen-raw">${escapeHtml(content.slice(0, 500))}</pre>`;
          resultEl.classList.remove('hidden');
        }
      }
    }
  } catch (err) {
    console.error('[Media] AI generation error:', err);
    updateGenerationStage('generating', `❌ ${err.message}`);
    if (resultEl) {
      resultEl.innerHTML = `<div class="ai-gen-error">❌ ${escapeHtml(err.message)}</div>`;
      resultEl.classList.remove('hidden');
    }
    Q.showToast?.('生成失败: ' + err.message, 'error');
  } finally {
    setTimeout(hideProgressUI, 1200);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// ═══ 历史管理 ═══
// ============================================================

function exportHistoryAsMarkdown() {
  const images = Media._aiImages;
  if (images.length === 0) {
    Q.showToast?.('没有可导出的 AI 图片', 'error');
    return;
  }

  let md = `# AI 图片生成历史\n\n`;
  md += `导出时间: ${new Date().toLocaleString()}\n`;
  md += `总计: ${images.length} 张图片\n\n---\n\n`;

  const groups = groupImagesByDate(images);
  for (const group of groups) {
    md += `## ${group.label}\n\n`;
    for (const img of group.items) {
      md += `### ${img.prompt || '(无提示词)'}\n\n`;
      md += `![${img.prompt || ''}](${img.url})\n\n`;
      md += `- **模型**: ${img.model || 'core'}\n`;
      md += `- **比例**: ${img.size || '1:1'}\n`;
      md += `- **时间**: ${new Date(img.createdAt || 0).toLocaleString()}\n\n`;
      md += `---\n\n`;
    }
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-image-history-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  Q.showToast?.('📥 历史已导出为 Markdown', 'success');
}

function regenerateImage(imgId) {
  const img = Media._aiImages.find(i => i.id === imgId);
  if (!img || !img.prompt) {
    Q.showToast?.('无法获取提示词', 'error');
    return;
  }
  // 填充表单并触发生成
  const promptEl = document.getElementById('ai-gen-prompt');
  const modelEl = document.getElementById('ai-gen-model');
  if (promptEl) promptEl.value = img.prompt;
  if (modelEl && img.model) modelEl.value = img.model;
  // 切换到 AI 标签页
  const sourceTabs = document.getElementById('media-source-tabs');
  const aiTab = sourceTabs?.querySelector('[data-source="ai"]');
  if (aiTab) aiTab.click();
  // 聚焦输入框
  if (promptEl) { promptEl.focus(); promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length); }
  Q.showToast?.('🔄 已填入提示词，点击「生成」重新生成', 'info');
}

function downloadImage(imgId) {
  const img = Media._aiImages.find(i => i.id === imgId);
  if (!img) return;
  const a = document.createElement('a');
  a.href = img.url;
  a.download = `ai-image-${imgId.slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyPrompt(imgId) {
  const img = Media._aiImages.find(i => i.id === imgId);
  if (!img || !img.prompt) {
    Q.showToast?.('无提示词可复制', 'error');
    return;
  }
  navigator.clipboard.writeText(img.prompt).then(() => {
    Q.showToast?.('📋 提示词已复制', 'success');
  }).catch(() => {
    Q.showToast?.('复制失败', 'error');
  });
}

// ============================================================
// ═══ 图片对比视图 ═══
// ============================================================

function toggleCompareMode() {
  Media._compareMode = !Media._compareMode;
  if (!Media._compareMode) {
    Media._compareSelected = [];
  }
  renderGallery();
  updateCompareBar();
}

function toggleCompareSelection(imgId) {
  const idx = Media._compareSelected.indexOf(imgId);
  if (idx !== -1) {
    Media._compareSelected.splice(idx, 1);
  } else if (Media._compareSelected.length < 2) {
    Media._compareSelected.push(imgId);
  } else {
    Q.showToast?.('最多选择 2 张图片进行对比', 'info');
    return;
  }
  renderGallery();
  updateCompareBar();
}

function updateCompareBar() {
  const bar = document.getElementById('ai-compare-bar');
  const count = document.getElementById('ai-compare-count');
  const doBtn = document.getElementById('ai-compare-do-btn');
  if (!bar) return;

  const selected = Media._compareSelected.length;
  if (selected > 0) {
    bar.classList.remove('hidden');
    if (count) count.textContent = `已选 ${selected}/2 张`;
    if (doBtn) doBtn.disabled = selected < 2;
  } else if (!Media._compareMode) {
    bar.classList.add('hidden');
  }
}

function openCompareView() {
  const ids = Media._compareSelected;
  if (ids.length < 2) {
    Q.showToast?.('请选择两张图片进行对比', 'info');
    return;
  }
  const imgs = ids.map(id => Media._aiImages.find(i => i.id === id)).filter(Boolean);
  if (imgs.length < 2) {
    Q.showToast?.('图片未找到', 'error');
    return;
  }

  const overlay = document.getElementById('ai-compare-overlay');
  if (!overlay) return;

  // 填充左右面板
  const paneA = document.getElementById('ai-compare-pane-a');
  const paneB = document.getElementById('ai-compare-pane-b');

  if (paneA) paneA.innerHTML = buildComparePaneHTML(imgs[0], 0);
  if (paneB) paneB.innerHTML = buildComparePaneHTML(imgs[1], 1);

  // 填充底部信息
  const info = document.getElementById('ai-compare-info');
  if (info) {
    info.innerHTML = buildCompareInfo(imgs[0], imgs[1]);
  }

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function buildComparePaneHTML(img, index) {
  const labels = ['A', 'B'];
  return `
    <div class="ai-compare-pane-inner">
      <div class="ai-compare-pane-badge">${labels[index]}</div>
      <img src="${escapeHtml(safeImageUrl(img.url))}" alt="${escapeHtml(img.prompt || '')}" class="ai-compare-pane-img" />
      <div class="ai-compare-pane-details">
        <div class="ai-compare-pane-prompt" title="${escapeHtml(img.prompt || '')}">${escapeHtml(img.prompt?.slice(0, 80) || '(无提示词)')}</div>
        <div class="ai-compare-pane-meta">
          <span>🎨 ${img.model || 'core'}</span>
          <span>📐 ${img.size || '1:1'}</span>
          <span>🕐 ${new Date(img.createdAt || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  `;
}

function buildCompareInfo(imgA, imgB) {
  const fields = [
    { label: '模型', a: imgA.model || 'core', b: imgB.model || 'core' },
    { label: '比例', a: imgA.size || '1:1', b: imgB.size || '1:1' },
    { label: '格式', a: imgA.outputFormat || 'png', b: imgB.outputFormat || 'png' },
    { label: '时间差', a: '', b: '' },
  ];

  // 时间差
  const diffMs = Math.abs((imgB.createdAt || 0) - (imgA.createdAt || 0));
  const diffStr = diffMs < 60000 ? `${Math.round(diffMs / 1000)} 秒`
    : diffMs < 3600000 ? `${Math.round(diffMs / 60000)} 分钟`
      : `${(diffMs / 3600000).toFixed(1)} 小时`;
  if (imgA.createdAt && imgB.createdAt) {
    fields[3].b = diffStr;
  }

  // 提示词差异
  const promptA = (imgA.prompt || '').trim();
  const promptB = (imgB.prompt || '').trim();
  const samePrompt = promptA.toLowerCase() === promptB.toLowerCase();

  let html = '<table class="ai-compare-info-table">';
  html += '<tr><th>属性</th><th>图片 A</th><th>图片 B</th></tr>';
  for (const f of fields) {
    if (f.label === '时间差') {
      if (f.b) {
        html += `<tr><td>${f.label}</td><td>—</td><td>${f.b}</td></tr>`;
      }
      continue;
    }
    const same = f.a === f.b;
    html += `<tr>
      <td>${f.label}</td>
      <td class="${same ? '' : 'ai-diff'}">${f.a}</td>
      <td class="${same ? '' : 'ai-diff'}">${f.b}</td>
    </tr>`;
  }
  html += '</table>';

  // 提示词差异
  html += `<div class="ai-compare-prompt-compare">
    <span class="ai-compare-prompt-label">提示词</span>
    <span class="${samePrompt ? '' : 'ai-diff'}">${samePrompt ? '✅ 相同' : '🔄 不同'}</span>
  </div>`;
  if (!samePrompt) {
    html += `<div class="ai-compare-prompt-text"><small>A:</small> ${escapeHtml(promptA.slice(0, 100))}</div>`;
    html += `<div class="ai-compare-prompt-text"><small>B:</small> ${escapeHtml(promptB.slice(0, 100))}</div>`;
  }

  return html + `<div class="ai-compare-actions">
    <button class="ai-compare-swap-btn" id="ai-compare-swap-btn">🔄 交换左右</button>
  </div>`;
}

function closeCompareView() {
  const overlay = document.getElementById('ai-compare-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function swapComparePanes() {
  const paneA = document.getElementById('ai-compare-pane-a');
  const paneB = document.getElementById('ai-compare-pane-b');
  if (!paneA || !paneB) return;
  const temp = paneA.innerHTML;
  paneA.innerHTML = paneB.innerHTML;
  paneB.innerHTML = temp;
  // 也交换对比信息中的 A/B 数据
  const info = document.getElementById('ai-compare-info');
  if (info && Media._compareSelected.length >= 2) {
    const reversed = [...Media._compareSelected].reverse();
    const imgs = reversed.map(id => Media._aiImages.find(i => i.id === id)).filter(Boolean);
    if (imgs.length >= 2) {
      info.innerHTML = buildCompareInfo(imgs[0], imgs[1]);
    }
  }
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners(panel) {
  // Source tabs
  const sourceTabs = panel.querySelector('#media-source-tabs');
  if (sourceTabs) {
    sourceTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.media-source-tab');
      if (!btn || !btn.dataset.source) return;
      sourceTabs.querySelectorAll('.media-source-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.media-source-panel').forEach(p => p.classList.remove('active'));
      const targetPanel = document.getElementById('media-source-' + btn.dataset.source);
      if (targetPanel) targetPanel.classList.add('active');
      renderGallery();
    });
  }

  // Filter tabs
  const filterTabs = panel.querySelector('#media-filter-tabs');
  if (filterTabs) {
    filterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.media-filter-btn');
      if (btn && btn.dataset.filter) {
        filterTabs.querySelectorAll('.media-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Media._activeFilter = btn.dataset.filter;
        renderGallery();
      }
    });
  }

  // Upload
  const uploadBtn = panel.querySelector('#media-upload-btn');
  const fileInput = panel.querySelector('#media-file-input');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(e.target.files);
        e.target.value = '';
      }
    });
  }

  // Clear
  const clearBtn = panel.querySelector('#media-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearAllFiles);

  // AI Generate
  const aiGenBtn = panel.querySelector('#ai-gen-btn');
  if (aiGenBtn) aiGenBtn.addEventListener('click', generateImage);

  // AI prompt Enter
  const aiPrompt = panel.querySelector('#ai-gen-prompt');
  if (aiPrompt) {
    aiPrompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateImage(); }
    });
  }

  // ═══ 历史搜索 ═══
  const historySearch = panel.querySelector('#ai-history-search');
  if (historySearch) {
    historySearch.addEventListener('input', (e) => {
      Media._historyQuery = e.target.value;
      renderGallery();
    });
  }

  // ═══ 历史导出 ═══
  const exportBtn = panel.querySelector('#ai-history-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportHistoryAsMarkdown);

  // ═══ 比较模式切换 ═══
  const compareBtn = panel.querySelector('#ai-compare-btn');
  if (compareBtn) compareBtn.addEventListener('click', toggleCompareMode);

  // ═══ 刷新按钮 ═══
  const refreshBtn = panel.querySelector('#ai-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      renderGallery();
      Q.showToast?.('已刷新', 'success');
    });
  }

  // ═══ Gallery 事件委派 ═══
  const gallery = panel.querySelector('#media-gallery');
  if (gallery) {
    gallery.addEventListener('click', (e) => {
      // 比较复选框点击
      const checkbox = e.target.closest('.ai-compare-checkbox');
      if (checkbox && checkbox.dataset.aiId) {
        toggleCompareSelection(checkbox.dataset.aiId);
        return;
      }

      // 删除 - uploaded
      const delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        const item = delBtn.closest('.media-item');
        if (item && item.dataset.fileId) removeFile(item.dataset.fileId);
        return;
      }

      // 删除 - AI
      const delAiBtn = e.target.closest('[data-action="delete-ai"]');
      if (delAiBtn) {
        const item = delAiBtn.closest('.media-item');
        if (item && item.dataset.aiId) removeAIImage(item.dataset.aiId);
        return;
      }

      // AI 图片操作按钮
      const actionBtn = e.target.closest('.ai-img-action');
      if (actionBtn && actionBtn.dataset.action) {
        const item = actionBtn.closest('.media-item');
        const id = item?.dataset.aiId;
        if (!id) return;
        const action = actionBtn.dataset.action;
        if (action === 'regenerate') regenerateImage(id);
        else if (action === 'download') downloadImage(id);
        else if (action === 'copy-prompt') copyPrompt(id);
        return;
      }

      // 点击图片 → 预览
      const item = e.target.closest('.media-item');
      if (!item) return;

      // AI image
      if (item.dataset.aiId) {
        const img = Media._aiImages.find(f => f.id === item.dataset.aiId);
        if (img) {
          if (Q.Upload?.openMediaPreview) {
            Q.Upload.openMediaPreview([{ name: img.prompt?.slice(0, 40) || 'AI Generated', path: img.url, mime: 'image/png', size: 0 }], 0);
          } else {
            window.open(img.url, '_blank');
          }
        }
        return;
      }

      // Uploaded file
      if (item.dataset.fileId) {
        const file = Media._files.find(f => f.id === item.dataset.fileId);
        if (file) {
          const mime = (file.mime || '').toLowerCase();
          if (mime.startsWith('video/')) playVideo(file);
          else if (mime.startsWith('image/') || mime === 'application/pdf') openPreview(file);
        }
      }
    });
  }

  // ═══ 比较操作栏 ═══
  const compareDoBtn = panel.querySelector('#ai-compare-do-btn');
  if (compareDoBtn) compareDoBtn.addEventListener('click', openCompareView);

  const compareCancelBtn = panel.querySelector('#ai-compare-cancel-btn');
  if (compareCancelBtn) {
    compareCancelBtn.addEventListener('click', () => {
      Media._compareMode = false;
      Media._compareSelected = [];
      renderGallery();
      updateCompareBar();
    });
  }

  // ═══ 比较叠加层 ═══
  // 全局事件（因为 overlay 渲染在 body 级）
  if (!document._aiCompareEventsWired) {
    document._aiCompareEventsWired = true;
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('#ai-compare-overlay-close');
      if (closeBtn) { closeCompareView(); return; }
      const bg = e.target.closest('.ai-compare-overlay-bg');
      if (bg) { closeCompareView(); return; }
      const swapBtn = e.target.closest('#ai-compare-swap-btn');
      if (swapBtn) { swapComparePanes(); return; }
    });
    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('ai-compare-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          closeCompareView();
        }
      }
    });
  }

  // ── AI event wiring ──
  const aiToggle = panel.querySelector('#media-ai-toggle');
  const aiPanel = panel.querySelector('#media-ai-panel');
  const aiInput = panel.querySelector('#media-ai-input');
  const aiSend = panel.querySelector('#media-ai-send');
  const aiResponse = panel.querySelector('#media-ai-response');

  if (aiToggle && aiPanel) {
    aiToggle.addEventListener('click', () => {
      aiPanel.classList.toggle('hidden');
      aiToggle.textContent = aiPanel.classList.contains('hidden') ? '🤖 AI' : '✕ 关闭';
    });
  }

  if (aiSend && aiInput && aiResponse) {
    const doMediaAIChat = () => {
      const text = aiInput.value.trim();
      if (!text) return;
      aiInput.value = '';
      const fileCount = Media._files.length;
      const imgCount = Media._files.filter(f => f.mime.startsWith('image/')).length;
      const vidCount = Media._files.filter(f => f.mime.startsWith('video/')).length;
      const pdfCount = Media._files.filter(f => f.mime === 'application/pdf').length;
      const aiImgCount = Media._aiImages.length;

      aiResponse.textContent = '正在思考...';
      if (window.QCLI?.ChatAPI?.sendMessage) {
        window.QCLI.ChatAPI.sendMessage({
          messages: [
            { role: 'system', content: '你是一个媒体文件管理助手。用中文简洁回答关于媒体文件的问题。' },
            { role: 'user', content: `我有 ${fileCount} 个上传的媒体文件（${imgCount} 图片，${vidCount} 视频，${pdfCount} PDF），以及 ${aiImgCount} 张 AI 生成的图片。\n\n${text}` },
          ],
          onToken: (token) => { if (aiResponse) aiResponse.textContent += token; },
          onError: (err) => { if (aiResponse) aiResponse.textContent = 'AI 出错: ' + err.message; },
        });
        if (aiResponse) aiResponse.textContent = '';
      } else {
        aiResponse.textContent = '请先在设置页配置 AI API Key';
      }
    };
    aiSend.addEventListener('click', doMediaAIChat);
    aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doMediaAIChat(); });
  }
}

// ============================================================
// Drag & Drop
// ============================================================

function setupDropZone(panel) {
  const dropZone = panel.querySelector('#media-drop-zone');
  const fileInput = panel.querySelector('#media-file-input');
  if (!dropZone) return;
  dropZone.addEventListener('click', () => { if (fileInput) fileInput.click(); });
  let dragCounter = 0;
  dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter++; dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dragCounter--; if (dragCounter === 0) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); dragCounter = 0; dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  });
}

// ============================================================
// Upload
// ============================================================

async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;
  const validFiles = files.filter(f => {
    const valid = ALLOWED_TYPES.includes(f.type) || f.type.startsWith('image/') || f.type.startsWith('video/');
    if (!valid) Q.showToast?.('不支持的文件类型: ' + f.name, 'error');
    return valid;
  });
  if (validFiles.length === 0) return;

  const progressBar = document.getElementById('media-upload-progress');
  const progressFill = document.getElementById('media-upload-progress-bar');
  if (progressBar) progressBar.classList.remove('hidden');

  const formData = new FormData();
  validFiles.forEach(f => formData.append('files', f));

  try {
    const xhr = new XMLHttpRequest();
    const result = await new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && progressFill) progressFill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Invalid response')); } }
        else { reject(new Error('Upload failed: ' + xhr.status)); }
      });
      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.open('POST', '/api/upload');
      xhr.send(formData);
    });

    if (result && result.success && result.files) {
      result.files.forEach(f => {
        addFile({ id: generateId(), name: f.name, path: f.path, mime: f.mime || detectMimeType(f.name), size: f.size || 0, addedAt: Date.now() });
      });
      Q.showToast?.('成功上传 ' + result.files.length + ' 个文件', 'success');
    }
  } catch (err) {
    console.error('[Media] Upload error:', err);
    Q.showToast?.('上传失败: ' + err.message, 'error');
  } finally {
    if (progressBar) progressBar.classList.add('hidden');
    if (progressFill) progressFill.style.width = '0%';
  }
}

// ============================================================
// Preview & Playback
// ============================================================

function openPreview(file) {
  if (Q.Upload?.openMediaPreview) {
    Q.Upload.openMediaPreview([{ name: file.name, path: file.path || file.name, mime: file.mime || '', size: file.size || 0 }], 0);
  }
}

function playVideo(file) {
  const player = document.getElementById('media-player');
  const placeholder = document.getElementById('media-player-placeholder');
  if (!player) return;
  player.pause();
  player.currentTime = 0;
  player.src = '/api/uploads/' + encodeURIComponent(file.name) + '?mime=' + encodeURIComponent(file.mime || '');
  player.load();
  if (placeholder) placeholder.classList.add('hidden');
  player.classList.remove('hidden');
  player.play().catch(e => console.warn('[Media] Autoplay prevented:', e.message));
  const header = document.querySelector('.media-player-header');
  if (header) header.innerHTML = '<span>🎬</span><span>' + escapeHtml(file.name) + '</span>';
  Media._activePlayer = player;
}

// ============================================================
// Helpers
// ============================================================

let _idCounter = Date.now();
function generateId() { return 'media-' + (++_idCounter); }

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function getFileTypeLabel(mime) {
  if (!mime) return '未知';
  if (mime.startsWith('image/')) return '图片';
  if (mime.startsWith('video/')) return '视频';
  if (mime === 'application/pdf') return 'PDF';
  return '文件';
}

function detectMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = { 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml', 'mp4': 'video/mp4', 'webm': 'video/webm', 'ogg': 'video/ogg', 'mov': 'video/quicktime', 'pdf': 'application/pdf' };
  return map[ext] || 'application/octet-stream';
}

// ============================================================
// Cleanup
// ============================================================

function cleanup() { stopPlayer(); }
window.addEventListener('beforeunload', cleanup);

// ============================================================
// Exports
// ============================================================
Q.Media = Media;
Media.init = init;
Media.render = render;
Media.addFile = addFile;
Media.removeFile = removeFile;
Media.cleanup = cleanup;

// ── Auto-init removed — standalone page (/media.html) calls init()+render() explicitly
console.log('[Media] Module loaded (waiting for standalone page to call init())');
