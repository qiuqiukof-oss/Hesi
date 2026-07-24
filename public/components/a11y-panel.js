// ============================================================
// <a11y-panel> — 无障碍分析面板
//
// 在当前页面上运行可访问性审核，展示问题和得分。
// 通过 UIRegistry 注册。
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

function Q() { return window.QCLI || {}; }

let _a11yData = null;
/** @type {{ panel:HTMLElement, list:HTMLElement|null, scoreBar:HTMLElement|null }} */
let dom = null;

async function runAudit() {
  try {
    const resp = await fetch('/api/browser/accessibility', { method: 'POST' });
    return await resp.json();
  } catch (err) { return { success: false, error: err.message }; }
}

function renderIssues() {
  if (!dom || !dom.list) return;

  if (!_a11yData || !_a11yData.issues || _a11yData.issues.length === 0) {
    dom.list.innerHTML = '<div class="a11y-empty"><div class="a11y-empty-icon">✅</div><p>未发现无障碍问题</p></div>';
    return;
  }

  // Group by category
  const categories = {};
  for (const issue of _a11yData.issues) {
    const cat = issue.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(issue);
  }

  const catLabels = {
    page: '📄 页面结构', image: '🖼️ 图片', form: '📝 表单',
    heading: '📑 标题层级', keyboard: '⌨️ 键盘', contrast: '🎨 对比度',
    aria: '♿ ARIA', other: '📌 其他',
  };

  let html = '';
  for (const [cat, issues] of Object.entries(categories)) {
    html += `<div class="a11y-category">
      <div class="a11y-category-header">${catLabels[cat] || cat} <span class="a11y-category-count">${issues.length}</span></div>`;

    for (const issue of issues) {
      const sevIcons = { high: '🔴', medium: '🟡', low: '🟢', info: '🔵' };
      html += `<div class="a11y-issue ${issue.severity || 'info'}">
        <div class="a11y-issue-header">
          <span class="a11y-issue-icon">${sevIcons[issue.severity] || '🔵'}</span>
          <span class="a11y-issue-code">${issue.code || ''}</span>
          <span class="a11y-issue-severity">${issue.severity || ''}</span>
        </div>
        <div class="a11y-issue-message">${escapeHtml(issue.message)}</div>
        ${issue.selector ? `<div class="a11y-issue-selector">${escapeHtml(issue.selector)}</div>` : ''}
      </div>`;
    }

    html += `</div>`;
  }

  dom.list.innerHTML = html;
}

function updateScoreBar() {
  if (!dom || !dom.scoreBar) return;
  if (!_a11yData) {
    dom.scoreBar.innerHTML = '<span class="a11y-stat">点击「运行分析」开始</span>';
    return;
  }

  const score = _a11yData.score || 0;
  const stats = _a11yData.stats || {};
  const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';

  dom.scoreBar.innerHTML = `
    <div class="a11y-score-bar">
      <div class="a11y-score-circle" style="border-color: ${scoreColor}; color: ${scoreColor};">${score}</div>
      <div class="a11y-score-details">
        <span class="a11y-stat">🔴 错误: ${stats.error || 0}</span>
        <span class="a11y-stat">🟡 警告: ${stats.warning || 0}</span>
        <span class="a11y-stat">🔵 提示: ${stats.info || 0}</span>
      </div>
    </div>
    <div class="a11y-url">${escapeHtml(_a11yData.url || '')}</div>
  `;
}

function init(container) {
  container.innerHTML = `
    <div class="a11y-panel">
      <div class="a11y-toolbar">
        <button class="a11y-btn primary" id="a11y-run-btn">♿ 运行分析</button>
        <button class="a11y-btn" id="a11y-clear-btn">🗑 清除</button>
      </div>
      <div class="a11y-score-bar" id="a11y-score-bar">
        <span class="a11y-stat">点击「运行分析」开始</span>
      </div>
      <div class="a11y-list" id="a11y-list">
        <div class="a11y-empty"><div class="a11y-empty-icon">♿</div><p>运行可访问性分析</p></div>
      </div>
    </div>
  `;

  dom = {
    panel: container,
    list: container.querySelector('#a11y-list'),
    scoreBar: container.querySelector('#a11y-score-bar'),
  };

  container.querySelector('#a11y-run-btn').addEventListener('click', async () => {
    const btn = container.querySelector('#a11y-run-btn');
    btn.disabled = true;
    btn.textContent = '⏳ 分析中...';

    const result = await runAudit();
    if (result.success) {
      _a11yData = result;
      updateScoreBar();
      renderIssues();
      const toast = Q().showToast;
      if (toast) toast(`♿ 无障碍评分: ${result.score}/100 (${result.issueCount} 个问题)`, result.score >= 80 ? 'success' : 'info');
    } else {
      const toast = Q().showToast;
      if (toast) toast('分析失败: ' + (result.error || ''), 'error');
    }

    btn.disabled = false;
    btn.textContent = '♿ 运行分析';
  });

  container.querySelector('#a11y-clear-btn').addEventListener('click', () => {
    _a11yData = null;
    dom.list.innerHTML = '<div class="a11y-empty"><div class="a11y-empty-icon">♿</div><p>运行可访问性分析</p></div>';
    updateScoreBar();
  });
}

// ── UIRegistry Registration ──
(function register() {
  const Qq = window.QCLI || {};
  const UIR = Qq.UIRegistry;
  if (!UIR) { setTimeout(register, 500); return; }

  UIR.registerTab('accessibility', {
    icon: '♿',
    label: '无障碍',
    category: 'other',
    order: 50,
    render: (container) => init(container),
  });

  UIR.registerCommand('accessibility:open', {
    icon: '♿',
    name: '打开无障碍分析',
    desc: '运行可访问性审核',
    category: 'browser',
    execute: () => {
      const rp = Qq.RightPanel;
      if (rp) { if (rp.collapsed) rp.open(); rp.switchTab('accessibility'); }
    },
  });

  console.log('[A11y] Panel registered');
})();
