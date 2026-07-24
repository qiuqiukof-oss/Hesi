// ============================================================
// <network-monitor-panel> — 浏览器网络请求监控面板
//
// 注册为右侧面板的「网络监控」标签页 (🌐)。
// 通过 UIRegistry 注册。
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

// ── State ──
let _entries = [];
let _isRecording = false;
let _filterText = '';
let _typeFilter = 'all'; // 'all' | 'fetch' | 'xhr'

// ── DOM 引用 ──
/** @type {{ panel:HTMLElement, list:HTMLElement, statsBar:HTMLElement|null, recordBtn:HTMLElement|null, filterInput:HTMLInputElement|null }} */
let dom = null;

// ============================================================
// API 调用
// ============================================================

async function networkAction(action, filter) {
  try {
    const resp = await fetch('/api/browser/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, filter }),
    });
    return await resp.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function startCapture() {
  const result = await networkAction('start');
  if (result.success) {
    _isRecording = true;
    updateUI();
    // Auto-poll every 2 seconds
    if (dom && dom.panel) {
      dom.panel._pollTimer = setInterval(pollEntries, 2000);
    }
  } else {
    const toast = Q().showToast;
    if (toast) toast('❌ 启动网络监控失败：' + (result.error || '未知错误') + '（请先连接浏览器 CDP）', 'error');
  }
  return result;
}

async function stopCapture() {
  _isRecording = false;
  if (dom && dom.panel && dom.panel._pollTimer) {
    clearInterval(dom.panel._pollTimer);
    dom.panel._pollTimer = null;
  }
  await networkAction('stop');
  updateUI();
}

async function pollEntries() {
  if (!_isRecording) return;
  const result = await networkAction('get');
  if (result.success && result.entries) {
    _entries = result.entries;
    renderList();
    updateStats(result.stats);
    // 同步真实录制状态：页面导航导致注入失效时，自动纠正 UI 与轮询定时器
    if (typeof result.isActive === 'boolean' && result.isActive !== _isRecording) {
      _isRecording = result.isActive;
      updateUI();
      if (!_isRecording && dom && dom.panel && dom.panel._pollTimer) {
        clearInterval(dom.panel._pollTimer);
        dom.panel._pollTimer = null;
      }
    }
  }
}

async function fetchEntries() {
  const result = await networkAction('get');
  if (result.success) {
    _entries = result.entries || [];
    renderList();
    updateStats(result.stats);
    _isRecording = result.isActive || false;
    if (_isRecording && dom && dom.panel && !dom.panel._pollTimer) {
      dom.panel._pollTimer = setInterval(pollEntries, 2000);
    }
    updateUI();
  }
}

async function clearEntries() {
  _entries = [];
  renderList();
  updateStats(null);
}

// ============================================================
// 渲染
// ============================================================

function renderList() {
  if (!dom || !dom.list) return;

  const filtered = _entries.filter(e => {
    if (_filterText && !e.url.toLowerCase().includes(_filterText.toLowerCase())) return false;
    if (_typeFilter !== 'all' && e.type !== _typeFilter) return false;
    return true;
  });

  dom.list.innerHTML = '';

  if (filtered.length === 0) {
    dom.list.innerHTML = `<div class="nm-empty">
      <div class="nm-empty-icon">${_filterText ? '🔍' : '🌐'}</div>
      ${_filterText ? '没有匹配的网络请求' : (_isRecording ? '等待网络请求...' : '点击 ▶ 开始捕获')}
    </div>`;
    return;
  }

  for (const entry of filtered) {
    const item = document.createElement('div');
    item.className = 'nm-entry' + (entry.error ? ' error' : '');

    // Method badge
    const method = document.createElement('span');
    method.className = 'nm-entry-method';
    method.textContent = entry.method || 'GET';
    item.appendChild(method);

    // URL
    const urlEl = document.createElement('span');
    urlEl.className = 'nm-entry-url';
    urlEl.textContent = truncateUrl(entry.url, 80);
    urlEl.title = entry.url;
    item.appendChild(urlEl);

    // Status
    if (entry.status) {
      const status = document.createElement('span');
      status.className = 'nm-entry-status s' + (Math.floor(entry.status / 100) * 100);
      status.textContent = entry.status;
      item.appendChild(status);
    }

    // Duration
    const dur = document.createElement('span');
    dur.className = 'nm-entry-duration';
    dur.textContent = entry.duration != null ? entry.duration + 'ms' : '';
    item.appendChild(dur);

    // Type
    const type = document.createElement('span');
    type.className = 'nm-entry-type';
    type.textContent = entry.type || '';
    item.appendChild(type);

    // Detail expand
    const detail = document.createElement('div');
    detail.className = 'nm-entry-detail';
    detail.textContent = formatDetail(entry);
    item.appendChild(detail);

    item.addEventListener('click', () => {
      detail.classList.toggle('expanded');
    });

    dom.list.appendChild(item);
  }
}

function updateStats(stats) {
  if (!dom || !dom.statsBar) return;
  if (!stats) {
    dom.statsBar.innerHTML = '<span class="nm-stat">暂无数据</span>';
    return;
  }
  dom.statsBar.innerHTML = `
    <span class="nm-stat">总数: <span class="nm-stat-value">${stats.total || 0}</span></span>
    <span class="nm-stat">错误: <span class="nm-stat-value" style="color:${stats.errors > 0 ? 'var(--danger)' : 'inherit'}">${stats.errors || 0}</span></span>
    <span class="nm-stat">平均耗时: <span class="nm-stat-value">${stats.avgDuration || 0}ms</span></span>
  `;
}

function updateUI() {
  if (!dom || !dom.recordBtn) return;
  dom.recordBtn.innerHTML = _isRecording
    ? '<span class="nm-recording-dot"></span> 停止'
    : '▶ 捕获';
  dom.recordBtn.className = 'nm-btn' + (_isRecording ? ' recording' : '');
}

// ============================================================
// 工具函数
// ============================================================

function truncateUrl(url, maxLen) {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  // Try to keep the domain + path start
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const domain = parsed.hostname;
    const domainLen = domain.length + 8; // protocol + ://
    const remaining = maxLen - domainLen - 3; // ...
    if (remaining > 10) {
      return parsed.protocol + '//' + domain + path.slice(0, remaining) + '...';
    }
  } catch (e) { console.warn('[NetworkMonitor] truncateUrl parse error:', e?.message); }
  return url.slice(0, maxLen) + '...';
}

