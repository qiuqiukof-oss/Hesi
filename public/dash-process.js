/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// CLI Process Monitor — Running CLI sessions with CPU/MEM
// ============================================================

import { setText, formatDuration, escapeHtml, _safeId } from './dash-utils.js';
import { _Monitor } from './dash-monitor.js';
import { _AlertManager } from './dash-alert.js';

/** @typedef {import('./types').QCLI} QCLI */
/** Whether process sparkline charts are expanded */
export let _procExpanded = false;

/** Toggle process sparkline expansion */
export function toggleProcExpanded() {
  _procExpanded = !_procExpanded;
}

/** Cache for process stats to avoid flicker */
let _processStatsCache = { processes: [], ts: 0 };

/** Fetch process resource stats from server API */
async function fetchProcessStats() {
  try {
    const resp = await fetch('/api/system/process-stats');
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.success) {
      _processStatsCache = data;
      return data;
    }
  } catch (e) { console.debug('[Dashboard] fetch process stats:', e?.message); }
  return null;
}

/** Draw per-process CPU and MEM sparklines */
export function drawProcSparklines() {
  const cssVars = getComputedStyle(document.documentElement);
  const accent = cssVars.getPropertyValue('--accent').trim() || '#6366f1';
  const success = cssVars.getPropertyValue('--success').trim() || '#22c55e';

  for (const tabId in _Monitor._procHistory) {
    const sid = _safeId(tabId);
    const ph = _Monitor._procHistory[tabId];
    if (!ph) continue;

    const cpuCanvas = document.getElementById('ps-cpu-' + sid);
    if (cpuCanvas && (window.QCLI || {}).ChartCore?.drawSparkLine) {
      (window.QCLI || {}).ChartCore.drawSparkLine(cpuCanvas, ph.cpu, '#eab308', 'CPU', '%');
    }

    const memCanvas = document.getElementById('ps-mem-' + sid);
    if (memCanvas && (window.QCLI || {}).ChartCore?.drawSparkLine) {
      (window.QCLI || {}).ChartCore.drawSparkLine(memCanvas, ph.mem, success, '内存', 'MB');
    }
  }
}

