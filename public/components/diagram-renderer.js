/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// DiagramRenderer — 统一图表渲染器（Mermaid / Graphviz / PlantUML）
//
// 依赖 (CDN in index.html):
//   - Mermaid.js (mermaid.js CDN)
//   - @hpcc-js/wasm (graphviz.umd.js CDN) — Graphviz
//   - @plantuml/core/viz-global.js + 动态 import plantuml.js — PlantUML
//
// 向后兼容:
//   Q.MermaidRenderer = Q.DiagramRenderer (renderAll / init / exportSVG / exportPNG 等方法均可用)
//   .mermaid 元素扫描继续支持 (renderAll 同时扫描 .mermaid 和 .diagram-source)
// ============================================================
// @ts-check
'use strict';

import { getScheme } from '../lib/theme-registry.js';

/** @typedef {import('../types').QCLI} QCLI */
/**
 * @typedef {{_initialized:boolean, _theme:string, _pendingNodes:HTMLElement[], _renderTimer:number|null, _themeObserver:MutationObserver|null, _graphvizLoaded:boolean, _graphvizInstance:any, _plantumlLoaded:boolean, _plantumlRender:Function|null}} DiagramRendererState
 */

const Q = window.QCLI = window.QCLI || {};

// ════════════════════════════════════════════
// 类型常量
// ════════════════════════════════════════════

const DIAGRAM_TYPES = {
  MERMAID: 'mermaid',
  DOT: 'dot',
  GRAPHVIZ: 'graphviz',
  PLANTUML: 'plantuml',
};

const TYPE_LABELS = {
  [DIAGRAM_TYPES.MERMAID]: 'Mermaid',
  [DIAGRAM_TYPES.DOT]: 'Graphviz DOT',
  [DIAGRAM_TYPES.GRAPHVIZ]: 'Graphviz',
  [DIAGRAM_TYPES.PLANTUML]: 'PlantUML',
};

const TYPE_ICONS = {
  [DIAGRAM_TYPES.MERMAID]: '\u{1F4CA}',
  [DIAGRAM_TYPES.DOT]: '\u{1F500}',
  [DIAGRAM_TYPES.GRAPHVIZ]: '\u{1F500}',
  [DIAGRAM_TYPES.PLANTUML]: '\u{1F4D0}',
};

// ════════════════════════════════════════════
// DiagramRenderer 单例
// ════════════════════════════════════════════

