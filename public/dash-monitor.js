/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// System Monitor — Resource, Throughput & Activity Tracking
// ============================================================

// IMPORTANT: Do NOT use `const Q = window.QCLI || {}` here.
// This module evaluates BEFORE dashboard.js sets window.QCLI.
// Always reference window.QCLI directly at runtime.

// ============================================================
// Monitor — Resource, Throughput & Activity Timeline Tracking
// ============================================================
export const _Monitor = {
  sys: { rss: 0, heap: 0, uptime: 0, nodeVer: '', platform: '', sessions: 0 },
  bytesSent: 0,
  bytesReceived: 0,
  latency: 0,
  _lastPingTime: 0,
  _pingInterval: null,
  timeline: [],
  _timelineMax: 30,
  _history: {
    rss: [], heap: [], latency: [], disk: [], rxRate: [], txRate: [],
    _maxPoints: 60,
  },
  overview: { disks: [], rxPerSec: 0, txPerSec: 0, cumulativeRx: 0, cumulativeTx: 0 },
  _procHistory: {},
  _procHistoryMax: 30,

  _recordHistory(key, value) {
    const arr = this._history[key];
    if (!arr) return;
    arr.push({ t: Date.now(), v: value });
    if (arr.length > this._history._maxPoints) arr.shift();
  },

  addEvent(type, detail) {
    this.timeline.push({ time: Date.now(), type, detail });
    if (this.timeline.length > this._timelineMax) this.timeline.shift();
  },

  recordReceived(data) {
    this.bytesReceived += (typeof data === 'string' ? data : JSON.stringify(data)).length;
  },

  resetSys() {
    this.sys = { rss: 0, heap: 0, uptime: 0, nodeVer: '', platform: '', sessions: 0 };
  },

  startPing() {
    this.stopPing();
    this._pingInterval = setInterval(() => {
      this._lastPingTime = Date.now();
      const _ws = (window.QCLI || {}).wsSend;
      if (_ws) _ws({ type: 'ping', ts: this._lastPingTime, _dashboard: true });
    }, 30000);
  },

  stopPing() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
  },

  handlePong(ts) {
    if (ts && this._lastPingTime > 0) this.latency = Date.now() - ts;
  },

  onWSMessage(data) {
    this.recordReceived(data);
    if (data && data.type === 'pong') this.handlePong(data.ts || data._echo);
  },
};

export let _throughputSetup = false;
export function setupThroughputTracking() {
  if (_throughputSetup) return;
  _throughputSetup = true;
  const Qcli = window.QCLI || {};
  const origSend = Qcli.wsSend;
  if (typeof origSend !== 'function') {
    setTimeout(setupThroughputTracking, 500);
    return;
  }
  Qcli.wsSend = function(data) {
    _Monitor.bytesSent += (typeof data === 'string' ? data : JSON.stringify(data)).length;
    return origSend.call(Qcli, data);
  };
  console.log('[Dashboard] Throughput tracking active');
}

