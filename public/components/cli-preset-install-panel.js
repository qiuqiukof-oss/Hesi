// ============================================================
// CLI Preset Install Panel — install preset CLIs not yet registered
// ============================================================
'use strict';

import { escapeHtml } from '../escape.js';

(function registerCLIPresetInstall() {
  const Q = window.QCLI || {};

  async function render(container) {
    container.innerHTML = `
      <div class="cpi-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="cpi-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">📦 预设 CLI 安装</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;" id="cpi-preset-name">加载中...</span>
          </div>
          <button id="cpi-refresh-btn" style="padding:4px 10px;border-radius:6px;border:1px solid var(--border-default);background:var(--bg-hover);color:var(--text-secondary);font-size:10px;cursor:pointer;">🔄 刷新</button>
        </div>
        <div id="cpi-content">
          <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:12px;">
            <div style="font-size:32px;margin-bottom:8px;opacity:0.3;">⏳</div>
            <div>正在获取预设数据...</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cpi-refresh-btn')?.addEventListener('click', () => render(container));
    await loadData(container);
  }

  async function loadData(container) {
    const contentEl = document.getElementById('cpi-content');
    const presetNameEl = document.getElementById('cpi-preset-name');
    if (!contentEl || !presetNameEl) return;

    try {
      // Fetch both preset info and available CLIs
      const [presetResp, availResp] = await Promise.all([
        fetch('/api/presets'),
        fetch('/api/presets/available'),
      ]);

      const presetData = presetResp.ok ? await presetResp.json() : null;
      const availData = availResp.ok ? await availResp.json() : null;

      const activePreset = presetData?.active || 'unknown';
      presetNameEl.textContent = `当前预设: ${activePreset}`;

      if (!availData?.success || !availData.available || availData.available.length === 0) {
        contentEl.innerHTML = `
          <div style="text-align:center;padding:40px 20px;">
            <div style="font-size:36px;margin-bottom:8px;opacity:0.3;">✅</div>
            <div style="font-size:12px;color:var(--text-secondary);">当前预设的所有 CLI 均已安装</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px;">
              已注册 ${availData?.registered || 0} / ${availData?.totalInPreset || 0} 个
            </div>
          </div>
        `;
        return;
      }

      const { available, totalInPreset, registered } = availData;
      const installable = available.filter(c => c.canResolve);
      const notInstallable = available.filter(c => !c.canResolve);

      contentEl.innerHTML = `
        <div style="font-size:10px;color:var(--text-tertiary);padding:4px 0;">
          已注册 ${registered} / ${totalInPreset} 个 · 
          可安装 ${installable.length} 个 · 
          需手动 ${notInstallable.length} 个
        </div>
        ${installable.length > 0 ? `
          <div style="margin:4px 0;">
            <button id="cpi-install-all" style="padding:4px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">
              ⚡ 一键安装全部 (${installable.length})
            </button>
          </div>
        ` : ''}
        <div style="display:flex;flex-direction:column;gap:3px;" id="cpi-available-list">
          ${renderCLIList(installable, notInstallable)}
        </div>
      `;

      // Wire install buttons
      contentEl.querySelectorAll('.cpi-install-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          const cat = btn.dataset.category;
          btn.disabled = true;
          btn.textContent = '⏳ 安装中...';
          try {
            const resp = await fetch('/api/clis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, args: [], category: cat || 'tool' }),
            });
            if (resp.ok) {
              btn.textContent = '✅ 已安装';
              btn.style.background = 'rgba(34,197,94,0.1)';
              btn.style.color = '#22c55e';
              btn.style.borderColor = '#22c55e';
              Q.showToast?.(`✅ ${name} 已安装`, 'success');
              if (Q.renderCLIList) Q.renderCLIList();
            } else {
              const err = await resp.json();
              btn.textContent = '❌ ' + (err.error || '失败');
              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '⚡ 安装';
              }, 2000);
            }
          } catch (e) {
            btn.textContent = '❌ 错误';
            Q.showToast?.('安装失败: ' + e.message, 'error');
          }
        });
      });

      // Wire install all button
      document.getElementById('cpi-install-all')?.addEventListener('click', async () => {
        const btn = document.getElementById('cpi-install-all');
        if (!btn) return;
        btn.disabled = true;
        btn.textContent = '⏳ 正在安装...';
        let success = 0, failed = 0;
        for (const cli of installable) {
          try {
            const resp = await fetch('/api/clis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: cli.name, args: [], category: cli.category || 'tool' }),
            });
            if (resp.ok) success++;
            else failed++;
          } catch {
            failed++;
          }
        }
        btn.textContent = `✅ 完成: ${success} 成功, ${failed} 失败`;
        Q.showToast?.(`安装完成: ${success} 成功, ${failed} 失败`, failed > 0 ? 'warning' : 'success');
        if (Q.renderCLIList) Q.renderCLIList();
        // Refresh
        setTimeout(() => render(container), 1500);
      });

    } catch (err) {
      contentEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">❌ 加载失败: ${err.message}</div>`;
    }
  }

  function renderCLIList(installable, notInstallable) {
    let html = '';

    if (installable.length > 0) {
      html += `<div style="font-size:10px;font-weight:600;color:var(--accent);padding:6px 0 2px;">⚡ 可一键安装</div>`;
      installable.forEach(cli => {
        html += `
          <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:11px;">
            <span style="font-weight:600;color:var(--text-primary);flex:1;">${escapeHtml(cli.name)}</span>
            <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(99,102,241,0.1);color:var(--accent);">${cli.category}</span>
            <button class="cpi-install-btn" data-name="${cli.name}" data-category="${cli.category}" style="padding:3px 10px;border-radius:4px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-size:10px;cursor:pointer;">⚡ 安装</button>
          </div>
        `;
      });
    }

    if (notInstallable.length > 0) {
      html += `<div style="font-size:10px;font-weight:600;color:var(--text-tertiary);padding:8px 0 2px;">📋 需手动安装（未在 PATH 中找到）</div>`;
      notInstallable.forEach(cli => {
        html += `
          <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:11px;opacity:0.7;">
            <span style="font-weight:600;color:var(--text-primary);flex:1;">${escapeHtml(cli.name)}</span>
            <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg-hover);color:var(--text-tertiary);">${cli.category}</span>
            <span style="font-size:9px;color:var(--text-tertiary);">未找到</span>
          </div>
        `;
      });
    }

    return html;
  }

  // Register as right panel tab
  const UIR = Q.UIRegistry;
  if (UIR) {
    UIR.registerTab('cli-preset-install', {
    category: "other",
      icon: '📦',
      label: 'CLI 安装',
      order: 12,
      render: render,
    });
  }

  Q.CLIPresetInstall = { render };
  console.log('[CLIPresetInstall] Registered');
})();
