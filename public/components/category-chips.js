// @ts-check
'use strict';
// ============================================================
// category-chips — 聊天面板「对话模式」快速选择条（小功能）
// 6 分类：日常开发 / 网站开发 / Agent 应用 / Skill 开发 / CI/CD / 文档
//
// 设计（与 savings-icon / context-usage 同款增量模式）：
// - 纯前端组件，零核心链路改动；未选时后端零注入，行为不变。
// - 状态持久化到 localStorage('qcli-active-category')，刷新保留。
// - 通过 window.QCLI.getActiveCategory / setActiveCategory 暴露，
//   供 chat-panel 发消息时带 category、后端注入 [当前模式] 系统提示段。
// - 预留同类 Skill 优先接口（getActiveCategory 供后续检索加权使用）。
// ============================================================

/** @typedef {{ id: string, label: string }} Category */

/** @type {Category[]} */
export const CATEGORIES = [
  { id: 'daily', label: '日常开发' },
  { id: 'web', label: '网站开发' },
  { id: 'agent', label: 'Agent 应用' },
  { id: 'skill', label: 'Skill 开发' },
  { id: 'cicd', label: 'CI/CD' },
  { id: 'docs', label: '文档' },
];

const LS_KEY = 'qcli-active-category';

/** @returns {string} 当前激活的分类 id（空串表示未选） */
export function getActiveCategory() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return CATEGORIES.some((c) => c.id === v) ? String(v) : '';
  } catch {
    return '';
  }
}

/**
 * 设置当前激活分类（传空串取消）。
 * @param {string} id
 */
export function setActiveCategory(id) {
  const next = CATEGORIES.some((c) => c.id === id) ? id : '';
  try {
    if (next) localStorage.setItem(LS_KEY, next);
    else localStorage.removeItem(LS_KEY);
  } catch { /* localStorage 不可用时静默 */ }
  const Q = (typeof window !== 'undefined' && (window.QCLI || (window.QCLI = {})));
  if (Q) { Q.getActiveCategory = getActiveCategory; Q.setActiveCategory = setActiveCategory; }
}

/**
 * 把 6 个 Chip 渲染进容器，并绑定点击/持久化。
 * @param {HTMLElement} container
 */
export function mountCategoryChips(container) {
  if (!container) return;
  container.innerHTML = '';
  container.setAttribute('role', 'group');

  const label = document.createElement('span');
  label.className = 'cat-chips-label';
  label.textContent = '模式';
  container.appendChild(label);

  const row = document.createElement('div');
  row.className = 'cat-chips-row';
  const active = getActiveCategory();

  CATEGORIES.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip' + (c.id === active ? ' active' : '');
    btn.textContent = c.label;
    btn.dataset.cat = c.id;
    btn.title = `将本会话标记为「${c.label}」模式（再次点击取消）`;
    btn.addEventListener('click', () => {
      const cur = getActiveCategory();
      const next = cur === c.id ? '' : c.id; // 再次点击当前项 = 取消
      setActiveCategory(next);
      row.querySelectorAll('.cat-chip').forEach((b) => {
        b.classList.toggle('active', b.dataset.cat === next);
      });
    });
    row.appendChild(btn);
  });

  container.appendChild(row);

  const Q = (typeof window !== 'undefined' && (window.QCLI || (window.QCLI = {})));
  if (Q) { Q.getActiveCategory = getActiveCategory; Q.setActiveCategory = setActiveCategory; }
}
