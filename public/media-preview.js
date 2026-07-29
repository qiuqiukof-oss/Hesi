/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Media Preview Overlay
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const mediaState = {
  files: [],
  currentIndex: 0,
  open: false,
};

const mediaPreview = document.getElementById('media-preview');
const mediaContent = document.getElementById('media-preview-content');
const mediaName = document.getElementById('media-preview-name');
const mediaMeta = document.getElementById('media-preview-meta');
const mediaCounter = document.getElementById('media-preview-counter');
const mediaCloseBtn = document.getElementById('media-close-btn');
const mediaPrevBtn = document.getElementById('media-prev-btn');
const mediaNextBtn = document.getElementById('media-next-btn');
const mediaDownloadBtn = document.getElementById('media-download-btn');

// Minimal path.basename helper
function pathBasename(p) {
  const sep = p.includes('\\\\') ? '\\\\' : '/';
  return p.split(sep).pop() || '';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Open media preview with the given file list, starting at index.
 * @param {Array<{name:string,path:string,mime:string,size:number}>} files
 * @param {number} index
 */
function openMediaPreview(files, index) {
  if (index === undefined) index = 0;
  if (!files || files.length === 0) return;
  if (!mediaPreview) {
    console.warn('[MediaPreview] Overlay element not found');
    return;
  }
  mediaState.files = files;
  mediaState.currentIndex = Math.max(0, Math.min(index, files.length - 1));
  mediaState.open = true;
  mediaPreview.classList.remove('hidden');
  renderMediaPreview();
}

function closeMediaPreview() {
  mediaState.open = false;
  mediaState.files = [];
  if (mediaPreview) mediaPreview.classList.add('hidden');
  if (mediaContent) mediaContent.innerHTML = '';
  const term = window.QCLI?.Tabs?.term;
  if (term) term.focus();
}

function navigateMedia(delta) {
  if (!mediaState.files || mediaState.files.length <= 1) return;
  if (!mediaPreview) return;
  mediaState.currentIndex += delta;
  if (mediaState.currentIndex < 0) mediaState.currentIndex = mediaState.files.length - 1;
  if (mediaState.currentIndex >= mediaState.files.length) mediaState.currentIndex = 0;
  renderMediaPreview();
}

function renderMediaPreview() {
  const files = mediaState.files;
  const idx = mediaState.currentIndex;
  if (!files || !files[idx]) { closeMediaPreview(); return; }
  if (!mediaPreview || !mediaContent || !mediaName) return;

  const file = files[idx];
  const url = '/api/uploads/' + encodeURIComponent(pathBasename(file.path)) + '?mime=' + encodeURIComponent(file.mime || '');

  // Name
  mediaName.textContent = file.name;

  // Counter
  if (mediaCounter) {
    if (files.length > 1) {
      mediaCounter.textContent = (idx + 1) + ' / ' + files.length;
      mediaCounter.style.display = '';
    } else {
      mediaCounter.style.display = 'none';
    }
  }

  // Nav buttons
  if (mediaPrevBtn) mediaPrevBtn.style.display = files.length > 1 ? '' : 'none';
  if (mediaNextBtn) mediaNextBtn.style.display = files.length > 1 ? '' : 'none';

  // Meta
  if (mediaMeta) {
    const sizeStr = file.size ? formatFileSize(file.size) : '';
    const mimeStr = file.mime || '';
    mediaMeta.textContent = [mimeStr, sizeStr].filter(Boolean).join('  \u00b7  ');
  }

  // Content
  mediaContent.innerHTML = '';
  const mime = (file.mime || '').toLowerCase();
  if (mime.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = false;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'metadata';
    video.draggable = false;
    mediaContent.appendChild(video);
  } else if (mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = file.name;
    img.draggable = false;
    img.loading = 'eager';
    img.addEventListener('load', function() {
      if (!mediaMeta) return;
      const dims = this.naturalWidth + '\u00d7' + this.naturalHeight;
      const parts = [dims];
      if (file.size) parts.push(formatFileSize(file.size));
      mediaMeta.textContent = parts.join('  \u00b7  ');
    });
    mediaContent.appendChild(img);
  } else if (mime === 'application/pdf') {
    const embed = document.createElement('embed');
    embed.src = url;
    embed.type = 'application/pdf';
    embed.style.width = '100%';
    embed.style.height = 'calc(100vh - 120px)';
    embed.style.borderRadius = 'var(--radius-lg)';
    mediaContent.appendChild(embed);
  } else {
    mediaContent.textContent = 'Preview not available for this file type.';
    mediaContent.style.color = 'var(--text-tertiary)';
    mediaContent.style.fontSize = '14px';
  }

  // Download link
  if (mediaDownloadBtn) {
    mediaDownloadBtn.onclick = function() {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
    };
  }
}

async function handleMediaClick(filename) {
  try {
    // Validate the file exists and get MIME type
    const resp = await fetch('/api/uploads/' + encodeURIComponent(filename), { method: 'HEAD' });
    if (!resp.ok) {
      window.QCLI?.showUploadStatus?.('File not found: ' + filename, 'error');
      return;
    }
    const mime = resp.headers.get('content-type') || '';
    const size = parseInt(resp.headers.get('content-length') || '0', 10);

    // Only open preview for media files
    if (!mime.startsWith('image/') && !mime.startsWith('video/') && mime !== 'application/pdf') {
      window.QCLI?.showUploadStatus?.('Not a previewable file: ' + filename, 'info');
      return;
    }

    openMediaPreview([{
      name: filename,
      path: filename,
      mime: mime,
      size: size
    }], 0);
  } catch (err) {
    console.error('[MediaClick] Error:', err);
    window.QCLI?.showUploadStatus?.('Could not open: ' + filename, 'error');
  }
}

// Wire up events
if (mediaCloseBtn) mediaCloseBtn.addEventListener('click', closeMediaPreview);
if (mediaPrevBtn) mediaPrevBtn.addEventListener('click', function() { navigateMedia(-1); });
if (mediaNextBtn) mediaNextBtn.addEventListener('click', function() { navigateMedia(1); });

// Click background to close
if (mediaPreview) {
  mediaPreview.addEventListener('click', function(e) {
    if (e.target === mediaPreview || e.target.id === 'media-preview-body') {
      closeMediaPreview();
    }
  });
}

// Keyboard navigation
document.addEventListener('keydown', function(e) {
  if (!mediaState.open) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      closeMediaPreview();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      navigateMedia(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      navigateMedia(1);
      break;
  }
});

// Export to QCLI namespace
export const MediaPreview = {
  openMediaPreview,
  closeMediaPreview,
  navigateMedia,
  handleMediaClick,
  formatFileSize,
  pathBasename,
};
// Legacy compat
Q.Upload = Q.Upload || {};
Q.Upload.openMediaPreview = openMediaPreview;
Q.Upload.closeMediaPreview = closeMediaPreview;
Q.Upload.navigateMedia = navigateMedia;
Q.Upload.handleMediaClick = handleMediaClick;
Q.Upload.formatFileSize = formatFileSize;
Q.Upload.pathBasename = pathBasename;
