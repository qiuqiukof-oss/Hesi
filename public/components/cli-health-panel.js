// ============================================================
// CLI Health Check Panel — Verify registered CLI paths exist
// ============================================================
'use strict';

(function registerCLIHealthPanel() {
  const Q = window.QCLI || {};

  function render(container) {
    container.innerHTML = `
      <div class="chp-container" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div class="chp-header" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-size:14px;font-weight:600;">🩺 CLI 健康检查</span>
            <span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">验证所有已注册 CLI 路径</span>
          </div>
          <button id="chp-scan-btn" style="padding:4px 12px;border-radius:6px;border:1px solid var(--border-default);background:var(--accent);color:#fff;font-size:11px;cursor:pointer;">🔍 开始检查</button>
        </div>
        <div id="chp-summary" style="display:none;"></div>
        <div id="chp-results" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
          <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:12px;">
            <div style="font-size:36px;margin-bottom:8px;opacity:0.3;">🩺</div>
            <div>点击「开始检查」验证所有已注册 CLI 路径</div>
          </div>
        </div>
      </div>
    `;

    const scanBtn = document.getElementById('chp-scan-btn');
    if (scanBtn) scanBtn.addEventListener('click', runHealthCheck);
  }

  async function runHealthCheck() {
    const resultsEl = document.getElementById('chp-results');
    const summaryEl = document.getElementById('chp-summary');
    const scanBtn = document.getElementById('chp-scan-btn');
    if (!resultsEl || !summaryEl || !scanBtn) return;

    scanBtn.disabled = true;
    scanBtn.textContent = '⏳ 检查中...';
    resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px;">⏳ 正在检查 CLI 路径...</div>';

    try {
      const resp = await fetch('/api/clis/health');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const { results, summary } = data;
      
      // Summary
      summaryEl.style.display = 'block';
      const healthPct = summary.total > 0 ? Math.round((summary.ok / summary.total) * 100) : 0;
      const healthColor = healthPct === 100 ? '#22c55e' : healthPct >= 80 ? '#eab308' : '#ef4444';
      summaryEl.innerHTML = `
        <div style="background:var(--bg-surface);border:1px solid var(--border-default);border-radius:8px;padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:24px;">${healthPct === 100 ? '✅' : healthPct >= 80 ? '⚠️' : '🚨'}</span>
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
                <span style="color:var(--text-secondary);">健康度</span>
                <span style="font-weight:600;color:${healthColor};">${healthPct}%</span>
              </div>
              <div style="height:4px;background:var(--bg-hover);border-radius:2px;overflow:hidden;">
                <div style="height:100%;width:${healthPct}%;background:${healthColor};border-radius:2px;transition:width 0.5s;"></div>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;font-size:10px;flex-wrap:wrap;">
            <span style="padding:2px 8px;border-radius:4px;background:rgba(34,197,94,0.1);color:#22c55e;">✅ ${summary.ok} 正常</span>
            ${summary.missing > 0 ? `<span style="padding:2px 8px;border-radius:4px;background:rgba(239,68,68,0.1);color:#ef4444;">❌ ${summary.missing} 缺失</span>` : ''}
            ${summary.resolved > 0 ? `<span style="padding:2px 8px;border-radius:4px;background:rgba(234,179,8,0.1);color:#eab308;">🔄 ${summary.resolved} 已解析</span>` : ''}
            <span style="padding:2px 8px;border-radius:4px;background:var(--bg-hover);color:var(--text-tertiary);">📊 ${summary.total} 总计</span>
          </div>
        </div>
      `;

      // Results
      if (results.length === 0) {
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px;">暂无已注册 CLI</div>';
        return;
      }

      const broken = results.filter(r => r.status === 'missing');
      const ok = results.filter(r => r.status === 'ok');
      const resolved = results.filter(r => r.status === 'resolved');

      resultsEl.innerHTML = '';
      
      // Broken section
      if (broken.length > 0) {
        const brokenSection = document.createElement('div');
        brokenSection.innerHTML = `
          <div style="font-size:10px;font-weight:600;color:#ef4444;padding:4px 0;text-transform:uppercase;letter-spacing:0.5px;">
            ❌ 缺失 (${broken.length})
          </div>
          <div style="display:flex;gap:4px;margin-bottom:6px;">
            <button class="chp-fix-btn" data-action="remove-broken" style="padding:3px 10px;border-radius:4px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;font-size:10px;cursor:pointer;">🗑 移除全部缺失</button>
          </div>
        `;
        const brokenList = document.createElement('div');
        brokenList.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        broken.forEach(cli => {
          const item = createHealthItem(cli, 'missing');
          brokenList.appendChild(item);
        });
        brokenSection.appendChild(brokenList);
        resultsEl.appendChild(brokenSection);
      }

      // Resolved section
      if (resolved.length > 0) {
        const resolvedEl = document.createElement('div');
        resolvedEl.innerHTML = `<div style="font-size:10px;font-weight:600;color:#eab308;padding:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">🔄 待解析 (${resolved.length})</div>`;
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        resolved.forEach(cli => {
          list.appendChild(createHealthItem(cli, 'resolved'));
        });
        resolvedEl.appendChild(list);
        resultsEl.appendChild(resolvedEl);
      }

      // OK section
      if (ok.length > 0) {
        const okEl = document.createElement('div');
        okEl.innerHTML = `<div style="font-size:10px;font-weight:600;color:#22c55e;padding:8px 0 4px;text-transform:uppercase;letter-spacing:0.5px;">✅ 正常 (${ok.length})</div>`;
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        ok.slice(0, 20).forEach(cli => {
          list.appendChild(createHealthItem(cli, 'ok'));
        });
        if (ok.length > 20) {
          const more = document.createElement('div');
          more.style.cssText = 'font-size:10px;color:var(--text-tertiary);text-align:center;padding:4px;';
          more.textContent = `...及其他 ${ok.length - 20} 个正常 CLI`;
          list.appendChild(more);
        }
        okEl.appendChild(list);
        resultsEl.appendChild(okEl);
      }

      // Wire fix buttons
      resultsEl.querySelectorAll('.chp-fix-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (action === 'remove-broken') {
            if (!confirm('确定移除所有缺失的 CLI 吗？')) return;
            const ids = broken.map(b => b.id);
            try {
              const resp = await fetch('/api/clis/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              });
              if (resp.ok) {
                Q.showToast?.(`已移除 ${ids.length} 个缺失 CLI`, 'success');
                if (Q.renderCLIList) Q.renderCLIList();
                if (Q.Sidebar?.renderCLIList) Q.Sidebar.renderCLIList();
                runHealthCheck();
              }
            } catch (e) {
              Q.showToast?.('移除失败: ' + e.message, 'error');
            }
          }
        });
      });

    } catch (err) {
      resultsEl.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">❌ 检查失败: ${err.message}</div>`;
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '🔍 重新检查';
    }
  }

  function createHealthItem(cli, status) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border-default);border-radius:6px;font-size:11px;';
    
    const icon = status === 'ok' ? '✅' : status === 'resolved' ? '🔄' : '❌';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-weight:600;color:var(--text-primary);min-width:80px;';
    nameSpan.textContent = cli.name;

    const pathSpan = document.createElement('span');
    pathSpan.style.cssText = 'color:var(--text-tertiary);font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    pathSpan.textContent = cli.path || '(未设置路径)';

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;padding:1px 6px;border-radius:4px;';
    if (status === 'ok') {
      badge.style.cssText += 'background:rgba(34,197,94,0.1);color:#22c55e;';
      badge.textContent = cli.version || '正常';
    } else if (status === 'missing') {
      badge.style.cssText += 'background:rgba(239,68,68,0.1);color:#ef4444;';
      badge.textContent = '缺失';
    } else {
      badge.style.cssText += 'background:rgba(234,179,8,0.1);color:#eab308;';
      badge.textContent = '待解析';
    }

    item.appendChild(document.createTextNode(icon + ' '));
    item.appendChild(nameSpan);
    item.appendChild(pathSpan);
    item.appendChild(badge);

    // Delete button for broken items
    if (status === 'missing') {
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:10px;padding:2px;';
      delBtn.title = '移除';
      delBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch(`/api/clis/${cli.id}`, { method: 'DELETE' });
          if (resp.ok) {
            item.remove();
            Q.showToast?.(`已移除 ${cli.name}`, 'info');
            if (Q.renderCLIList) Q.renderCLIList();
          }
        } catch (e) {
          Q.showToast?.('移除失败', 'error');
        }
      });
      item.appendChild(delBtn);
    }

    return item;
  }

  // Register as right panel tab
  const UIR = Q.UIRegistry;
  if (UIR) {
    UIR.registerTab('cli-health', {
    category: "tools",
      icon: '🩺',
      label: 'CLI 健康',
      order: 10,
      render: render,
    });
  }

  // Expose for standalone use
  Q.CLIHealth = { render, runHealthCheck };
  console.log('[CLIHealthPanel] Registered');
})();
