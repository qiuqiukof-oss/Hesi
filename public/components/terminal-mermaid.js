/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// TerminalMermaid — 从终端输出中检测图表并渲染为浮动浮层
//
// 支持检测的块类型:
//   ```mermaid    — Mermaid 流程图
//   ```dot        — Graphviz DOT 图
//   ```graphviz   — Graphviz 图
//   ```plantuml   — PlantUML 图
//
// 依赖: DiagramRenderer (public/components/diagram-renderer.js)
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */

const Q = window.QCLI = window.QCLI || {};

/** 支持的代码块类型列表 */
const SUPPORTED_TYPES = ['mermaid', 'dot', 'graphviz', 'plantuml'];

/** @type {Map<string, { inBlock: boolean, blockLines: string[], type: string|null }>} */
const _tabBuffers = new Map();

/** @type {HTMLDivElement|null} */
let _floatingPanel = null;

/** 最大行数限制，防止块永不关闭导致内存泄漏 */
const MAX_BLOCK_LINES = 200;

/**
 * 扫描终端输出的纯文本，检测图表代码块。
 * 每次收到新 output 数据时调用（在写入终端之后）。
 *
 * @param {string} tabId - 当前 tab ID
 * @param {string} plainText - 去除 ANSI 转义序列后的纯文本
 */
