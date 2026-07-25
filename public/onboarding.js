// @ts-check
// ============================================================
// Hesi — 新手引导（Onboarding）v4
// 1) 左栏「新手指南」按钮 → 弹出菜单：🚀 快速引导 / 🔍 深度游（均启动气泡指引）
// 2) 首次启动（localStorage 未标记）自动播放「快速引导」气泡（coach marks）
//    锚定关键点（含刷新CLI/安装Agent/AI讨论⭐/全局工作空间⭐/附件），可下一步 / 跳过 / Esc 关闭
// 3) 深度游：额外 3 个「藏得最深」的能力气泡（右侧工作台面板 / 语音 / 自定义CSS），由菜单手动触发
// 4) 气泡末步提供「📖 完整介绍」链接 → 打开 /onboarding-guide.html（占位页，后续替换）
//    气泡时机策略（A+B 混合）：
//      - B：聊天相关步骤（⭐AI讨论 / 📎附件）自动开 #chat-drawer，讲完自动关回
//      - A：目标不可见且无面板关联 → 静默跳过该步
//      - 方位偏好 prefer：欢迎页/Agent 步骤气泡置上方，避免遮挡下方卡片
// 命名空间：localStorage['hesi_onboarding_v2']（v2 版本号，旧 v1 用户重新看）
// 对外暴露：window.QCLI.Onboarding.startTour() / startDeepTour()
// ============================================================
(function () {
  'use strict';

  const KEY = 'hesi_onboarding_v2';

  /**
   * 左栏「新手指南」按钮 → 弹出菜单：🚀 快速引导 / 🔍 深度游
   * 两者均启动气泡指引（coach marks），不再打开独立网页。
   */
  function bindGuideButton() {
    const btn = document.getElementById('onboarding-guide-btn');
    if (!btn) return;
    let menu = null;

    function closeMenu() {
      if (menu) { menu.remove(); menu = null; }
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDocClick, true);
    }
    function onDocClick(e) {
      if (menu && e.target !== btn && !btn.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu) { closeMenu(); return; }
      menu = document.createElement('div');
      menu.className = 'og-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML =
        '<button type="button" class="og-menu-item" role="menuitem" data-act="quick">🚀 快速引导</button>' +
        '<button type="button" class="og-menu-item" role="menuitem" data-act="deep">🔍 深度游（藏得最深的功能）</button>';
      document.body.appendChild(menu);
      const r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.querySelector('[data-act="quick"]').addEventListener('click', () => { closeMenu(); startTour(); });
      menu.querySelector('[data-act="deep"]').addEventListener('click', () => { closeMenu(); startDeepTour(); });
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
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
      text: '点这里重播新手引导（快速引导 / 深度游）。想看图文版，气泡最后一步有「📖 完整介绍」入口。',
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
      offset: { x: -30, y: -90 },  // 球总要求再上移20px（累计-90）
      highlightTarget: 'discuss-switch',  // 高亮框只圈🤝开关本身，不圈整条宽栏
    },
    {
      target: 'chat-attach-btn',
      title: '📎 发附件给 AI',
      text: '点对话框的 📎 发图片、视频或代码文件，AI 真能「看懂」图、读取文件内容。',
      panel: 'chat',
      prefer: 'up',  // 小按钮：气泡固定在上方，箭头向下精确指向📎
      offset: { x: 10, y: -36 },  // 气泡上移25px（仅影响气泡，高亮框钉死在📎按钮上）
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
      target: 'workspace-dir-btn',
      title: '📂 全局工作空间（核心功能）',
      text: '这里统一设置终端和 AI 的默认工作目录。选对项目文件夹后，新终端和 AI 执行命令都会在这个目录下运行，不用每次手动 cd。',
      highlight: true,
      prefer: 'down',  // 气泡在按钮上方，箭头向下
      offset: { x: 0, y: -10 },
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
      offset: { x: 0, y: -8 },  // 上移8px
    },
  ];

  /**
   * 深度游气泡：藏得最深的 3 个能力，由「新手指南 → 🔍 深度游」手动触发，不进首跑引导。
   */
  const DEEP_STEPS = [
    {
      target: 'right-panel',
      title: '📊 右侧工作台（多面板）',
      text: '右侧栏是 Hesi 的「工作台」，可切换仪表盘、终端、浏览器、文件管理、进程监控等十多个功能面板。很多新用户都没注意到这块宝藏。',
      prefer: 'left',
      offset: { x: -12, y: 0 },
    },
    {
      target: 'voice-input-btn',
      title: '🎤 语音输入 / 🔊 语音播报',
      text: '点 🎤 用麦克风说话，实时转文字发给 AI，免打字；点状态栏的 🔇 可开启语音播报，AI 回复时自动朗读。AI 设置里能调发音人、语速、音高。',
      prefer: 'up',
      offset: { x: -10, y: -8 },
    },
    {
      target: 'custom-css-btn',
      title: '🖌️ 自定义 CSS',
      text: '点 🖌️ 打开自定义 CSS 编辑器，可改主题色、圆角、字体，打造你的专属 Hesi。写错也不怕，Reset 一键还原。',
      prefer: 'up',
      offset: { x: 0, y: -8 },
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

  /** 等待元素 CSS transition / animation 稳定（监听 transitionend 或超时兜底）
   *  用途：打开聊天抽屉后必须等滑入动画结束再读坐标，否则 getBoundingClientRect
   *       返回动画中途的中间值 → 气泡偏移（实测 dy≈88px~200px+ 视觉脱节） */
  function waitForSettled(el, timeout = 700) {
    return new Promise((resolve) => {
      const done = () => resolve(true);
      el.addEventListener('transitionend', done, { once: true });
      // 兜底：若元素无 transition 或 transitionend 未触发（如 display:none→block 无动画）
      setTimeout(() => { el.removeEventListener('transitionend', done); resolve(true); }, timeout);
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
  function buildBubble(step, onNext, onSkip, prefer, align, offset, isLast) {
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

    // ── 末步「📖 完整介绍」链接（仅最后一步显示）──
    if (isLast) {
      const fullLink = document.createElement('button');
      fullLink.type = 'button';
      fullLink.className = 'og-full-link';
      fullLink.textContent = '📖 完整介绍';
      fullLink.title = '查看 Hesi 完整图文介绍（新标签页）';
      fullLink.addEventListener('click', () => window.open('/onboarding-guide.html', '_blank'));
      bubble.appendChild(fullLink);
    }

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

  function runTour(steps) {
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
      if (e.key === 'Escape') { finish(); return; }
      if (e.key === 'Enter') {
        // 焦点在表单输入控件时不拦截 Enter，避免引导进行中误推进
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        next();
      }
    }
    async function next() {
      if (current) { current.remove(); current = null; }
      if (i >= steps.length) { finish(); return; }
      const step = steps[i];
      const isLast = (i === steps.length - 1);

      // ── 面板协同（B 方案）──
      if (step.panel === 'chat') {
        // #chat-drawer(z-index:6) 天然在 #welcome-overlay(z-index:5) 之上，无需隐藏欢迎页
        ensureChatOpen();
        // 等待聊天抽屉滑入动画结束，避免在动画中途读坐标导致气泡偏移
        const drawer = document.getElementById('chat-drawer');
        if (drawer) await waitForSettled(drawer);
        const ok = await waitForVisible(document.getElementById(step.target), 900);
        if (!ok) {
          // 开不了抽屉（异常）→ A 降级静默跳过
          i++; next(); return;
        }
      } else {
        // 非 chat 步：若上一步是 chat 步，进入前关回抽屉
        const prev = steps[i - 1];
        if (prev && prev.panel === 'chat') { ensureChatClose(); }
      }

      const overlay = buildBubble(step, next, finish, step.prefer, step.align, step.offset, isLast);
      if (!overlay) { i++; next(); return; }
      current = overlay;
      i++;
      // 最后一步把「下一步」改为「完成」
      if (isLast) {
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

  function startTour() { runTour(STEPS); }
  function startDeepTour() { runTour(DEEP_STEPS); }

  // 对外暴露，供其他模块或控制台触发引导
  window.QCLI = window.QCLI || {};
  window.QCLI.Onboarding = { startTour: startTour, startDeepTour: startDeepTour };

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