function formatDetail(entry) {
  const parts = [];
  parts.push(`URL: ${entry.url}`);
  parts.push(`Method: ${entry.method}`);
  parts.push(`Status: ${entry.status} ${entry.statusText || ''}`);
  parts.push(`Type: ${entry.type}`);
  parts.push(`Duration: ${entry.duration || 0}ms`);
  parts.push(`Time: ${entry.timestamp || ''}`);
  if (entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0) {
    parts.push(`\nRequest Headers:\n${JSON.stringify(entry.requestHeaders, null, 2).slice(0, 500)}`);
  }
  if (entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0) {
    parts.push(`\nResponse Headers:\n${JSON.stringify(entry.responseHeaders, null, 2).slice(0, 500)}`);
  }
  if (entry.body) {
    parts.push(`\nBody Preview:\n${entry.body.slice(0, 500)}`);
  }
  return parts.join('\n');
}

// ============================================================
// HAR 导出 / 导入
// ============================================================

/**
 * 将当前 entries 导出为 HAR 格式并触发下载。
 * HAR 规范: http://www.softwareishard.com/blog/har-12-spec/
 */
function exportHAR() {
  if (_entries.length === 0) {
    const toast = Q().showToast;
    if (toast) toast('没有数据可导出', 'info');
    return;
  }

  const har = {
    log: {
      version: '1.2',
      creator: {
        name: 'Hesi Network Monitor',
        version: '1.0',
      },
      entries: _entries.map(e => entryToHarEntry(e)),
    },
  };

  const json = JSON.stringify(har, null, 2);
  const blob = new Blob([json], { type: 'application/har+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `network-traffic-${Date.now()}.har`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const toast = Q().showToast;
  if (toast) toast(`📤 已导出 ${_entries.length} 条请求为 HAR 文件`, 'success');
}

/**
 * 将内部 entry 对象转换为 HAR 规范格式。
 */
function entryToHarEntry(e) {
  // 解析 URL 获取查询参数
  const queryString = [];
  try {
    const parsed = new URL(e.url);
    parsed.searchParams.forEach((value, name) => {
      queryString.push({ name, value });
    });
  } catch (e) { console.warn('[NetworkMonitor] URL parse error in HAR entry:', e?.message); }

  // 转换请求头
  const reqHeaders = objectToHarHeaders(e.requestHeaders || {});
  const resHeaders = objectToHarHeaders(e.responseHeaders || {});

  // 估算 body 大小
  const bodySize = e.body ? e.body.length : -1;

  // 根据 Content-Type 决定 mimeType
  let mimeType = 'application/octet-stream';
  for (const h of resHeaders) {
    if (h.name.toLowerCase() === 'content-type') {
      mimeType = h.value;
      break;
    }
  }

  // 时间戳
  const startTime = e.timestamp || new Date().toISOString();
  const duration = e.duration || 0;

  return {
    startedDateTime: startTime,
    time: duration,
    request: {
      method: e.method || 'GET',
      url: e.url,
      httpVersion: 'HTTP/1.1',
      headers: reqHeaders,
      queryString: queryString,
      cookies: [],
      headersSize: -1,
      bodySize: e.body ? e.body.length : -1,
      postData: (e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH') && e.body ? {
        mimeType: mimeType,
        text: e.body.slice(0, 10000),
        size: bodySize,
      } : undefined,
    },
    response: {
      status: e.status || 0,
      statusText: e.statusText || '',
      httpVersion: 'HTTP/1.1',
      headers: resHeaders,
      cookies: [],
      content: {
        size: bodySize,
        mimeType: mimeType,
        text: e.body ? e.body.slice(0, 10000) : undefined,
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: bodySize,
    },
    cache: {},
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      send: 0,
      wait: duration,
      receive: 0,
      ssl: -1,
    },
    _resourceType: e.type || 'xhr',
    _error: e.error || false,
  };
}

/**
 * 将 { key: value } 对象转换为 HAR header 数组。
 */
function objectToHarHeaders(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .filter(([_, v]) => v != null)
    .map(([k, v]) => ({ name: k, value: String(v) }));
}

/**
 * 从 HAR 文件导入网络请求数据。
 */
function importHAR() {
  // 创建隐藏的 file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.har,application/json,application/har+json';

  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const har = JSON.parse(text);

      if (!har.log || !har.log.entries) {
        throw new Error('无效的 HAR 文件：缺少 log.entries');
      }

      // 如果正在录制，先停止
      if (_isRecording) {
        await stopCapture();
      }

      // 转换 HAR entries 到内部格式
      const imported = har.log.entries.map(convertHarEntry);

      // 替换当前数据
      const toast = Q().showToast;
      _entries = imported;
      renderList();
      updateStats({
        total: _entries.length,
        errors: _entries.filter(entry => entry.error).length,
        byMethod: {},
        byType: {},
        avgDuration: _entries.reduce((s, entry) => s + (entry.duration || 0), 0) / Math.max(1, _entries.length),
      });

      if (toast) toast(`📥 已导入 ${imported.length} 条 HAR 请求记录`, 'success');
    } catch (err) {
      const toast = Q().showToast;
      if (toast) toast(`❌ HAR 导入失败: ${err.message}`, 'error');
    }
  });

  input.click();
}