/** Update CLI process monitor UI */
export async function updateCLIProcessMonitor() {
  const processList = document.getElementById('dash-process-list');
  if (!processList) return;

  const tabs = (window.QCLI || {}).Tabs?.tabs || [];
  const activeId = (window.QCLI || {}).Tabs?.activeTabId;
  const launched = !!(window.QCLI || {}).state?.launched;

  setText('dash-process-count', tabs.length > 0 ? tabs.length + ' 进程' : '0');

  if (tabs.length === 0 && !launched) {
    processList.innerHTML = '<div class=\"dash-empty\">暂无运行中的 CLI 进程</div>';
    return;
  }

  if (tabs.length === 0 && launched) {
    processList.innerHTML = '<div class=\"dash-empty\">CLI 已启动，但无活动标签</div>';
    return;
  }

  // Fetch server-side process resource stats
  const statsData = await fetchProcessStats();
  /** @type {Map<string, object>} map tabId → process stat */
  const statsMap = new Map();
  if (statsData && statsData.processes) {
    for (const p of statsData.processes) {
      statsMap.set(p.tabId, p);
    }
  }

  // Record per-process history for sparklines
  const histNow = Date.now();
  for (const [tabId, proc] of statsMap) {
    if (!proc || !proc.alive) continue;
    if (!_Monitor._procHistory[tabId]) {
      _Monitor._procHistory[tabId] = { cpu: [], mem: [] };
    }
    const ph = _Monitor._procHistory[tabId];
    if (proc.cpu !== undefined) {
      ph.cpu.push({ t: histNow, v: proc.cpu });
      if (ph.cpu.length > _Monitor._procHistoryMax) ph.cpu.shift();
    }
    if (proc.memMB !== undefined) {
      ph.mem.push({ t: histNow, v: proc.memMB });
      if (ph.mem.length > _Monitor._procHistoryMax) ph.mem.shift();
    }
  }
  // Clean up history for dead processes
  const activeTabIds = new Set(statsMap.keys());
  for (const tid in _Monitor._procHistory) {
    if (!activeTabIds.has(tid)) {
      delete _Monitor._procHistory[tid];
    }
  }

  // Serialize for change detection
  const serialized = tabs.map(t => {
    const age = t._createdAt ? Math.floor((Date.now() - t._createdAt) / 1000) : 0;
    const stat = statsMap.get(t.tabId);
    const cpuStr = stat ? String(stat.cpu) : '';
    const memStr = stat ? String(stat.memMB) : '';
    return t.tabId + '|' + (t.tabId === activeId ? '1' : '0') + '|' + age + '|' + cpuStr + '|' + memStr;
  }).join(',');
  if (processList.dataset.serialized === serialized) return;
  processList.dataset.serialized = serialized;

  processList.innerHTML = tabs.map(function(tab) {
    const isActive = tab.tabId === activeId;
    const age = tab._createdAt ? Math.floor((Date.now() - tab._createdAt) / 1000) : 0;
    const ageStr = age > 0 ? formatDuration(age) : '刚刚';
    const cliName = tab.name || tab.cliId || 'Terminal';
    const icon = tab.icon || '🖥️';
    const statusClass = isActive ? 'online' : 'offline';
    const sid = _safeId(tab.tabId);

    // Resource stats
    const stat = statsMap.get(tab.tabId);
    const cpuVal = stat && stat.alive ? stat.cpu : null;
    const memMB = stat && stat.alive ? stat.memMB : null;
    const pid = stat && stat.alive ? stat.pid : null;

    const cpuPct = cpuVal !== null ? Math.min(cpuVal, 100) : 0;
    const cpuColor = cpuVal === null ? '' : cpuVal < 30 ? 'var(--success)' : cpuVal < 70 ? 'var(--warning, #eab308)' : 'var(--danger)';
    const memPct = memMB !== null ? Math.min(100, (memMB / 500) * 100) : 0;

    // Sparkline canvases (only if expanded)
    const ph = _Monitor._procHistory[tab.tabId];
    const showSparklines = _procExpanded && ph && ph.cpu && ph.cpu.length >= 2;
    const sparkHtml = showSparklines ? '<div class=\"dash-proc-sparklines\">' +
      '<canvas class=\"dash-proc-sparkline\" id=\"ps-cpu-' + sid + '\" width=\"1\" height=\"14\"></canvas>' +
      '<canvas class=\"dash-proc-sparkline\" id=\"ps-mem-' + sid + '\" width=\"1\" height=\"14\"></canvas>' +
      '</div>' : '';

    const resourceHtml = (cpuVal !== null || memMB !== null)
      ? `<div class=\"dash-process-resources\">
          <div class=\"dash-process-resource-row\">
            <span class=\"dash-process-resource-icon\">⚡</span>
            <div class=\"dash-process-resource-track\">
              <div class=\"dash-process-resource-fill\" style=\"width:${cpuPct}%;background:${cpuColor}\"></div>
            </div>
            <span class=\"dash-process-resource-value\">${cpuVal !== null ? cpuVal + '%' : '—'}</span>
          </div>
          <div class=\"dash-process-resource-row\">
            <span class=\"dash-process-resource-icon\">💾</span>
            <div class=\"dash-process-resource-track\">
              <div class=\"dash-process-resource-fill mem-fill\" style=\"width:${memPct}%\"></div>
            </div>
            <span class=\"dash-process-resource-value\">${memMB !== null ? memMB + ' MB' : '—'}</span>
          </div>
          ${sparkHtml}
          ${pid ? `<span class=\"dash-process-pid\">PID ${pid}</span>` : ''}
        </div>`
      : '';

    return `<div class=\"dash-process-item ${isActive ? 'active' : ''}\" data-tab-id=\"${tab.tabId}\">
      <div class=\"dash-process-item-main\">
        <span class=\"dash-process-item-icon\">${icon}</span>
        <div class=\"dash-process-item-info\">
          <span class=\"dash-process-item-name\">${escapeHtml(cliName)}</span>
          <span class=\"dash-process-item-meta\">
            <span class=\"dash-status-dot ${statusClass}\"></span>
            ${isActive ? '当前会话' : ''}
            ${isActive ? '·' : ''}
            运行 ${ageStr}
          </span>
        </div>
        <span class=\"dash-process-item-status ${statusClass}\">
          ${isActive ? '活动中' : '后台'}
        </span>
      </div>
      ${resourceHtml}
    </div>`;
  }).join('');

  // Update toggle button text
  const toggleBtn = document.getElementById('dash-proc-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = _procExpanded ? '📊 收起趋势' : '📊 展开趋势';
  }

  // Draw per-process sparklines
  if (_procExpanded) {
    drawProcSparklines();
  }

  // Check thresholds
  if (statsData && statsData.processes) {
    const procMap = new Map();
    for (let pi = 0; pi < statsData.processes.length; pi++) {
      const p = statsData.processes[pi];
      procMap.set(p.tabId, p);
    }
    _AlertManager.checkProcessThresholds(procMap);
  }
}

// ============================================================
// Process Detail Modal
// ============================================================

const _ProcessDetailModal = {
  _modal: null,

  open(tabId, tabName) {
    this._ensureEl();
    this._modal.classList.add('active');
    this._modal.querySelector('.dash-modal-title').textContent = `${tabName} 进程详情`;
    this._modal.querySelector('.dash-modal-body').innerHTML = '<div class=\"dash-empty\">加载中...</div>';
    this._fetchDetail(tabId);
  },

  close() {
    if (this._modal) {
      this._modal.classList.remove('active');
    }
  },

  _ensureEl() {
    if (this._modal) return;
    this._modal = document.createElement('div');
    this._modal.className = 'dash-modal-overlay';
    this._modal.innerHTML = `
      <div class=\"dash-modal\">
        <div class=\"dash-modal-header\">
          <span class=\"dash-modal-title\">进程详情</span>
          <button class=\"dash-modal-close\" title=\"关闭\">✕</button>
        </div>
        <div class=\"dash-modal-body\"></div>
      </div>`;
    document.body.appendChild(this._modal);

    // Close on overlay click or close button
    this._modal.addEventListener('click', (e) => {
      if (e.target === this._modal || e.target.closest('.dash-modal-close')) {
        this.close();
      }
    });
  },

  async _fetchDetail(tabId) {
    try {
      const resp = await fetch('/api/system/process-detail?tabId=' + encodeURIComponent(tabId));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (data.success) {
        this._renderDetail(data);
      } else {
        this._modal.querySelector('.dash-modal-body').innerHTML = '<div class=\"dash-empty\">无法获取进程详情</div>';
      }
    } catch (e) {
      this._modal.querySelector('.dash-modal-body').innerHTML = `<div class=\"dash-empty\">错误: ${escapeHtml(e.message)}</div>`;
    }
  },

  _renderDetail(data) {
    const proc = data.process || data;
    const body = this._modal.querySelector('.dash-modal-body');

    body.innerHTML = `
      <div class=\"dash-modal-grid\">
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">PID</span>
          <span class=\"dash-modal-field-value\">${proc.pid || '—'}</span>
        </div>
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">名称</span>
          <span class=\"dash-modal-field-value\">${escapeHtml(proc.name || '—')}</span>
        </div>
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">状态</span>
          <span class=\"dash-modal-field-value\"><span class=\"dash-status-dot ${proc.alive ? 'online' : 'offline'}\"></span> ${proc.alive ? '运行中' : '已退出'}</span>
        </div>
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">CPU</span>
          <span class=\"dash-modal-field-value\">${proc.cpu !== undefined ? proc.cpu + '%' : '—'}</span>
        </div>
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">内存</span>
          <span class=\"dash-modal-field-value\">${proc.memMB !== undefined ? proc.memMB + ' MB' : '—'}</span>
        </div>
        <div class=\"dash-modal-field\">
          <span class=\"dash-modal-field-label\">线程数</span>
          <span class=\"dash-modal-field-value\">${proc.threads !== undefined ? proc.threads : '—'}</span>
        </div>
        <div class=\"dash-modal-field\" style=\"grid-column:1/-1;\">
          <span class=\"dash-modal-field-label\">命令行</span>
          <span class=\"dash-modal-field-value\" style=\"font-size:10px;word-break:break-all;\">${escapeHtml(proc.cmd || '—')}</span>
        </div>
      </div>
      ${proc.alive ? `<button class=\"dash-chip-btn\" id=\"dash-kill-btn\" style=\"margin-top:8px;background:var(--danger);color:white;\">🔴 终止进程</button>` : ''}
    `;

    // Wire kill button
    const killBtn = document.getElementById('dash-kill-btn');
    if (killBtn && proc.pid) {
      killBtn.addEventListener('click', async () => {
        if (!confirm(`确定终止进程 ${proc.pid} (${proc.name || ''})？`)) return;
        killBtn.disabled = true;
        killBtn.textContent = '终止中...';
        try {
          const resp = await fetch('/api/system/kill-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid: proc.pid }),
          });
          const result = await resp.json();
          if (result.success) {
            killBtn.textContent = '✅ 已终止';
            setTimeout(() => this.close(), 1000);
          } else {
            killBtn.textContent = '❌ 终止失败: ' + (result.error || '未知错误');
            killBtn.disabled = false;
          }
        } catch (e) {
          killBtn.textContent = '❌ 请求失败';
          killBtn.disabled = false;
        }
      });
    }
  },
};

/** Show process detail modal */
export function showProcessDetail(tabId, tabName) {
  _ProcessDetailModal.open(tabId, tabName);
}

/** Wire process list click to detail modal */
document.addEventListener('click', (e) => {
  const item = e.target.closest('.dash-process-item');
  if (item && !e.target.closest('.dash-process-pid') && !e.target.closest('.dash-chip-btn')) {
    const tabId = item.dataset.tabId;
    if (tabId) {
      const tabs = (window.QCLI || {}).Tabs?.tabs || [];
      const tab = tabs.find(t => t.tabId === tabId);
      showProcessDetail(tabId, tab?.name || tab?.cliId || 'Terminal');
    }
  }
});
