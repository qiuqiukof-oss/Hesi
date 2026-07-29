// ============================================================
// Mermaid 实时预览（从 chat-panel.js 抽离，P2 拆分）
//
// 两种模式混合：
//   - 纯函数：extractMermaidCode / escapeHtml（不依赖 this）
//   - 原型 mixin：mermaidPreviewMixin（_init/_check/_do/_clear），
//     在 chat-panel.js 里 Object.assign(ChatPanel.prototype, mermaidPreviewMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

/** 从文本中提取 mermaid 代码（纯函数） */
export function extractMermaidCode(text) {
  const regex = /```mermaid\n?([\s\S]*?)```/i;
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

/** HTML 转义（纯函数） */
export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, c => map[c]);
}

export const mermaidPreviewMixin = {
  /** 初始化预览面板 DOM */
  _initMermaidPreview() {
    if (this.mermaidPreviewEl) return;
    this.mermaidPreviewEl = document.createElement('div');
    this.mermaidPreviewEl.className = 'mermaid-preview-panel hidden';
    this.mermaidPreviewEl.innerHTML = `
      <div class="mermaid-preview-header">
        <span class="mermaid-preview-title">📐 Mermaid 预览</span>
        <button class="mermaid-preview-close" title="关闭预览">✕</button>
      </div>
      <div class="mermaid-preview-body"></div>
    `;
    // 插入到聊天消息区和输入区之间
    if (this.msgsEl && this.msgsEl.parentElement) {
      this.msgsEl.parentElement.insertBefore(this.mermaidPreviewEl, this.input?.closest('.chat-input-area') || this.msgsEl.nextSibling);
    } else if (this.el) {
      this.el.appendChild(this.mermaidPreviewEl);
    }

    // 关闭按钮
    const closeBtn = this.mermaidPreviewEl.querySelector('.mermaid-preview-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._clearMermaidPreview());
    }
  },

  /** 防抖检测 Mermaid 代码并渲染预览 */
  _checkMermaidPreview() {
    if (this._mermaidPreviewTimer) {
      clearTimeout(this._mermaidPreviewTimer);
    }
    this._mermaidPreviewTimer = setTimeout(() => {
      this._mermaidPreviewTimer = null;
      this._doMermaidPreview();
    }, 300);
  },

  /** 实际渲染预览 */
  _doMermaidPreview() {
    if (!this.input || !this.mermaidPreviewEl) return;
    const text = this.input.value;
    const code = extractMermaidCode(text);
    const body = this.mermaidPreviewEl.querySelector('.mermaid-preview-body');
    if (!body) return;

    if (!code) {
      this._clearMermaidPreview();
      return;
    }

    // 显示预览面板
    this.mermaidPreviewEl.classList.remove('hidden');

    // 渲染 Mermaid
    body.innerHTML = `<div class="mermaid-preview-content"><div class="mermaid">${escapeHtml(code)}</div></div>`;

    // 使用现有 MermaidRenderer 渲染
    requestAnimationFrame(() => {
      if (window.QCLI?.MermaidRenderer) {
        window.QCLI.MermaidRenderer.renderAll();
      }
    });
  },

  /** 清空并隐藏预览 */
  _clearMermaidPreview() {
    if (this.mermaidPreviewEl) {
      this.mermaidPreviewEl.classList.add('hidden');
      const body = this.mermaidPreviewEl.querySelector('.mermaid-preview-body');
      if (body) body.innerHTML = '';
    }
  },
};