/**
 * 将 HAR 格式的 entry 转换回内部数据格式。
 */
function convertHarEntry(harEntry) {
  const req = harEntry.request || {};
  const res = harEntry.response || {};
  const content = res.content || {};

  // 从 headers 数组转回对象
  const reqHeaders = {};
  if (Array.isArray(req.headers)) {
    for (const h of req.headers) {
      reqHeaders[h.name] = h.value;
    }
  }

  const resHeaders = {};
  if (Array.isArray(res.headers)) {
    for (const h of res.headers) {
      resHeaders[h.name] = h.value;
    }
  }

  return {
    id: 'har-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    url: req.url || '',
    method: req.method || 'GET',
    type: harEntry._resourceType || 'xhr',
    status: res.status || 0,
    statusText: res.statusText || '',
    requestHeaders: reqHeaders,
    responseHeaders: resHeaders,
    body: content.text || '',
    duration: harEntry.time || harEntry.timings?.wait || 0,
    timestamp: harEntry.startedDateTime || new Date().toISOString(),
    error: harEntry._error || (res.status >= 400),
  };
}

// ============================================================
// 初始化
// ============================================================

function init(container) {
  container.innerHTML = `
    <div class="nm-panel">
      <div class="nm-toolbar">
        <button class="nm-btn" id="nm-record-btn">${_isRecording ? '⏹ 停止' : '▶ 捕获'}</button>
        <button class="nm-btn clear-btn" id="nm-clear-btn">🗑 清除</button>
        <button class="nm-btn" id="nm-refresh-btn">🔄 刷新</button>
        <button class="nm-btn" id="nm-export-btn" title="导出为 HAR 格式">📤 HAR</button>
        <button class="nm-btn" id="nm-import-btn" title="导入 HAR 文件">📥 HAR</button>
        <div class="nm-type-filter">
          <button class="nm-type-btn active" data-type="all">全部</button>
          <button class="nm-type-btn" data-type="fetch">Fetch</button>
          <button class="nm-type-btn" data-type="xhr">XHR</button>
        </div>
        <input type="text" class="nm-filter-input" id="nm-filter-input" placeholder="🔍 过滤 URL..." aria-label="过滤网络请求" />
      </div>
      <div class="nm-stats-bar" id="nm-stats-bar">
        <span class="nm-stat">暂无数据</span>
      </div>
      <div class="nm-list" id="nm-list"></div>
    </div>
  `;

  dom = {
    panel: container,
    list: container.querySelector('#nm-list'),
    statsBar: container.querySelector('#nm-stats-bar'),
    recordBtn: container.querySelector('#nm-record-btn'),
    filterInput: container.querySelector('#nm-filter-input'),
  };

  // Record button
  dom.recordBtn.addEventListener('click', async () => {
    if (_isRecording) {
      await stopCapture();
    } else {
      _entries = [];
      renderList();
      await startCapture();
    }
  });

  // Clear button
  container.querySelector('#nm-clear-btn').addEventListener('click', async () => {
    if (_isRecording) await stopCapture();
    await clearEntries();
  });

  // Refresh button
  container.querySelector('#nm-refresh-btn').addEventListener('click', fetchEntries);

  // Export HAR button
  container.querySelector('#nm-export-btn').addEventListener('click', exportHAR);

  // Import HAR button
  container.querySelector('#nm-import-btn').addEventListener('click', importHAR);

  // Type filter
  container.querySelectorAll('.nm-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.nm-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _typeFilter = btn.dataset.type;
      renderList();
    });
  });

  // Search filter
  dom.filterInput.addEventListener('input', (e) => {
    _filterText = e.target.value;
    renderList();
  });

  // Load existing entries
  fetchEntries();
}

// ============================================================
// 注册到 UIRegistry
// ============================================================

(function register() {
  const Qq = /** @type {QCLI} */ (window.QCLI || {});
  const UIR = Qq.UIRegistry;

  if (!UIR) {
    console.warn('[NetworkMonitor] UIRegistry not available, will retry');
    setTimeout(register, 500);
    return;
  }

  const ok = UIR.registerTab('network-monitor', {
    category: "other",
    icon: '🌐',
    label: '网络监控',
    order: 40,
    render: (container) => init(container),
  });

  if (ok) {
    console.log('[NetworkMonitor] Panel registered as "network-monitor" tab');
  }

  // Register command palette command
  UIR.registerCommand('network-monitor:open', {
    icon: '🌐',
    name: '打开网络监控',
    desc: '监控浏览器网络请求',
    category: 'browser',
    execute: () => {
      const Qright = Qq.RightPanel;
      if (Qright) {
        if (Qright.collapsed) Qright.open();
        Qright.switchTab('network-monitor');
      }
    },
  });

  // Inject CSS
  Qq.injectCSS('/css/network-monitor.css');
})();