const DiagramRenderer = {
  // ── Mermaid 引擎状态 ──
  _initialized: false,
  _theme: 'dark',
  _pendingNodes: [],
  _renderTimer: null,
  _themeObserver: null,

  // ── Graphviz 引擎状态 ──
  _graphvizLoaded: false,
  _graphvizInstance: null,

  // ── PlantUML 引擎状态 ──
  _plantumlLoaded: false,
  _plantumlRender: null,

  // ════════════════════════════════════════════
  // 初始化 — Mermaid 引擎
  // ════════════════════════════════════════════

  /**
   * 初始化 Mermaid 引擎（懒加载，在第一次需要渲染时调用）。
   * @param {'dark'|'light'} [theme]
   */
  init(theme) {
    if (this._initialized) return;
    const mermaid = window.mermaid;
    if (!mermaid) {
      console.warn('[DiagramRenderer] Mermaid.js not loaded yet — will retry');
      setTimeout(() => this.init(theme), 500);
      return;
    }

    this._theme = theme || 'dark';

    mermaid.initialize({
      startOnLoad: false,
      theme: this._theme === 'dark' ? 'dark' : 'default',
      themeVariables: this._theme === 'dark' ? {
        background: 'transparent',
        primaryColor: '#1e3a5f',
        primaryTextColor: '#e0e0e0',
        primaryBorderColor: '#3a6a9f',
        lineColor: '#5a8abf',
        secondaryColor: '#1a2a3a',
        tertiaryColor: '#15202b',
        fontSize: '14px',
      } : {
        background: 'transparent',
        primaryColor: '#d4e8ff',
        primaryTextColor: '#333',
        primaryBorderColor: '#6a9acf',
        lineColor: '#4a7aaa',
        secondaryColor: '#e8f0f8',
        tertiaryColor: '#f0f4f8',
        fontSize: '14px',
      },
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'SimSun', monospace",
    });

    this._initialized = true;
    console.log('[DiagramRenderer] Mermaid initialized, theme:', this._theme);

    this._watchTheme();
  },

  /**
   * 监听 data-theme 属性变化，自动切换主题。
   */
  _watchTheme() {
    if (this._themeObserver) return;
    this._themeObserver = new MutationObserver(() => {
      // 不再用 data-theme==='light' 判断明暗——xuan 是亮色、cyber 是暗色，
      // 直接读 data-scheme（由 applyTheme 同步写入）才是可靠的明/暗来源。
      const mapped = getScheme() === 'dark' ? 'dark' : 'light';
      this.setTheme(mapped);
    });
    this._themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  },

  /**
   * 切换主题并重新渲染所有已存在的图表容器。
   * @param {'dark'|'light'} theme
   */
  setTheme(theme) {
    if (theme === this._theme && this._initialized) return;
    this._theme = theme;
    this._initialized = false;
    // 重新渲染所有 mermaid-container 和 diagram-container 中的 mermaid 图表
    const containers = document.querySelectorAll('.mermaid-container, .diagram-container[data-type="mermaid"]');
    if (containers.length > 0) {
      this.init(theme);
      setTimeout(() => {
        for (const container of containers) {
          const source = container.getAttribute('data-source');
          if (source) {
            this._renderMermaid(container, source);
          }
        }
      }, 100);
    }
  },

  // ════════════════════════════════════════════
  // 统一扫描入口
  // ════════════════════════════════════════════

  /**
   * 扫描并渲染所有未处理的图表元素。
   * 同时支持：
   *   - .diagram-source[data-type="..."] — 多类型图表（终端浮动面板）
   *   - .mermaid — 旧版 Mermaid 元素（聊天面板 Markdown 渲染）
   */
  renderAll() {
    this._scanDiagramSources();
    this._scanMermaidElements();
  },

  /** 扫描 .diagram-source 元素（多类型） */
  _scanDiagramSources() {
    const nodes = document.querySelectorAll('.diagram-source:not([data-rendered])');
    if (nodes.length === 0) return;

    for (const node of nodes) {
      const type = node.getAttribute('data-type') || DIAGRAM_TYPES.MERMAID;
      const source = node.textContent.trim();
      if (!source) {
        node.setAttribute('data-rendered', 'empty');
        continue;
      }

      const container = document.createElement('div');
      container.className = 'diagram-container';
      container.setAttribute('data-source', source);
      container.setAttribute('data-type', type);
      node.parentNode.replaceChild(container, node);

      this.renderSingle(container, type, source);
    }
  },

  /** 扫描 .mermaid 元素（旧版 Mermaid 向后兼容） */
  _scanMermaidElements() {
    const nodes = document.querySelectorAll('.mermaid:not([data-rendered])');
    if (nodes.length === 0) return;

    const mermaid = window.mermaid;
    if (!mermaid) {
      for (const node of nodes) {
        this._pendingNodes.push(node);
      }
      if (!this._renderTimer) {
        this._renderTimer = setInterval(() => {
          if (window.mermaid) {
            clearInterval(this._renderTimer);
            this._renderTimer = null;
            this.init(Q._theme || this._theme);
            this._flushPending();
          }
        }, 500);
        setTimeout(() => {
          if (this._renderTimer) {
            clearInterval(this._renderTimer);
            this._renderTimer = null;
            for (const node of this._pendingNodes) {
              node.setAttribute('data-rendered', 'error');
              node.innerHTML = '<div class="mermaid-error">\u26A0\uFE0F Mermaid \u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u65E0\u6CD5\u6E32\u67D3\u6D41\u7A0B\u56FE</div>';
            }
            this._pendingNodes = [];
          }
        }, 30000);
      }
      return;
    }

    this.init(Q._theme || this._theme);

    for (const node of nodes) {
      const source = node.textContent.trim();
      if (!source) {
        node.setAttribute('data-rendered', 'empty');
        continue;
      }
      // 创建同时拥有两个类名的容器：新路径用 .diagram-container，旧 CSS 用 .mermaid-container
      const wrapper = document.createElement('div');
      wrapper.className = 'diagram-container mermaid-container';
      wrapper.setAttribute('data-source', source);
      wrapper.setAttribute('data-type', 'mermaid');
      node.parentNode.replaceChild(wrapper, node);
      // 通过统一 renderSingle 路由渲染
      this.renderSingle(wrapper, 'mermaid', source);
    }
  },

  /** 处理待渲染队列（Mermaid 延迟加载） */
  _flushPending() {
    for (const node of this._pendingNodes) {
      const source = node.getAttribute('data-source') || node.textContent.trim();
      if (source) {
        // 创建统一容器
        const wrapper = document.createElement('div');
        wrapper.className = 'diagram-container mermaid-container';
        wrapper.setAttribute('data-source', source);
        wrapper.setAttribute('data-type', 'mermaid');
        node.parentNode.replaceChild(wrapper, node);
        this.renderSingle(wrapper, 'mermaid', source);
      }
    }
    this._pendingNodes = [];
  },

  // ════════════════════════════════════════════
  // 渲染单个图表（按类型分发）
  // ════════════════════════════════════════════

  /**
   * 渲染单个图表到指定容器。
   * @param {HTMLElement} container
   * @param {string} type
   * @param {string} source
   * @returns {Promise<void>}
   */
  async renderSingle(container, type, source) {
    switch (type) {
      case DIAGRAM_TYPES.MERMAID:
        await this._renderMermaid(container, source);
        break;
      case DIAGRAM_TYPES.DOT:
      case DIAGRAM_TYPES.GRAPHVIZ:
        await this._renderGraphviz(container, source);
        break;
      case DIAGRAM_TYPES.PLANTUML:
        await this._renderPlantUML(container, source);
        break;
      default:
        container.innerHTML = this._errorHTML(source, '\u4E0D\u652F\u6301\u7684\u56FE\u8868\u7C7B\u578B: ' + this._escapeHtml(type));
        container.setAttribute('data-rendered', 'error');
    }
  },

  /**
   * 获取图表类型的显示信息。
   * @param {string} type
   * @returns {{ icon: string, label: string }}
   */
  getTypeInfo(type) {
    const key = type?.toLowerCase() || '';
    return {
      icon: TYPE_ICONS[key] || '\u{1F4CA}',
      label: TYPE_LABELS[key] || 'Diagram',
    };
  },

  // ════════════════════════════════════════════
  // Mermaid 渲染（直接调用 mermaid API）
  // ════════════════════════════════════════════

  /**
   * 渲染 Mermaid 图表到 .diagram-container（新路径）。
   * 直接调用 mermaid.render()，不再委托。
   */
  async _renderMermaid(container, source) {
    const mermaid = window.mermaid;
    if (!mermaid) {
      container.innerHTML = this._errorHTML(source, 'Mermaid \u5E93\u672A\u52A0\u8F7D');
      container.setAttribute('data-rendered', 'error');
      return;
    }

    this.init(Q._theme || this._theme);

    const id = 'dia-mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    try {
      const result = await mermaid.render(id, source);
      container.innerHTML = result.svg;
      container.setAttribute('data-rendered', 'done');
      this._postRender(container);
    } catch (err) {
      console.warn('[DiagramRenderer] Mermaid error:', err.message);
      container.innerHTML = this._errorHTML(source, '\u6D41\u7A0B\u56FE\u89E3\u6790\u5931\u8D25: ' + this._escapeHtml(err.message));
      container.setAttribute('data-rendered', 'error');
    }
  },

  /* _renderSingleMermaid 已合并到 _renderMermaid + _scanMermaidElements 使用统一 renderSingle() 路径 */

  // ════════════════════════════════════════════
  // Graphviz 渲染
  // ════════════════════════════════════════════

  async _ensureGraphviz() {
    if (this._graphvizLoaded) return;
    const hpccWasm = window.hpccWasm;
    if (!hpccWasm?.graphviz) {
      return new Promise((resolve) => {
        const check = () => {
          if (window.hpccWasm?.graphviz) {
            resolve();
          } else {
            setTimeout(check, 300);
          }
        };
        check();
      });
    }
    try {
      this._graphvizInstance = await hpccWasm.graphviz.load();
      this._graphvizLoaded = true;
      console.log('[DiagramRenderer] Graphviz engine loaded');
    } catch (err) {
      console.error('[DiagramRenderer] Failed to load Graphviz:', err);
      throw new Error('Graphviz \u5F15\u64CE\u52A0\u8F7D\u5931\u8D25');
    }
  },

  async _renderGraphviz(container, source) {
    try {
      await this._ensureGraphviz();
      const svg = this._graphvizInstance.dot(source, 'svg');
      container.innerHTML = svg;
      container.setAttribute('data-rendered', 'done');
      this._postRender(container);
    } catch (err) {
      console.warn('[DiagramRenderer] Graphviz error:', err.message);
      container.innerHTML = this._errorHTML(source, 'Graphviz \u6E32\u67D3\u5931\u8D25: ' + this._escapeHtml(err.message));
      container.setAttribute('data-rendered', 'error');
    }
  },

  // ════════════════════════════════════════════
  // PlantUML 渲染
  // ════════════════════════════════════════════

  async _ensurePlantUML() {
    if (this._plantumlLoaded) return;
    await this._ensureGraphviz();
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@plantuml/core@1.2026.6/plantuml.js');
      this._plantumlRender = mod.render;
      this._plantumlLoaded = true;
      console.log('[DiagramRenderer] PlantUML engine loaded');
    } catch (err) {
      console.error('[DiagramRenderer] Failed to load PlantUML:', err);
      throw new Error('PlantUML \u5F15\u64CE\u52A0\u8F7D\u5931\u8D25');
    }
  },

  async _renderPlantUML(container, source) {
    try {
      await this._ensurePlantUML();
      const id = 'puml-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

      const renderTarget = document.createElement('div');
      renderTarget.id = id;
      container.appendChild(renderTarget);

      const lines = source.split(/\r\n|\r|\n/);
      const isDark = getScheme() === 'dark';
      this._plantumlRender(lines, id, { dark: isDark });

      container.setAttribute('data-rendered', 'done');
      this._postRender(container);
    } catch (err) {
      console.warn('[DiagramRenderer] PlantUML error:', err.message);
      container.innerHTML = this._errorHTML(source, 'PlantUML \u6E32\u67D3\u5931\u8D25: ' + this._escapeHtml(err.message));
      container.setAttribute('data-rendered', 'error');
    }
  },

  // ════════════════════════════════════════════
  // 通用后处理
  // ════════════════════════════════════════════

  /** 渲染后处理：点击缩放、导出工具栏等。 */
  _postRender(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    svg.style.maxWidth = '100%';
    svg.style.height = 'auto';
    svg.style.cursor = 'zoom-in';
    svg.addEventListener('click', () => {
      if (svg.classList.contains('diagram-zoomed')) {
        svg.classList.remove('diagram-zoomed');
        svg.style.maxWidth = '100%';
        svg.style.cursor = 'zoom-in';
      } else {
        svg.classList.add('diagram-zoomed');
        svg.style.maxWidth = 'none';
        svg.style.width = 'auto';
        svg.style.cursor = 'zoom-out';
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    this._addToolbar(container);
  },

  /** 添加导出工具栏（SVG 下载 + PNG 下载 + 复制 SVG）。 */
  _addToolbar(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'diagram-export-bar';

    // 复制 SVG 到剪贴板
    const copyBtn = document.createElement('button');
    copyBtn.className = 'de-btn de-btn-copy';
    copyBtn.title = '\u590D\u5236 SVG \u5230\u526A\u8D34\u677F';
    copyBtn.textContent = '\u{1F4CB}';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copySVG(svg, copyBtn);
    });
    toolbar.appendChild(copyBtn);

    // 导出 SVG 文件
    const svgBtn = document.createElement('button');
    svgBtn.className = 'de-btn de-btn-svg';
    svgBtn.title = '\u5BFC\u51FA\u4E3A SVG';
    svgBtn.textContent = '\u2B07 SVG';
    svgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportSVG(container);
    });
    toolbar.appendChild(svgBtn);

    // 导出 PNG 文件
    const pngBtn = document.createElement('button');
    pngBtn.className = 'de-btn de-btn-png';
    pngBtn.title = '\u5BFC\u51FA\u4E3A PNG\uFF082x \u9AD8\u6E05\uFF09';
    pngBtn.textContent = '\u2B07 PNG';
    pngBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportPNG(container);
    });
    toolbar.appendChild(pngBtn);

    container.appendChild(toolbar);
  },

  // ════════════════════════════════════════════
  // 导出方法
  // ════════════════════════════════════════════

  /**
   * 复制 SVG 到剪贴板。
   * @param {SVGSVGElement} svg
   * @param {HTMLElement} [btn] - 可选反馈按钮
   */
  copySVG(svg, btn) {
    const serializer = new XMLSerializer();
    const svgContent = serializer.serializeToString(svg);
    navigator.clipboard.writeText(svgContent).then(() => {
      if (Q.showToast) Q.showToast('\u2705 SVG \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F', 'success');
      if (btn) {
        btn.textContent = '\u2705';
        setTimeout(() => { btn.textContent = '\u{1F4CB}'; }, 1500);
      }
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = svgContent;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (Q.showToast) Q.showToast('\u2705 SVG \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F', 'success');
      if (btn) {
        btn.textContent = '\u2705';
        setTimeout(() => { btn.textContent = '\u{1F4CB}'; }, 1500);
      }
    });
  },

  /**
   * 导出为 SVG 文件下载。
   * @param {HTMLElement} container - .mermaid-container 或 .diagram-container
   * @param {string} [filename='diagram']
   */
  exportSVG(container, filename = 'diagram') {
    const svg = container?.querySelector('svg');
    if (!svg) {
      if (Q.showToast) Q.showToast('\u26A0\uFE0F \u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u56FE\u8868', 'error');
      return;
    }
    const serializer = new XMLSerializer();
    const svgContent = serializer.serializeToString(svg);
    const svgBlob = new Blob([
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n',
      svgContent
    ], { type: 'image/svg+xml;charset=utf-8' });

    const url = URL.createObjectURL(svgBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    if (Q.showToast) Q.showToast('\u2705 \u5DF2\u5BFC\u51FA ' + filename + '.svg', 'success');
  },

  /**
   * 导出为 PNG 文件下载（2x 高清）。
   * @param {HTMLElement} container
   * @param {string} [filename='diagram']
   * @param {number} [scale=2]
   */
  exportPNG(container, filename = 'diagram', scale = 2) {
    const svg = container?.querySelector('svg');
    if (!svg) {
      if (Q.showToast) Q.showToast('\u26A0\uFE0F \u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u56FE\u8868', 'error');
      return;
    }

    Q.showToast?.('\u23F3 \u6B63\u5728\u751F\u6210 PNG...', 'info');

    const bbox = svg.getBBox ? svg.getBBox() : null;
    const width = parseFloat(svg.getAttribute('width') || bbox?.width || svg.clientWidth) || 800;
    const height = parseFloat(svg.getAttribute('height') || bbox?.height || svg.clientHeight) || 600;

    const serializer = new XMLSerializer();
    let svgContent = serializer.serializeToString(svg);
    if (!svgContent.includes('viewBox=')) {
      svgContent = svgContent.replace('<svg', '<svg viewBox="0 0 ' + width + ' ' + height + '"');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');

    const isDark = getScheme() === 'dark';
    ctx.fillStyle = isDark ? '#1a1b1e' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    const img = new Image();
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          if (Q.showToast) Q.showToast('\u26A0\uFE0F PNG \u751F\u6210\u5931\u8D25', 'error');
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = filename + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 5000);
        if (Q.showToast) Q.showToast('\u2705 \u5DF2\u5BFC\u51FA ' + filename + '.png (' + (blob.size / 1024).toFixed(1) + 'KB)', 'success');
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (Q.showToast) Q.showToast('\u26A0\uFE0F PNG \u5BFC\u51FA\u5931\u8D25\uFF1ASVG \u6E32\u67D3\u5F02\u5E38', 'error');
    };

    img.src = url;
  },

  /**
   * 查找最近的图表容器祖先。
   * @param {HTMLElement} el
   * @returns {HTMLElement|null}
   */
  findContainer(el) {
    return el?.closest('.mermaid-container, .diagram-container');
  },

  // ════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════

  _errorHTML(source, message) {
    return '<div class="diagram-error">'
      + '<span class="diagram-error-icon">\u26A0\uFE0F</span>'
      + '<span class="diagram-error-text">' + this._escapeHtml(message) + '</span>'
      + '<details class="diagram-error-details">'
      + '<summary>\u67E5\u770B\u539F\u6587</summary>'
      + '<pre><code>' + this._escapeHtml(source) + '</code></pre>'
      + '</details></div>';
  },

  _escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => map[c]);
  },
};

// ── 向后兼容：Q.MermaidRenderer 别名指向 Q.DiagramRenderer ──
Q.DiagramRenderer = DiagramRenderer;
Q.MermaidRenderer = DiagramRenderer;

export default DiagramRenderer;
