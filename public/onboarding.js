// @ts-check
// ============================================================
// Hesi — 新手引导（Onboarding）v2
// 1) 左栏「新手指南」按钮 → 新标签页打开 /onboarding-guide.html
// 2) 首次启动（localStorage 未标记）显示气泡指引（coach marks）
//    锚定 8 个关键点（含刷新CLI/安装Agent/AI讨论着重），可下一步 / 跳过 / Esc 关闭
// 命名空间：localStorage['hesi_onboarding_v2']（v2 版本号，旧 v1 用户重新看）
// ============================================================
(function () {
  'use strict';

  const KEY = 'hesi_onboarding_v2';

  /** 打开教程页（新标签页，不抢占主会话） */
  function bindGuideButton() {
    const btn = document.getElementById('onboarding-guide-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      window.open('/onboarding-guide.html', '_blank');
    });
  }

  /** 气泡步骤定义（按出现顺序）—— v2: 新增刷新CLI / 安装Agent / AI讨论(着重) */
  const STEPS = [
    {
      target: 'onboarding-guide-btn',
      title: '🚀 新手指南',
      text: '点这里随时回看完整教程（中英双语）。',
    },
    {
      target: 'preset-selector',
      title: '🎭 先选个预设',
      text: '决定 AI 扮演什么角色（如「开发者」），切换后语气和擅长领域会跟着变。',
    },
    {
      target: 'discuss-bar',
      title: '⭐ AI 讨论（核心功能）',
      text: '开启后，你的指令会由 AI 与所选 CLI Agent 按回合协作讨论，过程实时可见。这是 Hesi 最强大的功能之一——多智能体圆桌辩论，比你单聊 AI 强十倍。',
      highlight: true, // 着重提示：特殊样式
    },
    {
      target: 'chat-attach-btn',
      title: '📎 发附件给 AI',
      text: '点对话框的 📎 发图片、视频或代码文件，AI 真能「看懂」图、读取文件内容。',
    },
    {
      target: 'discover-btn',
      title: '⟳ 刷新 CLI 列表',
      text: '装了新命令行工具后点这里，Hesi 会重新扫描 PATH 并自动发现新工具。',
    },
    {
      target: 'sidebar-tools-grid',
      title: '🔧 发现工具',
      text: '插件广场 / WB广场 / 工具箱都在这里，按需求扩展 Hesi 的能力。',
    },
    {
      target: 'welcome-agent-install',
      title: '🤖 安装 AI Agent',
      text: '在欢迎页或右侧面板可以一键安装预置的 AI Agent（如 OpenCode），让专业 Agent 替你干活。',
    },
    {
      target: 'add-cli-btn',
      title: '+ 接入你的工具',
      text: '需要时把自定义命令行工具接入 Hesi，让它帮你跑和管理更多东西。',
    },
  ];

  function markDone() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
  }

  function hasSeen() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  /**
   * 单步气泡：高亮目标 + 卡片 + 箭头
   * 改进定位：自动选择最佳方位（上/下/左/右），增加箭头指向目标
   */
  function buildBubble(step, onNext, onSkip) {
    const el = document.getElementById(step.target);
    if (!el) return null;

    const rect0 = el.getBoundingClientRect();
    // 目标可能尚未布局完成（尺寸为 0）→ 视为不可见，气泡居中屏幕、不高亮
    const visible = rect0.width > 0 && rect0.height > 0;
    const rect = visible
      ? rect0
      : { left: window.innerWidth / 2, top: window.innerHeight / 2, right: window.innerWidth / 2, bottom: window.innerHeight / 2, width: 0, height: 0 };

    const overlay = document.createElement('div');
    overlay.className = 'og-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '新手引导：' + step.title);

    // ── 高亮框：仅当目标可见时紧贴目标 ──
    if (visible) {
      const pad = 6;
      const hl = document.createElement('div');
      hl.className = 'og-highlight' + (step.highlight ? ' og-highlight-star' : '');
      hl.style.left = (rect.left - pad) + 'px';
      hl.style.top = (rect.top - pad) + 'px';
      hl.style.width = (rect.width + pad * 2) + 'px';
      hl.style.height = (rect.height + pad * 2) + 'px';
      overlay.appendChild(hl);
    }

    // ── 气泡卡片 ──
    const bubble = document.createElement('div');
    bubble.className = 'og-bubble' + (step.highlight ? ' og-bubble-star' : '');

    const starBadge = step.highlight ? '<div class="og-star-badge">⭐ 核心功能</div>' : '';

    bubble.innerHTML =
      '<h4>' + step.title + '</h4>' +
      starBadge +
      '<p>' + step.text + '</p>' +
      '<div class="og-actions">' +
      '  <button class="og-skip" type="button">跳过</button>' +
      '  <button class="og-next" type="button">下一步</button>' +
      '</div>';
    overlay.appendChild(bubble);

    // ── 智能定位：选择空间最大的方位 ──
    const bw = 300, bh = step.highlight ? 170 : 140, gap = 12;

    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const spaceRight = window.innerWidth - rect.right - gap;
    const spaceLeft = rect.left - gap;

    let top, left, arrowDir; // arrowDir: 'up'|'down'|'left'|'right'

    if (spaceBelow >= bh || (spaceBelow >= spaceAbove && spaceBelow >= spaceRight * 0.4 && spaceBelow >= spaceLeft * 0.4)) {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - bw / 2;
      arrowDir = 'up';
    } else if (spaceAbove >= bh) {
      top = rect.top - gap - bh;
      left = rect.left + rect.width / 2 - bw / 2;
      arrowDir = 'down';
    } else if (spaceRight >= bw) {
      top = rect.top + rect.height / 2 - bh / 2;
      left = rect.right + gap;
      arrowDir = 'left';
    } else if (spaceLeft >= bw) {
      top = rect.top + rect.height / 2 - bh / 2;
      left = rect.left - gap - bw;
      arrowDir = 'right';
    } else {
      // 兜底：居中屏幕
      top = window.innerHeight / 2 - bh / 2;
      left = window.innerWidth / 2 - bw / 2;
      arrowDir = 'up';
    }

    // 边界钳位
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    bubble.style.top = top + 'px';
    bubble.style.left = left + 'px';

    // ── 箭头：作为气泡子元素，position:absolute 相对气泡定位（见 onboarding.css）──
    const arrow = document.createElement('div');
    arrow.className = 'og-arrow og-arrow-' + arrowDir;
    bubble.appendChild(arrow);

    bubble.querySelector('.og-next').addEventListener('click', onNext);
    bubble.querySelector('.og-skip').addEventListener('click', onSkip);
    overlay.addEventListener('click', function (e) {
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
      if (!overlay) { i++; next(); return; }
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
    // 延迟挂载，确保 DOM 完全就绪（包括懒加载的右面板）
    setTimeout(startTour, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnboarding);
  } else {
    initOnboarding();
  }
})();
