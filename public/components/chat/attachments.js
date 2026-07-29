// ============================================================
// 多模态附件（从 chat-panel.js 抽离，P2 拆分）
//
// 两种模式混合：
//   - 纯函数：compressImage（前端预压缩，不依赖 this）
//   - 原型 mixin：attachmentsMixin（_handleFiles / _onPaste /
//     _renderPendingAttachments / _renderAttachmentItem）
//     在 chat-panel.js 经 Object.assign(ChatPanel.prototype, attachmentsMixin) 挂回。
//
// 行为完全等价于拆分前；对外 API 不变。
// ============================================================
'use strict';

/** 前端预压缩图片，减小 uploads 体积与 base64 负载（纯函数） */
export function compressImage(file, maxEdge, maxBytes) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const type = 'image/jpeg';
        let dataUrl = canvas.toDataURL(type, 0.85);
        if (dataUrl.length > maxBytes && scale > 0.3) dataUrl = canvas.toDataURL(type, 0.6);
        const arr = dataUrl.split(','); const bstr = atob(arr[1]); const u8 = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
        const blob = new Blob([u8], { type });
        const name = file.name.replace(/\.(png|webp|avif|bmp)$/i, '.jpg');
        resolve(new File([blob], name, { type }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export const attachmentsMixin = {
  // ── 多模态附件：选择文件 → 上传 → 预览 → 随消息发送 ──
  async _handleFiles(files) {
    const Q = window.QCLI || {};
    for (const file of files) {
      // 大图前端预压缩，减小 uploads 体积与 base64 负载
      let toUpload = file;
      if (file.type.startsWith('image/') && file.size > 1.5 * 1024 * 1024) {
        try { toUpload = await compressImage(file, 1280, 1.5 * 1024 * 1024); }
        catch (e) { console.warn('[ChatPanel] image compress failed, use original', e); toUpload = file; }
      }
      const fd = new FormData();
      fd.append('files', toUpload, file.name);
      try {
        const resp = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
          if (Q.showToast) Q.showToast('附件上传失败：' + (data.error || resp.status), 'error');
          continue;
        }
        const up = data.files && data.files[0];
        if (!up || !up.url) continue;
        const kind = toUpload.type.startsWith('image/') ? 'image'
                   : toUpload.type.startsWith('video/') ? 'video' : 'text';
        this.pendingAttachments.push({
          kind,
          url: up.url,
          name: up.name || file.name,
          mime: up.mime || toUpload.type,
          size: up.size || toUpload.size,
        });
      } catch (e) {
        console.warn('[ChatPanel] upload attachment failed:', e);
        if (Q.showToast) Q.showToast('附件上传出错：' + (e && e.message ? e.message : e), 'error');
      }
    }
    this._renderPendingAttachments();
  },

  // ── 粘贴上传：Ctrl+V 图片/视频/文件（来自截图工具或文件管理器复制）──
  _onPaste(e) {
    if (!e.clipboardData) return;
    const files = [];
    const items = e.clipboardData.items;
    if (items) {
      for (const it of items) {
        if (it.kind === 'file' && it.getAsFile) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (e.clipboardData.files && e.clipboardData.files.length) {
      for (const f of e.clipboardData.files) files.push(f);
    }
    if (!files.length) return; // 纯文本粘贴，照常插入输入框，不拦截
    // 去重（items 与 files 可能指向同一对象，避免重复上传）
    const seen = new Set();
    const dedup = [];
    for (const f of files) {
      const k = `${f.name}:${f.size}:${f.type}`;
      if (!seen.has(k)) { seen.add(k); dedup.push(f); }
    }
    if (!dedup.length) return;
    e.preventDefault(); // 阻止图片以 base64 文本插入文本框
    // 文件名兜底：截图粘贴常无扩展名（如 "image.png" 或空）
    const norm = dedup.map((f) => {
      const hasName = f.name && f.name !== 'image.png';
      if (hasName) return f;
      const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
      const base = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return new File([f], `${base}.${ext}`, { type: f.type });
    });
    this._handleFiles(norm);
  },

  _renderPendingAttachments() {
    if (!this.attachPreviewEl) return;
    this.attachPreviewEl.innerHTML = '';
    this.pendingAttachments.forEach((a, idx) => {
      const chip = document.createElement('div');
      chip.className = 'attach-chip ' + (a.kind === 'image' ? 'img' : a.kind === 'video' ? 'video' : 'file');
      if (a.kind === 'image') {
        const img = document.createElement('img');
        img.className = 'thumb'; img.src = a.url; img.alt = a.name || '';
        chip.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'attach-name'; name.textContent = a.name || (a.kind + ' file');
      chip.appendChild(name);
      const rm = document.createElement('button');
      rm.className = 'attach-remove'; rm.textContent = '✕'; rm.title = '移除附件';
      rm.addEventListener('click', () => {
        this.pendingAttachments.splice(idx, 1);
        this._renderPendingAttachments();
      });
      chip.appendChild(rm);
      this.attachPreviewEl.appendChild(chip);
    });
  },

  _renderAttachmentItem(a) {
    if (a.kind === 'image') {
      const img = document.createElement('img');
      img.src = a.url; img.alt = a.name || 'image'; img.title = a.name || '';
      img.addEventListener('click', () => window.open(a.url, '_blank'));
      return img;
    }
    if (a.kind === 'video') {
      const v = document.createElement('video');
      v.src = a.url; v.controls = true; v.preload = 'metadata';
      return v;
    }
    const card = document.createElement('div');
    card.className = 'msg-file-card';
    const ico = document.createElement('span'); ico.className = 'file-ico'; ico.textContent = '📄';
    const meta = document.createElement('span'); meta.className = 'file-meta'; meta.textContent = a.name || 'file';
    card.appendChild(ico); card.appendChild(meta);
    return card;
  },
};
