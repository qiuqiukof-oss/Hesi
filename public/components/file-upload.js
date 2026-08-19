/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// file-upload — Drag & Drop file upload handler
//
// Phase 2: Extracts drag-and-drop file upload from app.js.
// Auto-initializes at import time (document event listeners).
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

let dragCounter = 0;

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }
/** @returns {{[key:string]: HTMLElement|null}} */
function dom() { return Q().dom || {}; }
/** @returns {{[key:string]: any}} */
function state() { return Q().state || {}; }

/**
 * @param {string|{toString():string,_onClick?:Function}} msg
 * @param {string} [type]
 */
function showStatus(msg, type) {
  const s = Q().showUploadStatus;
  if (s) s(msg, type || 'info');
}

/** @returns {import('xterm').Terminal|null} */
function getTerm() {
  return Q().Tabs?.term || null;
}

/**
 * @param {Array<{mime:string,name:string}>} files
 * @param {number} [index]
 */
function openPreview(files, index) {
  const p = Q().Upload?.openMediaPreview;
  if (p) p(files, index || 0);
}

// ============================================================
// Event handlers (wired up at import via microtask)
// ============================================================

/** @param {DragEvent} e */
function onDragEnter(e) {
  if (!e.dataTransfer.types.includes('text/cli-id')) {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      const d = dom();
      if (d.dropOverlay) d.dropOverlay.classList.remove('hidden');
    }
  }
}

/** @param {DragEvent} e */
function onDragLeave(e) {
  if (!e.dataTransfer.types.includes('text/cli-id')) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      const d = dom();
      if (d.dropOverlay) d.dropOverlay.classList.add('hidden');
    }
  }
}

/** @param {DragEvent} e */
function onDragOver(e) {
  if (!e.dataTransfer.types.includes('text/cli-id')) {
    e.preventDefault();
  }
}

/** @param {DragEvent} e */
async function onDrop(e) {
  e.preventDefault();
  dragCounter = 0;
  const d = dom();
  if (d.dropOverlay) d.dropOverlay.classList.add('hidden');

  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;

  showStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);

  try {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }

    const resp = await fetch('/api/upload', { method: 'POST', body: formData });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showStatus(`Upload failed: ${err.error || resp.statusText}`);
      return;
    }

    const result = await resp.json();
    if (!result.success) return;

    const uploadedFiles = result.files;
    const count = uploadedFiles.length;

    const mediaFiles = uploadedFiles.filter(f => {
      const mime = (f.mime || '').toLowerCase();
      return mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf';
    });

    const hasPreview = mediaFiles.length > 0;
    const toastMsg = hasPreview
      ? { _onClick: () => openPreview(mediaFiles, 0), toString: () => `\ud83d\udcf7 ${count} file${count > 1 ? 's' : ''} uploaded \u2014 click to preview` }
      : `Uploaded ${count} file${count > 1 ? 's' : ''}`;
    showStatus(toastMsg, hasPreview ? 'success' : 'info');

    if (hasPreview) {
      window.__lastUploadedFiles = mediaFiles;
    }

    const term = getTerm();
    const s = state();
    if (term && s.launched) {
      const names = uploadedFiles.map(f => f.name).join(', ');
      term.write(`\r\n\x1b[90m[Uploaded: ${names}]\x1b[0m\r\n`);
      for (const f of uploadedFiles) {
        const m = (f.mime || '').toLowerCase();
        if (m.startsWith('image/') || m.startsWith('video/') || m === 'application/pdf') {
          term.write(`\x1b[90m  uploads\\${f.name}\x1b[0m\r\n`);
        }
      }
      if (hasPreview) {
        term.write(`\x1b[90m[Click paths above or toast to preview]\x1b[0m\r\n`);
      }
    }
  } catch (err) {
    showStatus('Upload failed \u2014 network error');
  }
}

// ============================================================
// Auto-init at import time (deferred microtask)
// ============================================================
Promise.resolve().then(() => {
  if (Q()._fileUploadPatched) return;
  Q()._fileUploadPatched = true;

  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
});
