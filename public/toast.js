/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Toast Notifications — Glassmorphism + Auto-Stack
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/** @type {Object<string,string>} */
export const TOAST_ICONS = {
    success: '\u2714\ufe0f',
    error:   '\u2716\ufe0f',
    info:    '\u2139\ufe0f',
  };

  export function showToast(msg, type) {
    const container = document.getElementById('toast-container') || (() => {
      const el = document.createElement('div');
      el.id = 'toast-container';
      document.body.appendChild(el);
      return el;
    })();

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');

    // Icon
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;
    toast.appendChild(icon);

    // Body — avoid `[object Object]` flicker for object messages
    const body = document.createElement('span');
    body.className = 'toast-body';
    body.textContent = (typeof msg === 'object' && msg !== null && typeof msg.toString === 'function')
      ? msg.toString()
      : msg;
    toast.appendChild(body);

    // Dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'toast-dismiss';
    dismiss.textContent = '\u00d7';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      exitToast(toast);
    });
    toast.appendChild(dismiss);

    // Trigger entrance animation BEFORE adding to DOM to avoid flash
    toast.classList.add('entering');
    container.appendChild(toast);

    // Make toast clickable if msg has _onClick handler
    if (msg && typeof msg === 'object' && msg._onClick) {
      toast.style.cursor = 'pointer';
      toast.addEventListener('click', (e) => {
        if (e.target.closest('.toast-dismiss')) return;
        msg._onClick(e);
      });
    }

    // Auto-remove after delay
    toast._exitTimer = setTimeout(() => {
      exitToast(toast);
    }, 3500);

    return toast;
  }

  function exitToast(toast) {
    if (!toast || toast._exiting) return;
    toast._exiting = true;

    // Clear auto-exit timer
    if (toast._exitTimer) {
      clearTimeout(toast._exitTimer);
      toast._exitTimer = null;
    }

    // Remove entrance animation, add exit animation
    toast.classList.remove('entering');
    toast.classList.add('exiting');

    // Remove from DOM after animation completes
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 350);
  }

  export function showUploadStatus(msg, type) {
    return showToast(msg, type || 'info');
  }

  // Export to QCLI namespace for other modules
  Q.showToast = showToast;
  Q.showUploadStatus = showUploadStatus;
