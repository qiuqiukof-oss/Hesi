/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
'use strict';
// ============================================================
// category-chips — 聊天面板「对话模式」两级快速选择条
// 上行：主分类（大粒度，带 icon 的 pill）
// 下行：子分类（随主分类动态切换，带淡入淡出过渡）
//
// 设计（与 savings-icon / context-usage 同款增量模式）：
// - 纯前端组件，零核心链路改动；未选时后端零注入，行为不变。
// - 状态持久化到 localStorage('qcli-active-category')，存储为 JSON {main, sub}，
//   并兼容 v0.4.2 的旧单级 string 格式（迁移为 {main: oldVal, sub: null}）。
// - 对外契约保持字符串：`getActiveCategory()` 返回 "main" 或 "main::sub"，
//   供 chat-panel 发消息时透传、后端注入 [当前模式] 系统提示段 + 同类 Skill 加权。
// - window.QCLI 额外暴露 getActiveCategoryObj() 返回 {main, sub} 对象。
// ============================================================

/**
 * 主分类定义（两级结构）。
 * 覆盖 v0.4.2 六个单级分类：skill→agent「Skill 开发」、cicd→ops「CI/CD」、docs→ops「文档」。
 * @typedef {{ id: string, label: string, icon: string, subs: string[] }} MainCategory
 */

/** @type {MainCategory[]} */
export const MAIN_CATEGORIES = [
  {
    id: 'dev', label: '日常开发', icon: '☕',
    subs: ['Bug修复', 'API开发', '单测', '打包部署', 'Code Review', '调试排错', '重构', '性能优化'],
  },
  {
    id: 'web', label: '网站开发', icon: '⚙',
    subs: ['前端页面', '后端接口', '数据库', '样式调整', '响应式', 'SEO优化', '动画交互'],
  },
  {
    id: 'agent', label: 'Agent 应用', icon: '🤖',
    subs: ['Skill 开发', '工具注册', 'MCP 连接器', '工作流编排', '多 Agent 协作', 'Prompt 工程'],
  },
  {
    id: 'ops', label: '工程效能', icon: '🛠',
    subs: ['CI/CD', '文档', '发布', '监控告警', '环境配置'],
  },
];

const LS_KEY = 'qcli-active-category';

/**
 * 读取当前选择状态。兼容旧单级 string 格式。
 * @returns {{ main: string, sub: string|null }}
 */
function readState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { main: '', sub: null };
    // 旧格式：纯字符串（v0.4.2 单级分类），整体当作 main。
    if (raw[0] !== '{') return { main: raw, sub: null };
    const obj = JSON.parse(raw);
    return { main: obj && obj.main ? String(obj.main) : '', sub: obj && obj.sub ? String(obj.sub) : null };
  } catch {
    return { main: '', sub: null };
  }
}

/**
 * 当前选择对象。
 * @returns {{ main: string, sub: string|null }}
 */
export function getActiveCategoryObj() {
  return readState();
}

/**
 * 当前激活分类字符串：
 * - 仅有主分类 → "main"
 * - 主+子 → "main::sub"
 * - 未选 → ""（空串）
 * 维持与 v0.4.2 一致的外部分类契约（chat-panel / 后端直接透传）。
 * @returns {string}
 */
export function getActiveCategory() {
  const { main, sub } = readState();
  if (!main) return '';
  return sub ? `${main}::${sub}` : main;
}

/**
 * 设置当前选择。
 * @param {string} [main] 主分类 id；传空/falsy 表示取消选择。
 * @param {string} [sub] 子分类文本；传空/falsy 表示仅保留主分类。
 */
export function setActiveCategory(main, sub) {
  try {
    if (!main) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify({ main, sub: sub || null }));
    }
  } catch { /* localStorage 不可用时静默 */ }
  const Q = (typeof window !== 'undefined' && (window.QCLI || (window.QCLI = {})));
  if (Q) {
    Q.getActiveCategory = getActiveCategory;
    Q.setActiveCategory = setActiveCategory;
    Q.getActiveCategoryObj = getActiveCategoryObj;
  }
}

