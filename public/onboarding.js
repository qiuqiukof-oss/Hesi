// @ts-check
// ============================================================
// Hesi — 新手引导（Onboarding）
// 1) 左栏「新手指南」按钮 → 新标签页打开 /onboarding-guide.html
// 2) 首次启动（localStorage 未标记）显示气泡指引（coach marks）
//    锚定 5 个关键点，可下一步 / 跳过 / Esc 关闭，完成写标记。
// 命名空间：localStorage['hesi_onboarding_v1']，与现有 session-restore 浮层独立。
// ============================================================
(function () {
  'use strict';

  const KEY = 'hesi_onboarding_v1';

  /** 打开教程页（新标签页，不抢占主会话） */
  function bindGuideButton() {
    const btn = document.getElementById('onboarding-guide-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      window.open('/onboarding-guide.html', '_blank');
    });
  }

  /** 气泡步骤定义（按出现顺序） */
  const STEPS = [
    {
      target: 'onboarding-guide-btn',
      title: '新手指南',
      text: '点这里随时回看 2 分钟上手教程。',
    },
    {
      target: 'preset-selector',
      title: '先选个预设',
      text: '决定 AI 扮演什么角色（如「开发者」），切换后语气和擅长领域会跟着变。',
    },
    {
      target: 'sidebar-tools-grid',
      title: '发现工具',
      text: '插件广场 / WB广场 / 工具箱都在这里，按需求扩展 Hesi。',
    },
    {
      target: 'add-cli-btn',
      title: '接入你的工具',
      text: '需要时把命令行工具接入 Hesi，让它帮你跑和管理。',
    },
    {
      target: 'chat-file-input',
      title: '发附件给 AI',
      text: '点对话框的 📎 发图片或文件，AI 真能看懂图、读代码。',
    },
  ];

  function markDone() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
  }

  function hasSeen() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  /** 单步气泡：高亮目标 + 卡片 */
  function buildBubble(step, onNext, onSkip) {
    const el = document.getElementById(step.target);
    if (!el) return null; // 目标未就绪，跳过此步

    const overlay = document.createElement('div');
    overlay.className = 'og-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '新手引导：' + step.title);

    const rect = el.getBoundingClientRect();
    const pad = 6;
    const hl = document.createElement('div');
    hl.className = 'og-highlight';
    hl.style.left = (rect.left - pad) + 'px';
    hl.style.top = (rect.top - pad) + 'px';
    hl.style.width = (rect.width + pad * 2) + 'px';
    hl.style.height = (rect.height + pad * 2) + 'px';
    overlay.appendChild(hl);

    const bubble = document.createElement('div');
    bubble.className = 'og-bubble';
    bubble.innerHTML =
      '<h4>' + step.title + '</h4>' +
      '<p>' + step.text + '</p>' +
      '<div class="og-actions">' +
      '  <button class="og-skip" type="button">跳过</button>' +
      '  <button class="og-next" type="button">下一步</button>' +
      '</div>';
    overlay.appendChild(bubble);

    // 气泡定位：目标下方，空间不足则上方
    const bw = 260, bh = 130, gap = 12;
    let top = rect.bottom + gap;
    if (top + bh > window.innerHeight) top = rect.top - gap - bh;
    if (top < 8) top = 8;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    bubble.style.top = top + 'px';
    bubble.style.left = left + 'px';

    bubble.querySelector('.og-next').addEventListener('click', onNext);
    bubble.querySelector('.og-skip').addEventListener('click', onSkip);
    // 点击遮罩空白处 = 跳过
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onSkip();
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function startTour() {
    let i = 0;
    let current = null;

    function cleanup() {
      if (current && current.parentNode) current.parentNode.removeChild(current);
      current = null;
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') { finish(); }
      else if (e.key === 'Enter') { next(); }
    }
    function next() {
      if (current) { current.remove(); current = null; }
      if (i >= STEPS.length) { finish(); return; }
      const overlay = buildBubble(STEPS[i], next, finish);
      if (!overlay) { i++; next(); return; } // 目标缺失，跳到下一步
      current = overlay;
      i++;
      // 最后一步把「下一步」改为「完成」
      if (i >= STEPS.length) {
        const nb = overlay.querySelector('.og-next');
        if (nb) nb.textContent = '完成 ✓';
      }
    }
    function finish() {
      cleanup();
      markDone();
    }

    document.addEventListener('keydown', onKey);
    next();
  }

  function initOnboarding() {
    bindGuideButton();
    if (hasSeen()) return;
    // 延迟挂载，避免 chat 视图懒加载导致目标未就绪
    setTimeout(startTour, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    initOnboarding();
  }
})();