export async function fetchSystemResources() {
  try { const r = await fetch('/health'); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
}

export async function fetchSystemOverview() {
  try { const r = await fetch('/api/system/overview'); return r.ok ? await r.json() : null; }
  catch (e) { return null; }
}

let _lastSysFetch = 0, _lastOverviewFetch = 0;

export function _updateSysResourcesThrottled() {
  const now = Date.now();
  if (now - _lastSysFetch < 5000) return;
  _lastSysFetch = now;
  updateSystemResources();
}

export function _updateSysOverviewThrottled() {
  const now = Date.now();
  if (now - _lastOverviewFetch < 10000) return;
  _lastOverviewFetch = now;
  updateSystemOverview();
}

/** 强制立即刷新系统资源与总览（忽略节流），用于面板变为可见/WS 重连时。 */
export function forceSystemRefresh() {
  _lastSysFetch = 0;
  _lastOverviewFetch = 0;
  updateSystemResources();
  updateSystemOverview();
}

export async function updateSystemResources() {
  const data = await fetchSystemResources();
  if (!data) return;
  _Monitor.sys = { rss: data.memory?.rss || 0, heap: data.memory?.heap || 0, uptime: data.uptime || 0, nodeVer: data.node || '', platform: data.platform || '', sessions: data.ws?.activeSessions || 0 };
  const u = await import('./dash-utils.js');
  const rssMB = _Monitor.sys.rss;
  const heapMB = _Monitor.sys.heap;
  u.setText('dash-sys-mem', rssMB+' MB'); u.setText('dash-sys-heap', heapMB+' MB');
  u.setText('dash-sys-uptime', u.formatDuration(_Monitor.sys.uptime));
  u.setText('dash-sys-platform', _Monitor.sys.platform);
  u.setText('dash-sys-node', _Monitor.sys.nodeVer);
  u.setText('dash-sys-sessions', _Monitor.sys.sessions);
  const rp = Math.min(100, (rssMB/2048)*100), hp = Math.min(100, (heapMB/1024)*100);
  const mb = document.getElementById('dash-sys-mem-bar'); if (mb) mb.style.width=rp+'%';
  const hb = document.getElementById('dash-sys-heap-bar'); if (hb) hb.style.width=hp+'%';
  const rn = parseFloat(rssMB), hn = parseFloat(heapMB);
  if (!isNaN(rn)) _Monitor._recordHistory('rss', rn);
  if (!isNaN(hn)) _Monitor._recordHistory('heap', hn);
}

export async function updateSystemOverview() {
  const data = await fetchSystemOverview();
  if (!data) return;
  const u = await import('./dash-utils.js');
  _Monitor.overview = { disks: data.disks||[], rxPerSec: data.rxPerSec||0, txPerSec: data.txPerSec||0, cumulativeRx: data.cumulativeRx||0, cumulativeTx: data.cumulativeTx||0 };
  const dg = document.getElementById('dash-disk-gauges');
  if (dg && data.disks) {
    const ds = data.disks.map(d=>d.usedPercent?.toFixed(1)).join(',');
    if (dg.dataset.serial !== ds) {
      dg.dataset.serial = ds;
      const dwd = data.disks.filter(d=>d.usedPercent!==undefined);
      if (dwd.length > 0) {
        _Monitor._recordHistory('disk', dwd.reduce((s,d)=>s+d.usedPercent,0)/dwd.length);
        dg.innerHTML = dwd.map(d => {
          const pct = d.usedPercent.toFixed(1);
          const color = pct>90?'var(--danger)':pct>75?'var(--warning, #eab308)':'var(--success)';
          return `<div class="dash-sys-gauge"><div class="dash-sys-gauge-header"><span class="dash-sys-gauge-label">💾 ${d.mountpoint||d.fs||'磁盘'}</span><span class="dash-sys-gauge-value">${pct}%</span></div><div class="dash-progress"><div class="dash-progress-bar gauge-bar-disk" style="width:${pct}%;background:${color}"></div></div></div>`;
        }).join('');
      }
    }
  }
  u.setText('dash-net-rx', _Monitor.overview.rxPerSec>0?u.formatBytes(_Monitor.overview.rxPerSec)+'/s':'—');
  u.setText('dash-net-tx', _Monitor.overview.txPerSec>0?u.formatBytes(_Monitor.overview.txPerSec)+'/s':'—');
  u.setText('dash-net-cumulative',(_Monitor.overview.cumulativeRx>0||_Monitor.overview.cumulativeTx>0)?'📥 '+u.formatBytes(_Monitor.overview.cumulativeRx)+' / 📤 '+u.formatBytes(_Monitor.overview.cumulativeTx):'—');
  const rxBar=document.getElementById('dash-net-rx-bar');if(rxBar)rxBar.style.width=Math.min(100,(_Monitor.overview.rxPerSec/(50*1048576))*100)+'%';
  const txBar=document.getElementById('dash-net-tx-bar');if(txBar)txBar.style.width=Math.min(100,(_Monitor.overview.txPerSec/(50*1048576))*100)+'%';
  _Monitor._recordHistory('rxRate', _Monitor.overview.rxPerSec);
  _Monitor._recordHistory('txRate', _Monitor.overview.txPerSec);
}
