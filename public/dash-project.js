/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Project Analysis — File stats, language distribution
// ============================================================

import { setText, escapeHtml } from './dash-utils.js';

/** @type {Object|null} */
let _projectData = null;
/** @type {boolean} */
let _projectLoadAttempted = false;

export { _projectData, _projectLoadAttempted };

/** Reset project data (for manual refresh) */
export function resetProjectData() {
  _projectLoadAttempted = false;
  _projectData = null;
}

/** Fetch project analysis from server */
export async function loadProjectAnalysis() {
  if (_projectLoadAttempted) return _projectData;
  _projectLoadAttempted = true;
  try {
    const resp = await fetch('/api/project/analyze');
    if (resp.ok) {
      const data = await resp.json();
      if (data.success) {
        _projectData = data;
        return data;
      }
    }
  } catch (e) { console.debug('[Dashboard] load project analysis:', e?.message); }
  return null;
}

/** Update project analysis UI */
export async function updateProjectAnalysis() {
  const data = await loadProjectAnalysis();
  const badge = document.getElementById('dash-project-badge');
  if (!badge) return;

  if (!data) {
    badge.textContent = '不可用';
    setText('dash-project-lang', '—');
    setText('dash-project-files', '—');
    setText('dash-project-loc', '—');
    return;
  }

  badge.textContent = data.stats.totalFiles + ' 文件';
  badge.removeAttribute('style');

  setText('dash-project-lang', data.mainLanguage.name + (data.mainLanguage.fileCount > 0 ? ' (' + data.mainLanguage.fileCount + ')' : ''));
  setText('dash-project-files', data.stats.totalFiles + ' 文件 / ' + data.stats.totalDirs + ' 目录');

  if (data.stats.sourceLOC > 0) {
    setText('dash-project-loc', data.stats.sourceLOC.toLocaleString() + ' 行');
  } else {
    setText('dash-project-loc', '—');
  }

  // File type distribution
  const typeGrid = document.getElementById('dash-project-types');
  if (typeGrid && data.categories) {
    const icons = { source: '📫', markup: '📑', style: '🎹', config: '⚙️', data: '🗂️', media: '🎬', docs: '📄', other: '📦' };
    const labels = { source: '源码', markup: '标记', style: '样式', config: '配置', data: '数据', media: '媒体', docs: '文档', other: '其他' };
    const cats = data.categories;
    typeGrid.innerHTML = Object.keys(cats).filter(k => cats[k] > 0).map(k => `
      <div class=\"dash-project-type-item\">
        <span class=\"dash-project-type-icon\">${icons[k] || '📦'}</span>
        <span class=\"dash-project-type-value\">${cats[k]}</span>
        <span class=\"dash-project-type-label\">${labels[k] || k}</span>
      </div>
    `).join('');
  }

  // Key config files
  const keyFilesEl = document.getElementById('dash-project-keyfiles');
  if (keyFilesEl && data.keyFiles && data.keyFiles.length > 0) {
    keyFilesEl.innerHTML = '<div class=\"dash-project-section-label\">📁 检测到配置文件</div>' +
      data.keyFiles.map(kf => `
        <div class=\"dash-project-kf-item\">
          <span class=\"dash-project-kf-name\">${escapeHtml(kf.name)}</span>
          <span class=\"dash-project-kf-label\">${escapeHtml(kf.label)}</span>
        </div>
      `).join('');
  } else if (keyFilesEl) {
    keyFilesEl.innerHTML = '';
  }
}
