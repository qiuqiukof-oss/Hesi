// ============================================================
// Agnes AI plugin — right-panel tab entry
//
// Registers a "🎬 Agnes 创作" tab in the Hesi right panel. The tab hosts the
// full Agnes workbench inside an iframe (served from /plugin-assets/agnes-ai/web/),
// plus a "new window" button for a fullscreen experience.
// ============================================================
(function () {
  'use strict';
  const Q = window.QCLI;
  if (!Q || !Q.UIRegistry) {
    console.warn('[Agnes] UIRegistry 不可用，跳过 Tab 注册');
    return;
  }

  const FRAME_SRC = '/plugin-assets/agnes-ai/web/index.html';

  Q.UIRegistry.registerTab('agnes-ai', {
    icon: '🎬',
    label: 'Agnes 创作',
    category: 'monitor',
    order: 2,
    render (container) {
      container.innerHTML =
        `<div class="agnes-plugin-wrap">` +
        `  <div class="agnes-plugin-bar">` +
        `    <span class="agnes-plugin-title">🎬 Agnes AI 创作台</span>` +
        `    <button type="button" class="agnes-plugin-pop" title="在新窗口全屏打开">⧉ 新窗口</button>` +
        `  </div>` +
        `  <iframe class="agnes-plugin-frame" src="${  FRAME_SRC  }" frameborder="0"></iframe>` +
        `</div>`;

      const pop = container.querySelector('.agnes-plugin-pop');
      if (pop) {
        pop.addEventListener('click', () => {
          window.open(FRAME_SRC, 'agnes-ai', 'width=1440,height=900');
        });
      }

      // Inject one-time styles
      if (!document.getElementById('agnes-plugin-style')) {
        const s = document.createElement('style');
        s.id = 'agnes-plugin-style';
        s.textContent =
          '.agnes-plugin-wrap{display:flex;flex-direction:column;height:100%;min-height:0;}' +
          '.agnes-plugin-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border,#2a2d33);flex:0 0 auto;}' +
          '.agnes-plugin-title{font-weight:600;}' +
          '.agnes-plugin-pop{cursor:pointer;background:var(--accent,#3b82f6);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;}' +
          '.agnes-plugin-pop:hover{filter:brightness(1.1);}' +
          '.agnes-plugin-frame{flex:1 1 auto;width:100%;border:none;background:#0d0e10;min-height:0;}';
        document.head.appendChild(s);
      }
    },
  });
})();
