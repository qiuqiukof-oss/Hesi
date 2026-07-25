// @ts-check
// ============================================================
// Hesi — 新手引导（Onboarding）v3
// 1) 左栏「新手指南」按钮 → 新标签页打开 /onboarding-guide.html
// 2) 首次启动（localStorage 未标记）显示气泡指引（coach marks）
//    锚定 8 个关键点（含刷新CLI/安装Agent/AI讨论着重），可下一步 / 跳过 / Esc 关闭
//    气泡时机策略（A+B 混合）：
//      - B：聊天相关步骤（⭐AI讨论 / 📎附件）自动开 #chat-drawer，讲完自动关回，不遮挡后续欢迎页步骤
//      - A：目标不可见且无面板关联 → 静默跳过该步
//      - 方位偏好 prefer：欢迎页/Agent 步骤气泡置上方，避免遮挡下方卡片
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

  /**
   * 气泡步骤定义（按出现顺序）—— v2: 新增刷新CLI / 安装Agent / AI讨论(着重)
   *  panel: 'chat' 表示该步骤目标在聊天抽屉内，需先开抽屉
   *  prefer: 首选气泡方位（'up'|'down'|'left'|'right'），空间足够则优先用
   *  align: 水平对齐方式（'center'|'start'|'end'），默认 'center'
   *        'start'=气泡左边缘对齐目标左边缘（适合宽目标如 discuss-bar）
   *  offset: { x, y } 像素偏移（正=右/下，负=左/上），用于微调气泡最终位置
   *  highlightTarget: 高亮框精确指向的子元素 ID（默认用 target 本身；宽目标如 discuss-bar 可指定内部按钮）
   */
  const STEPS = [
    {
      target: 'onboarding-guide-btn',
      title: '🚀 新手指南',
      text: '点这里随时回看完整教程（中英双语）。',
    },
    {
      target: 'preset-selector',
      title: '🎭 先选个预设',
      text: '选择运行环境（Node / Python /Go 等），让 Hesi 知道用哪个环境执行你的命令。',
    },
    {
      target: 'discuss-bar',
      title: '⭐ AI 讨论（核心功能）',
      text: '开启后，你的指令会由 AI 与所选 CLI Agent 按回合协作讨论，过程实时可见。这是 Hesi 最强大的功能之一——多智能体圆桌辩论，比你单聊 AI 强十倍。',
      highlight: true,
      panel: 'chat',
      prefer: 'down',  // 气泡明确放在 discuss-bar 上方（箭头向下指），避免盖住按钮
      align: 'start',  // 气泡左对齐，箭头指向左侧🤝开关而非居中盖住整条栏
      offset: { x: -30, y: -112 },  // 往左上推（微调后下移40px）
      highlightTarget: 'discuss-switch',  // 高亮框只圈🤝开关本身，不圈整条宽栏
    },
    {
      target: 'chat-attach-btn',
      title: '📎 发附件给 AI',
      text: '点对话框的 📎 发图片、视频或代码文件，AI 真能「看懂」图、读取文件内容。',
      panel: 'chat',
      prefer: 'up',  // 小按钮：气泡固定在上方，箭头向下精确指向📎
      offset: { x: 10, y: -3 },  // 微调（下移22px）
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
      text: '在欢迎页可以一键安装预置的 AI Agent（如 OpenCode），让专业 Agent 替你干活。',
      prefer: 'up', // 气泡置上方，避免遮挡下方安装卡片/说明
      offset: { x: 0, y: -20 }, // 上移~1行文字
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
   * 目标是否真正可用（可见 + 在视口内 + 非 display:none 祖先）
   */
  function isElementUsable(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const inViewport = r.left < window.innerWidth && r.right > 0 && r.top < window.innerHeight && r.bottom > 0;
    if (!inViewport) return false;
    // display:none 祖先 → offsetParent 为 null（fixed 元素例外，本场景无）
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    return true;
  }

  /** 等待目标可见（处理抽屉开启动画），超时返回 false */
  function waitForVisible(el, timeout = 900) {
    return new Promise((resolve) => {
      if (isElementUsable(el)) return resolve(true);
      const start = Date.now();
      (function poll() {
        if (isElementUsable(el)) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(poll, 60);
      })();
    });
  }

  /** 确保聊天抽屉打开（B 方案） */
  function ensureChatOpen() {
    const drawer = document.getElementById('chat-drawer');
    if (drawer && !isElementUsable(drawer)) {
      const Q = window.QCLI || {};
      if (Q.ChatUI && typeof Q.ChatUI.toggleChat === 'function') Q.ChatUI.toggleChat();
    }
  }

  /** 确保聊天抽屉关闭（讲完聊天步骤后关回，避免遮挡后续步骤） */
  function ensureChatClose() {
    const drawer = document.getElementById('chat-drawer');
    if (drawer && isElementUsable(drawer)) {
      const Q = window.QCLI || {};
      if (Q.ChatUI && typeof Q.ChatUI.toggleChat === 'function') Q.ChatUI.toggleChat();
    }
  }

  /**
   * 单步气泡：高亮目标 + 卡片 + 箭头
   * 改进定位：优先 prefer 方位，否则自动选择最佳方位（上/下/左/右），增加箭头指向目标
   * align: 水平对齐（'center'|'start'|'end'），影响 left/right 方位的气泡位置
   * offset: { x, y } 像素偏移（正=右/下，负=左/上），在边界钳位前应用
   */
  function buildBubble(step, onNext, onSkip, prefer, align, offset) {
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
      // 如果指定了 highlightTarget，用子元素做高亮（更精准）
      const hlEl = step.highlightTarget
        ? document.getElementById(step.highlightTarget)
        : el;
      const hlRect = hlEl ? hlEl.getBoundingClientRect() : rect;
      const hlVisible = hlEl && hlRect.width > 0 && hlRect.height > 0;
      if (hlVisible) {
        const pad = 6;
        const hl = document.createElement('div');
        hl.className = 'og-highlight' + (step.highlight ? ' og-highlight-star' : '');
        hl.style.left = (hlRect.left - pad) + 'px';
        hl.style.top = (hlRect.top - pad) + 'px';
        hl.style.width = (hlRect.width + pad * 2) + 'px';
        hl.style.height = (hlRect.height + pad * 2) + 'px';
        overlay.appendChild(hl);
      }
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

    // ── 智能定位：优先 prefer 方位，否则选空间最大的方位 ──
    const bw = 300, bh = step.highlight ? 170 : 140, gap = 12;

    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const spaceRight = window.innerWidth - rect.right - gap;
    const spaceLeft = rect.left - gap;

    let top, left, arrowDir; // arrowDir: 'up'|'down'|'left'|'right'

    // 在指定方位放置；空间不足返回 false
    function tryPlace(dir) {
      if (dir === 'up' && spaceBelow >= bh) {
        top = rect.bottom + gap;
        // 水平对齐：start=左对齐, end=右对齐, center=居中
        if (align === 'start') left = rect.left;
        else if (align === 'end') left = rect.right - bw;
        else left = rect.left + rect.width / 2 - bw / 2;
        arrowDir = 'up'; return true;
      }
      if (dir === 'down' && spaceAbove >= bh) {
        top = rect.top - gap - bh;
        if (align === 'start') left = rect.left;
        else if (align === 'end') left = rect.right - bw;
        else left = rect.left + rect.width / 2 - bw / 2;
        arrowDir = 'down'; return true;
      }
      if (dir === 'left' && spaceRight >= bw) {
        top = rect.top + rect.height / 2 - bh / 2;
        left = rect.right + gap;
        arrowDir = 'left'; return true;
      }
      if (dir === 'right' && spaceLeft >= bw) {
        top = rect.top + rect.height / 2 - bh / 2;
        left = rect.left - gap - bw;
        arrowDir = 'right'; return true;
      }
      return false;
    }

    let placed = false;
    if (prefer) placed = tryPlace(prefer);
    if (!placed) {
      placed = tryPlace('up') || tryPlace('down') || tryPlace('left') || tryPlace('right');
    }

    if (!placed) {
      // 兜底：居中屏幕
      top = window.innerHeight / 2 - bh / 2;
      left = window.innerWidth / 2 - bw / 2;
      arrowDir = 'up';
    }

    // ── 手动偏移（在边界钳位前应用）──
    if (offset) {
      if (offset.x) left += offset.x;
      if (offset.y) top += offset.y;
    }

    // 边界钳位
    top = Math.max(8, Math.min(top, window.innerHeight - bh - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    bubble.style.top = top + 'px';
    bubble.style.left = left + 'px';

    // ── 箭头：作为气泡子元素，position:absolute 相对气泡定位（见 onboarding.css）──
    const arrow = document.createElement('div');
    let arrowClass = 'og-arrow og-arrow-' + arrowDir;
    // align=start/end 时箭头也跟着偏移，指向目标对应边缘
    if (align === 'start' && (arrowDir === 'up' || arrowDir === 'down')) {
      arrowClass += ' og-arrow-start';
    } else if (align === 'end' && (arrowDir === 'up' || arrowDir === 'down')) {
      arrowClass += ' og-arrow-end';
    }
    arrow.className = arrowClass;
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
      // 中途退出也确保聊天抽屉关回，不残留遮挡
      ensureChatClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { finish(); }
      else if (e.key === 'Enter') { next(); }
    }
    async function next() {
      if (current) { current.remove(); current = null; }
      if (i >= STEPS.length) { finish(); return; }
      const step = STEPS[i];

      // ── 面板协同（B 方案）──
      if (step.panel === 'chat') {
        ensureChatOpen();
        const ok = await waitForVisible(document.getElementById(step.target), 900);
        if (!ok) {
          // 开不了抽屉（异常）→ A 降级静默跳过
          i++; next(); return;
        }
      } else {
        // 非 chat 步：若上一步是 chat 步，进入前关回抽屉，避免遮挡
        const prev = STEPS[i - 1];
        if (prev && prev.panel === 'chat') ensureChatClose();
      }

      const overlay = buildBubble(step, next, finish, step.prefer, step.align, step.offset);
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
