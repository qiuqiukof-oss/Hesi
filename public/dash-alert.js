/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Alert Manager — Threshold-based alerting for system metrics
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */
// ============================================================
// Alert Manager — Memory, latency & process threshold alerts
// ============================================================
export const _AlertManager = {
  /** Active alerts (max 5) */
  _alerts: [],
  _maxAlerts: 5,
  /** Deduplication: key → last trigger time (ms) */
  _lastTriggers: {},
  _dedupMs: 60000,

  /** System thresholds */
  _thresholds: {
    memory: { warn: 1024, high: 1536 },       // RSS MB
    heap: { warn: 512, high: 768 },            // Heap MB
    disk: { warn: 80, high: 90 },              // Disk %
    latency: { warn: 500, high: 2000 },        // ms
  },

  /** Process thresholds */
  _procThresholds: {
    cpu: { warn: 80 },           // CPU %
    mem: { warn: 500 },          // MB
  },
  /** Per-process streaks for sustained threshold breach */
  _procStreaks: {},
  _STREAK_REQUIRED: 3,           // consecutive breaches before alerting

  /** Check system-level thresholds */
  checkThresholds(rssMB, heapMB, latency) {
    const t = this._thresholds;

    if (rssMB > t.memory.high) {
      this.addAlert('mem_high', '内存超限', `RSS ${rssMB.toFixed(0)}MB > ${t.memory.high}MB`, 'high');
    } else if (rssMB > t.memory.warn) {
      this.addAlert('mem_warn', '内存偏高', `RSS ${rssMB.toFixed(0)}MB > ${t.memory.warn}MB`, 'warning');
    } else {
      this._clearAlert('mem_high');
      this._clearAlert('mem_warn');
    }

    if (heapMB > t.heap.high) {
      this.addAlert('heap_high', '堆内存超限', `堆 ${heapMB.toFixed(0)}MB > ${t.heap.high}MB`, 'high');
    } else if (heapMB > t.heap.warn) {
      this.addAlert('heap_warn', '堆内存偏高', `堆 ${heapMB.toFixed(0)}MB > ${t.heap.warn}MB`, 'warning');
    } else {
      this._clearAlert('heap_high');
      this._clearAlert('heap_warn');
    }

    if (latency > t.latency.high) {
      this.addAlert('latency_high', '延迟过高', `${latency}ms > ${t.latency.high}ms`, 'high');
    } else if (latency > t.latency.warn) {
      this.addAlert('latency_warn', '延迟偏高', `${latency}ms > ${t.latency.warn}ms`, 'warning');
    } else {
      this._clearAlert('latency_high');
      this._clearAlert('latency_warn');
    }

    this.renderAlerts();
  },

  /** Check per-process thresholds */
  checkProcessThresholds(statsMap) {
    const pt = this._procThresholds;
    const now = Date.now();

    for (const [tabId, stat] of statsMap) {
      if (!stat || !stat.alive) {
        // Clear streak for dead processes
        delete this._procStreaks[tabId];
        this._clearAlert('proc_cpu_' + tabId);
        this._clearAlert('proc_mem_' + tabId);
        continue;
      }

      if (!this._procStreaks[tabId]) this._procStreaks[tabId] = { cpu: 0, mem: 0 };

      // CPU check
      if (stat.cpu > pt.cpu.warn) {
        this._procStreaks[tabId].cpu++;
        if (this._procStreaks[tabId].cpu >= this._STREAK_REQUIRED) {
          this.addAlert('proc_cpu_' + tabId, '进程 CPU 过高',
            `${stat.name || tabId}: CPU ${stat.cpu}%`, 'warning');
        }
      } else {
        this._procStreaks[tabId].cpu = 0;
        this._clearAlert('proc_cpu_' + tabId);
      }

      // Memory check
      if (stat.memMB > pt.mem.warn) {
        this._procStreaks[tabId].mem++;
        if (this._procStreaks[tabId].mem >= this._STREAK_REQUIRED) {
          this.addAlert('proc_mem_' + tabId, '进程内存过高',
            `${stat.name || tabId}: ${stat.memMB}MB`, 'warning');
        }
      } else {
        this._procStreaks[tabId].mem = 0;
        this._clearAlert('proc_mem_' + tabId);
      }
    }

    // Clear streaks for removed process IDs
    for (const tid in this._procStreaks) {
      if (!statsMap.has(tid)) {
        delete this._procStreaks[tid];
        this._clearAlert('proc_cpu_' + tid);
        this._clearAlert('proc_mem_' + tid);
      }
    }

    this.renderAlerts();
  },

  /** Add or update an alert with dedup */
  addAlert(key, title, detail, severity) {
    const now = Date.now();
    const last = this._lastTriggers[key] || 0;
    if (now - last < this._dedupMs) return; // dedup
    this._lastTriggers[key] = now;

    // Check if already in list
    const existing = this._alerts.find(a => a.key === key);
    if (existing) {
      existing.title = title;
      existing.detail = detail;
      existing.severity = severity;
      existing.ts = now;
      return;
    }

    this._alerts.push({ key, title, detail, severity, ts: now });
    if (this._alerts.length > this._maxAlerts) this._alerts.shift();
  },

  /** Remove alert by key */
  _clearAlert(key) {
    const idx = this._alerts.findIndex(a => a.key === key);
    if (idx !== -1) this._alerts.splice(idx, 1);
  },

  /** User dismiss */
  dismissAlert(key) {
    this._clearAlert(key);
    this.renderAlerts();
  },

  dismissAll() {
    this._alerts = [];
    this._lastTriggers = {};
    this._procStreaks = {};
    this.renderAlerts();
  },

  /** Render alerts to sidebar DOM */
  renderAlerts() {
    const container = document.getElementById('sidebar-alerts');
    if (!container) return;

    if (this._alerts.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = '';

    const severityConfig = {
      high: { icon: '🔴', color: 'var(--danger)' },
      warning: { icon: '🟡', color: 'var(--warning, #eab308)' },
      info: { icon: '🔵', color: 'var(--accent)' },
    };

    container.innerHTML = this._alerts.map(a => {
      const cfg = severityConfig[a.severity] || severityConfig.info;
      return `<div class=\"alert-item\" data-key=\"${a.key}\" style=\"border-left: 3px solid ${cfg.color};\">
        <div class=\"alert-item-header\">
          <span class=\"alert-item-icon\">${cfg.icon}</span>
          <span class=\"alert-item-title\">${a.title}</span>
          <span class=\"alert-item-close\" data-dismiss=\"${a.key}\" title=\"关闭\">✕</span>
        </div>
        <div class=\"alert-item-detail\">${a.detail}</div>
      </div>`;
    }).join('') +
      '<button class=\"sa-dismiss-all\" title=\"全部忽略\">全部忽略</button>';

    // Wire dismiss clicks via event delegation
    container.onclick = (e) => {
      const dismissBtn = e.target.closest('[data-dismiss]');
      if (dismissBtn) {
        this.dismissAlert(dismissBtn.dataset.dismiss);
      }
      const dismissAllBtn = e.target.closest('.sa-dismiss-all');
      if (dismissAllBtn) {
        this.dismissAll();
      }
    };
  },
};

// Expose on Q namespace for legacy compatibility
(window.QCLI || (window.QCLI = {}))._alertManager = _AlertManager;
