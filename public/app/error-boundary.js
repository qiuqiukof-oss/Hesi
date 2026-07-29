/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// error-boundary.js — 全局 UI 错误边界
// 捕获 window.onerror / unhandledrejection，顶部插入「局部降级」横幅，
// 避免单点异常导致整页白屏；不阻断其余面板、不吞 console 错误。
// ============================================================

/**
 * 安装全局错误边界。幂等（多次调用只生效一次）。
 */
export function installErrorBoundary() {
  if (installErrorBoundary._installed) return;
  installErrorBoundary._installed = true;

  /** @param {string} msg */
  function showBanner(msg) {
    try {
      let el = document.getElementById('hesi-error-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'hesi-error-banner';
        el.className = 'hesi-error-banner hidden';
        el.setAttribute('role', 'alert');
        document.body.appendChild(el);
      }
      const time = new Date().toLocaleTimeString();
      el.innerHTML =
        '<span class="heb-icon">⚠</span>' +
        '<span class="heb-text">Hesi 部分功能异常，已局部降级；刷新页面可恢复。</span>' +
        '<span class="heb-detail"></span>' +
        '<button type="button" class="heb-close" aria-label="关闭">×</button>';
      /** @type {HTMLElement} */ (el.querySelector('.heb-detail')).textContent = `[${time}] ${String(msg).slice(0, 200)}`;
      el.classList.remove('hidden');
      el.querySelector('.heb-close').addEventListener('click', () => el.classList.add('hidden'));
    } catch { /* 极端情况：连 DOM 都不可用，静默 */ }
  }

  window.addEventListener('error', (e) => {
    // 资源加载错误（img/script）无 message，跳过以免刷屏
    if (e && e.message) showBanner(e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    const msg = r && r.message ? r.message : (r ? String(r) : '未知 Promise 拒绝');
    showBanner(msg);
  });
}