function feedOutput(tabId, plainText) {
  if (!plainText) return;
  // 快速过滤：只有包含支持类型关键字时才处理
  const hasKeyword = SUPPORTED_TYPES.some(t => plainText.includes(t));
  if (!hasKeyword) return;

  // 获取或创建该 tab 的缓冲区
  let buf = _tabBuffers.get(tabId);
  if (!buf) {
    buf = { inBlock: false, blockLines: [], type: null };
    _tabBuffers.set(tabId, buf);
  }

  // 按行分割
  const newLines = plainText.split('\n');
  for (const line of newLines) {
    const trimmed = line.trim();

    // 检测块开始：```type (仅支持 type in SUPPORTED_TYPES)
    const startMatch = trimmed.match(/^```(mermaid|dot|graphviz|plantuml)\s*$/i);
    if (startMatch) {
      buf.inBlock = true;
      buf.type = startMatch[1].toLowerCase();
      buf.blockLines = [];
      continue;
    }

    // 检测块结束（在块内遇到 ```）
    if (buf.inBlock && /^```/.test(trimmed)) {
      buf.inBlock = false;
      const source = buf.blockLines.join('\n').trim();
      if (source && buf.type) {
        _showDiagram(source, buf.type, tabId);
      }
      buf.blockLines = [];
      buf.type = null;
      continue;
    }

    // 在块内：收集行（上限防内存泄漏）
    if (buf.inBlock) {
      if (buf.blockLines.length >= MAX_BLOCK_LINES) {
        // 超过上限，放弃该块
        buf.inBlock = false;
        buf.blockLines = [];
        buf.type = null;
      } else {
        buf.blockLines.push(line);
      }
    }
  }
}

/**
 * 显示浮动图表面板。
 * @param {string} source - 图表源码
 * @param {string} type - 图表类型
 * @param {string} tabId - 标签 ID
 */
function _showDiagram(source, type, tabId) {
  // 创建或获取浮动面板
  if (!_floatingPanel) {
    _floatingPanel = document.createElement('div');
    _floatingPanel.className = 'terminal-mermaid-float';
    _floatingPanel.id = 'terminal-mermaid-float';
    document.getElementById('terminal-container')?.appendChild(_floatingPanel);

    // 点击背景关闭
    _floatingPanel.addEventListener('click', (e) => {
      if (e.target === _floatingPanel) _hideDiagram();
    });

    // Esc 键关闭
    document.addEventListener('keydown', _onEscKey);
  }

  // 获取类型显示信息
  const typeInfo = Q.DiagramRenderer
    ? Q.DiagramRenderer.getTypeInfo(type)
    : { icon: '📊', label: type || 'Diagram' };

  const displayType = typeInfo.label;
  const displayIcon = typeInfo.icon;

  _floatingPanel.innerHTML = `
    <div class="tmf-header">
      <span class="tmf-title">${displayIcon} ${displayType}</span>
      <span class="tmf-tab">${tabId ? 'Tab: ' + tabId.substring(0, 8) : ''}</span>
      <span class="tmf-type-badge">${type}</span>
      <div class="tmf-actions">
        <button class="tmf-btn tmf-btn-zoom" title="在新标签页打开">🔗</button>
        <button class="tmf-btn tmf-btn-copy" title="复制 SVG 到剪贴板">📋</button>
        <button class="tmf-btn tmf-btn-close" title="关闭 (Esc)">✕</button>
      </div>
    </div>
    <div class="tmf-body">
      <div class="diagram-source" data-type="${type}">${escapeHtml(source)}</div>
    </div>
  `;

  _floatingPanel.classList.remove('hidden');

  // 使用统一 DiagramRenderer 渲染
  requestAnimationFrame(() => {
    if (Q.DiagramRenderer) {
      Q.DiagramRenderer.renderAll();
    } else if (Q.MermaidRenderer && type === 'mermaid') {
      // 降级：仅支持 mermaid
      Q.MermaidRenderer.renderAll();
    }
  });

  // 缩放按钮
  const zoomBtn = _floatingPanel.querySelector('.tmf-btn-zoom');
  if (zoomBtn) {
    zoomBtn.addEventListener('click', () => {
      const svg = _floatingPanel?.querySelector('.diagram-container svg, .mermaid-container svg');
      if (svg) {
        svg.classList.toggle('diagram-zoomed');
        svg.style.maxWidth = svg.classList.contains('diagram-zoomed') ? 'none' : '100%';
        svg.style.cursor = svg.classList.contains('diagram-zoomed') ? 'zoom-out' : 'zoom-in';
      }
    });
  }

  // 复制 SVG 按钮
  const copyBtn = _floatingPanel.querySelector('.tmf-btn-copy');
  if (copyBtn && Q.DiagramRenderer) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const svg = _floatingPanel?.querySelector('.diagram-container svg, .mermaid-container svg');
      if (!svg) {
        if (Q.showToast) Q.showToast('⚠️ 没有可复制的图表', 'error');
        return;
      }
      Q.DiagramRenderer.copySVG(svg, copyBtn);
    });
  }

  // 关闭按钮
  const closeBtn = _floatingPanel.querySelector('.tmf-btn-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', _hideDiagram);
  }

  // 自动淡出
  clearTimeout(_floatingPanel._fadeTimer);
  _floatingPanel._fadeTimer = setTimeout(() => {
    if (_floatingPanel && !_floatingPanel.classList.contains('hidden')) {
      _floatingPanel.style.opacity = '0.85';
    }
  }, 8000);

  // 鼠标移入恢复不透明度
  _floatingPanel.onmouseenter = () => { _floatingPanel.style.opacity = '1'; };
  _floatingPanel.onmouseleave = () => {
    clearTimeout(_floatingPanel._fadeTimer);
    _floatingPanel._fadeTimer = setTimeout(() => {
      _floatingPanel.style.opacity = '0.85';
    }, 3000);
  };
}

/** 隐藏图表面板 */
function _hideDiagram() {
  if (_floatingPanel) {
    _floatingPanel.classList.add('hidden');
    _floatingPanel.style.opacity = '1';
  }
}

/** Esc 键关闭 */
function _onEscKey(e) {
  if (e.key === 'Escape' && _floatingPanel && !_floatingPanel.classList.contains('hidden')) {
    _hideDiagram();
  }
}

/** 清理某个 tab 的缓冲区（tab 关闭时调用） */
function cleanupTab(tabId) {
  _tabBuffers.delete(tabId);
}

/** 清理所有内容 */
function cleanupAll() {
  _tabBuffers.clear();
  if (_floatingPanel) {
    _floatingPanel.remove();
    _floatingPanel = null;
  }
  document.removeEventListener('keydown', _onEscKey);
}

// ── 导出 ──
const TerminalMermaid = { feedOutput, cleanupTab, cleanupAll, _hideDiagram };
Q.TerminalMermaid = TerminalMermaid;

export default TerminalMermaid;