/** 子分类行淡出/淡入切换时长（ms），需与 CSS transition 一致。 */
const SUB_FADE_MS = 180;

/**
 * 渲染子分类行（带淡出旧 → 淡入新 过渡）。
 * @param {HTMLElement} subRow
 * @param {string[]} subs
 * @param {string|null} activeSub
 */
function renderSubRow(subRow, subs, activeSub) {
  subRow.classList.add('fade-out');
  setTimeout(() => {
    subRow.innerHTML = '';
    const subLabel = document.createElement('span');
    subLabel.className = 'cat-sub-label';
    subLabel.textContent = '细分';
    subRow.appendChild(subLabel);

    subs.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-chip cat-sub-chip' + (s === activeSub ? ' active' : '');
      b.textContent = s;
      b.dataset.sub = s;
      b.title = `细分模式「${s}」（再次点击取消）`;
      b.addEventListener('click', () => {
        const cur = readState();
        const nextSub = cur.sub === s ? null : s;
        setActiveCategory(cur.main, nextSub);
        subRow.querySelectorAll('.cat-sub-chip').forEach((x) => {
          x.classList.toggle('active', x.dataset.sub === nextSub);
        });
      });
      subRow.appendChild(b);
    });
    subRow.classList.remove('is-hidden', 'fade-out');
  }, SUB_FADE_MS);
}

/**
 * 隐藏子分类行（淡出后收起）。
 * @param {HTMLElement} subRow
 */
function hideSubRow(subRow) {
  subRow.classList.add('fade-out');
  setTimeout(() => {
    subRow.innerHTML = '';
    subRow.classList.add('is-hidden');
    subRow.classList.remove('fade-out');
  }, SUB_FADE_MS);
}

/**
 * 把两级 Chip 渲染进容器并绑定点击/持久化。
 * @param {HTMLElement} container
 */
export function mountCategoryChips(container) {
  if (!container) return;
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '对话模式选择');

  const label = document.createElement('span');
  label.className = 'cat-chips-label';
  label.textContent = '模式';
  container.appendChild(label);

  const mainRow = document.createElement('div');
  mainRow.className = 'cat-chips-row cat-main-row';
  container.appendChild(mainRow);

  const subRow = document.createElement('div');
  subRow.className = 'cat-sub-row is-hidden';
  subRow.setAttribute('aria-live', 'polite');
  container.appendChild(subRow);

  const { main: activeMain, sub: activeSub } = readState();

  MAIN_CATEGORIES.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip cat-main-pill' + (m.id === activeMain ? ' active' : '');
    btn.dataset.main = m.id;
    btn.innerHTML = `<span class="cat-icon">${m.icon}</span>${m.label}`;
    btn.title = `选择「${m.label}」模式（再次点击取消）`;
    btn.addEventListener('click', () => {
      const cur = readState();
      const nextMain = cur.main === m.id ? '' : m.id; // 再次点击当前主分类 = 取消
      setActiveCategory(nextMain, null);
      mainRow.querySelectorAll('.cat-main-pill').forEach((b) => {
        b.classList.toggle('active', b.dataset.main === nextMain);
      });
      if (nextMain) {
        renderSubRow(subRow, m.subs, readState().sub);
      } else {
        hideSubRow(subRow);
      }
    });
    mainRow.appendChild(btn);
  });

  // 初始子分类行（刷新恢复）
  if (activeMain) {
    const m = MAIN_CATEGORIES.find((x) => x.id === activeMain);
    if (m) renderSubRow(subRow, m.subs, activeSub);
  }

  const Q = (typeof window !== 'undefined' && (window.QCLI || (window.QCLI = {})));
  if (Q) {
    Q.getActiveCategory = getActiveCategory;
    Q.setActiveCategory = setActiveCategory;
    Q.getActiveCategoryObj = getActiveCategoryObj;
  }
}
