/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Global Progress Bar — patched onto QCLI namespace
// ============================================================
// Shows/hides a progress indicator for ongoing async operations.
// Uses a simple counter: each show() increments, each hide() decrements.
// The bar stays visible until the counter reaches zero.

/** @type {QCLINamespace} */
const Q = /** @type {any} */(window).QCLI = /** @type {any} */(window).QCLI || {};

(function() {
  /** @type {number} */
  let progressCount = 0;

  /** @returns {void} */
  function showProgressBar() {
    progressCount++;
    if (progressCount > 0) {
      document.getElementById('global-progress')?.classList.add('active');
    }
  }

  /** @returns {void} */
  function hideProgressBar() {
    progressCount = Math.max(0, progressCount - 1);
    if (progressCount === 0) {
      const el = document.getElementById('global-progress');
      if (el) el.classList.remove('active');
    }
  }

  // Patch onto QCLI in a microtask (runs after app.js init())
  Promise.resolve().then(() => {
    Q.showProgressBar = showProgressBar;
    Q.hideProgressBar = hideProgressBar;
  });
})();
