// ============================================================
// CLI Batch Importer/Exporter Panel
// ============================================================
'use strict';

import { escapeHtml } from '../escape.js';

(function registerCLIImporter() {
  const Q = window.QCLI || {};

  let _selectedIds = new Set();

  function render(container) {
    _selectedIds = new Set();
    container.innerHTML = `
      <div class="cli-imp-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="cli-imp-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">📦 CLI 批量操作</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">导入 / 导出配置</span>
          </div>
        </div>

        <!-- Export Section -->
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">📤 导出 CLI</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:8px;">选择要导出的 CLI，生成 JSON 配置文件</div>
          <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="cli-imp-select-all" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">全选</button>
            <button id="cli-imp-deselect-all" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">取消全选</button>
            <button id="cli-imp-export-btn" style="padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:10px;cursor:pointer;" disabled>📥 导出选中 (0)</button>
          </div>
          <div id="cli-imp-export-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;"></div>
        </div>

        <!-- Import Section -->
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">📥 导入 CLI</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-bottom:8px;">上传 JSON 配置文件导入 CLI（支持导出格式及简易格式）</div>
          <div style="display:flex;gap:6px;">
            <input type="file" id="cli-imp-file-input" accept=".json" style="display:none;" aria-label="选择 CLI 导入文件" />
            <button id="cli-imp-choose-file" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">📂 选择文件</button>
            <span id="cli-imp-file-name" style="font-size:10px;color:var(--text-tertiary);align-self:center;">未选择文件</span>
          </div>
          <div id="cli-import-preview" style="margin-top:8px;display:none;"></div>
        </div>

        <div id="cli-imp-status" style="font-size:10px;color:var(--text-tertiary);text-align:center;"></div>
      </div>
    `;

    loadCLIList();
    wireEvents();
  }

  async function loadCLIList() {
    const listEl = document.getElementById('cli-imp-export-list');
    if (!listEl) return;
    try {
      const resp = await fetch('/api/clis');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const clis = data.clis || [];
      
      if (clis.length === 0) {
        listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-tertiary);font-size:11px;">暂无已注册 CLI</div>';
        return;
      }

      listEl.innerHTML = clis.map(cli => {
        const id = cli.id;
        const isChecked = _selectedIds.has(id);
        return `<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:11px;background:${isChecked ? 'var(--accent-glow)' : 'transparent'};">
          <input type="checkbox" class="cli-imp-checkbox" data-id="${id}" ${isChecked ? 'checked' : ''} style="accent-color:var(--accent);" />
          <span style="font-weight:600;color:var(--text-primary);flex:1;">${escapeHtml(cli.name)}</span>
          <span style="font-size:9px;color:var(--text-tertiary);">${cli.category || 'tool'}</span>
          <span style="font-size:9px;color:var(--text-tertiary);">${cli.version ? cli.version.slice(0, 15) : ''}</span>
        </label>`;
      }).join('');
    } catch (err) {
      listEl.innerHTML = '<div style="padding:12px;text-align:center;color:#ef4444;font-size:11px;">❌ 加载失败: ' + err.message + '</div>';
    }
  }

  function wireEvents() {
    // Checkbox delegation
    const listEl = document.getElementById('cli-imp-export-list');
    if (listEl) {
      listEl.addEventListener('change', (e) => {
        const cb = e.target.closest('.cli-imp-checkbox');
        if (!cb) return;
        const id = cb.dataset.id;
        if (cb.checked) _selectedIds.add(id);
        else _selectedIds.delete(id);
        updateExportBtn();
        // Highlight row
        const label = cb.closest('label');
        if (label) label.style.background = cb.checked ? 'var(--accent-glow)' : 'transparent';
      });
    }

    // Select all
    document.getElementById('cli-imp-select-all')?.addEventListener('click', () => {
      document.querySelectorAll('.cli-imp-checkbox').forEach(cb => {
        cb.checked = true;
        _selectedIds.add(cb.dataset.id);
        const label = cb.closest('label');
        if (label) label.style.background = 'var(--accent-glow)';
      });
      updateExportBtn();
    });

    // Deselect all
    document.getElementById('cli-imp-deselect-all')?.addEventListener('click', () => {
      document.querySelectorAll('.cli-imp-checkbox').forEach(cb => {
        cb.checked = false;
        _selectedIds.delete(cb.dataset.id);
        const label = cb.closest('label');
        if (label) label.style.background = 'transparent';
      });
      updateExportBtn();
    });

    // Export button
    document.getElementById('cli-imp-export-btn')?.addEventListener('click', exportSelected);

    // File import
    const chooseBtn = document.getElementById('cli-imp-choose-file');
    const fileInput = document.getElementById('cli-imp-file-input');
    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFileImport);
    }
  }

  function updateExportBtn() {
    const btn = document.getElementById('cli-imp-export-btn');
    if (!btn) return;
    const count = _selectedIds.size;
    btn.disabled = count === 0;
    btn.textContent = count > 0 ? `📥 导出选中 (${count})` : '📥 导出选中 (0)';
  }

  async function exportSelected() {
    if (_selectedIds.size === 0) return;
    try {
      const resp = await fetch('/api/clis/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(_selectedIds) }),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Export failed');

      const json = JSON.stringify(data.export, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cli-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Q.showToast?.(`已导出 ${_selectedIds.size} 个 CLI`, 'success');
    } catch (err) {
      Q.showToast?.('导出失败: ' + err.message, 'error');
    }
  }

  async function handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const fileNameEl = document.getElementById('cli-imp-file-name');
    const previewEl = document.getElementById('cli-import-preview');
    const statusEl = document.getElementById('cli-imp-status');
    if (fileNameEl) fileNameEl.textContent = '📄 ' + file.name;
    if (!previewEl || !statusEl) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Handle both export format and simple format
      let clisToImport = [];
      if (data.clis && Array.isArray(data.clis)) {
        clisToImport = data.clis;
      } else if (Array.isArray(data)) {
        clisToImport = data;
      } else {
        previewEl.innerHTML = '<div style="color:#ef4444;font-size:11px;padding:8px;">❌ 无效格式：文件应包含 "clis" 数组或为 CLI 数组</div>';
        previewEl.style.display = 'block';
        return;
      }

      if (clisToImport.length === 0) {
        previewEl.innerHTML = '<div style="color:var(--text-tertiary);font-size:11px;padding:8px;">文件中没有 CLI 数据</div>';
        previewEl.style.display = 'block';
        return;
      }

      previewEl.style.display = 'block';
      previewEl.innerHTML = `
        <div style="margin-top:4px;">
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">📋 发现 ${clisToImport.length} 个 CLI：</div>
          <div style="max-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;margin-bottom:6px;">
            ${clisToImport.map(c => `<div style="font-size:10px;padding:2px 4px;background:var(--bg-elevated);border-radius:4px;">${c.name || '(未命名)'} · ${c.category || 'tool'}</div>`).join('')}
          </div>
          <button id="cli-imp-do-import" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">📥 导入 ${clisToImport.length} 个 CLI</button>
        </div>
      `;

      document.getElementById('cli-imp-do-import')?.addEventListener('click', async () => {
        try {
          const resp = await fetch('/api/clis/batch-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clis: clisToImport }),
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const result = await resp.json();
          if (result.success) {
            statusEl.textContent = `✅ 已导入 ${result.imported} 个，跳过 ${result.skipped} 个（已存在）`;
            if (Q.renderCLIList) Q.renderCLIList();
            loadCLIList(); // Refresh export list
            previewEl.style.display = 'none';
          }
        } catch (err) {
          statusEl.textContent = `❌ 导入失败: ${err.message}`;
        }
      });

    } catch (err) {
      previewEl.innerHTML = `<div style="color:#ef4444;font-size:11px;padding:8px;">❌ 无法解析文件: ${err.message}</div>`;
      previewEl.style.display = 'block';
    }
  }

  // Register as right panel tab
  const UIR = Q.UIRegistry;
  if (UIR) {
    UIR.registerTab('cli-importer', {
    category: "tools",
      icon: '📦',
      label: 'CLI 批量',
      order: 11,
      render: render,
    });
  }

  Q.CLIImporter = { render };
  console.log('[CLIImporter] Registered');
})();
