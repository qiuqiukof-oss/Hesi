/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// System Route — monitoring helpers & shared state
//
// Extracted from routes/system.js so the route module stays small.
// Holds the module-level cache/state objects and the (platform-specific)
// polling helpers used by the process-stats / overview routes.
// The route submodules (process.js / overview.js) import these by
// reference so mutations remain visible across modules.
// ============================================================
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');

const isWin = process.platform === 'win32';

// ── Short-lived cache for /system/process-stats (500ms TTL) ──
const _procStatsCache = {
  /** @type {object|null} */
  response: null,
  /** @type {number} timestamp of last fetch */
  ts: 0,
  /** TTL in ms */
  TTL: 500,
};

// ── CPU Time history for Windows tasklist delta-based CPU% ──
const _cpuState = {
  /** Map<pid, {cpuTime: number, ts: number}> */
  _history: new Map(),
  /** Number of logical CPUs */
  _numCpus: os.cpus().length,
};

// ── Network IO accumulators (delta from last poll) ──
const _netIoState = {
  _lastRxBytes: 0,
  _lastTxBytes: 0,
  _lastTs: 0,
  rxBytes: 0,
  txBytes: 0,
  rxPerSec: 0,
  txPerSec: 0,
  /** Cumulative bytes since server start */
  cumulativeRx: 0,
  cumulativeTx: 0,
};

/** Suppress repeated network IO poll failure warnings (log only once per 5 min window) */
let _netIOWarned = false;
let _netIOWarnedAt = 0;
const _NET_IO_WARN_COOLDOWN = 300_000; // 5 minutes

/**
 * Parse tasklist CPU Time string (HH:MM:SS) into total seconds.
 * Examples: "0:00:15" → 15, "1:30:45" → 5445
 * @param {string} str - CPU time string like "0:00:15"
 * @returns {number} Total seconds
 */
function _parseCpuTimeSeconds(str) {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.trim().split(':');
  if (parts.length !== 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseInt(parts[2], 10) || 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Calculate CPU% from CPU Time delta between consecutive tasklist polls.
 * On first poll for a PID, returns 0 (no delta available yet).
 * Capped at (numCPUs * 100)% max.
 * @param {number} pid
 * @param {string} cpuTimeStr
 * @param {number} now
 * @returns {number}
 */
function _calcCpuPercent(pid, cpuTimeStr, now) {
  const cpuTimeSecs = _parseCpuTimeSeconds(cpuTimeStr);
  const prev = _cpuState._history.get(pid);
  _cpuState._history.set(pid, { cpuTime: cpuTimeSecs, ts: now });

  if (!prev) return 0; // first sample

  const deltaCpu = cpuTimeSecs - prev.cpuTime;
  const deltaWall = (now - prev.ts) / 1000; // ms → seconds

  if (deltaWall <= 0 || deltaCpu < 0) return 0;

  const raw = (deltaCpu / deltaWall) * 100;
  return Math.min(raw, _cpuState._numCpus * 100);
}

/**
 * Poll network IO counters using platform command (async).
 * Uses netstat -e on Windows, /proc/net/dev on Linux, netstat -ib on Mac.
 */
async function _pollNetworkIOAsync() {
  try {
    const now = Date.now();
    let rx = 0, tx = 0;

    if (isWin) {
      // Windows: `netstat -e` returns interface-level bytes
      try {
        const { stdout } = await execAsync('netstat -e', { timeout: 1000, windowsHide: true });
        const lines = stdout.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('Bytes') || line.startsWith('收到')) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
              rx = parseInt(parts[1], 10) || 0;
              tx = parseInt(parts[2], 10) || 0;
            }
            break;
          }
        }
      } catch (_e) {
        // Silent fail — network IO will show 0
      }
    } else {
      try {
        const { stdout } = await execAsync('cat /proc/net/dev 2>/dev/null', { timeout: 1000 });
        const lines = stdout.split(/\r?\n/);
        let sumRx = 0, sumTx = 0;
        for (let i = 2; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length >= 10) {
            const iface = parts[0].replace(':', '');
            if (iface === 'lo') continue;
            sumRx += parseInt(parts[1], 10) || 0;
            sumTx += parseInt(parts[9], 10) || 0;
          }
        }
        rx = sumRx;
        tx = sumTx;
      } catch (e) {
        // Mac fallback
        try {
          const { stdout } = await execAsync('netstat -ib -I en0 2>/dev/null | tail -1', { timeout: 1000 });
          const parts = stdout.trim().split(/\s+/);
          if (parts.length >= 7) {
            rx = parseInt(parts[6], 10) || 0;
            tx = parseInt(parts[9], 10) || 0;
          }
        } catch (e2) {
          // Silent fail
        }
      }
    }

    // Compute delta-based rate
    const elapsed = now - _netIoState._lastTs;
    if (_netIoState._lastTs > 0 && elapsed > 0) {
      const rxDelta = Math.max(0, rx - _netIoState._lastRxBytes);
      const txDelta = Math.max(0, tx - _netIoState._lastTxBytes);
      _netIoState.rxPerSec = Math.round((rxDelta / elapsed) * 1000);
      _netIoState.txPerSec = Math.round((txDelta / elapsed) * 1000);
    }

    _netIoState._lastRxBytes = rx;
    _netIoState._lastTxBytes = tx;
    _netIoState._lastTs = now;
    _netIoState.rxBytes = rx;
    _netIoState.txBytes = tx;
    _netIoState.cumulativeRx = rx;
    _netIoState.cumulativeTx = tx;
  } catch (e) {
    const now = Date.now();
    if (!_netIOWarned || (now - _netIOWarnedAt > _NET_IO_WARN_COOLDOWN)) {
      console.warn('[System] Network IO poll failed:', e.message);
      _netIOWarned = true;
      _netIOWarnedAt = now;
    }
  }
}

/**
 * Poll network IO counters using platform command.
 * Uses netstat -e on Windows, /proc/net/dev on Linux, netstat -ib on Mac.
 * @deprecated Use _pollNetworkIOAsync instead. Kept for sync fallback.
 */
function _pollNetworkIO() {
  try {
    const now = Date.now();
    let rx = 0, tx = 0;

    if (isWin) {
      // Windows: `netstat -e` returns interface-level bytes (fast with short timeout)
      try {
        const out = execSync('netstat -e', { timeout: 1000, encoding: 'utf8', windowsHide: true });
        const lines = out.split(/\r?\n/);
        // After header, look for line like:  Bytes 12345 67890
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('Bytes') || line.startsWith('收到')) {
            // Format: Bytes   1234567   7654321
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
              rx = parseInt(parts[1], 10) || 0;
              tx = parseInt(parts[2], 10) || 0;
            }
            break;
          }
        }
      } catch (_e) {
        // Silent fail — network IO will show 0
      }
    } else {
      // Linux/Mac: read /proc/net/dev (Linux) or use netstat -ib (Mac)
      try {
        const out = execSync('cat /proc/net/dev 2>/dev/null', { timeout: 1000, encoding: 'utf8' });
        const lines = out.split(/\r?\n/);
        let sumRx = 0, sumTx = 0;
        for (let i = 2; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length >= 10) {
            const iface = parts[0].replace(':', '');
            // Skip loopback
            if (iface === 'lo') continue;
            sumRx += parseInt(parts[1], 10) || 0;  // bytes received
            sumTx += parseInt(parts[9], 10) || 0;  // bytes transmitted
          }
        }
        rx = sumRx;
        tx = sumTx;
      } catch (e) {
        // Mac fallback: try netstat -ib
        try {
          const out = execSync('netstat -ib -I en0 2>/dev/null | tail -1', { timeout: 1000, encoding: 'utf8' });
          const parts = out.trim().split(/\s+/);
          if (parts.length >= 7) {
            rx = parseInt(parts[6], 10) || 0;
            tx = parseInt(parts[9], 10) || 0;
          }
        } catch (e2) {
          // Silent fail — network IO will show 0
        }
      }
    }

    // Compute delta-based rate
    const elapsed = now - _netIoState._lastTs;
    if (_netIoState._lastTs > 0 && elapsed > 0) {
      const rxDelta = Math.max(0, rx - _netIoState._lastRxBytes);
      const txDelta = Math.max(0, tx - _netIoState._lastTxBytes);
      _netIoState.rxPerSec = Math.round((rxDelta / elapsed) * 1000);
      _netIoState.txPerSec = Math.round((txDelta / elapsed) * 1000);
    }

    _netIoState._lastRxBytes = rx;
    _netIoState._lastTxBytes = tx;
    _netIoState._lastTs = now;
    _netIoState.rxBytes = rx;
    _netIoState.txBytes = tx;
    // Cumulative is the raw counter value
    _netIoState.cumulativeRx = rx;
    _netIoState.cumulativeTx = tx;
  } catch (e) {
    const now = Date.now();
    if (!_netIOWarned || (now - _netIOWarnedAt > _NET_IO_WARN_COOLDOWN)) {
      console.warn('[System] Network IO poll failed:', e.message);
      _netIOWarned = true;
      _netIOWarnedAt = now;
    }
  }
}

/**
 * Get disk usage stats asynchronously using PowerShell/df.
 * @returns {Promise<Array<{device:string, totalMB:number, usedMB:number, freeMB:number, usedPct:number}>>}
 */
async function _getDiskUsageAsync() {
  const disks = [];
  try {
    if (isWin) {
      try {
        const { stdout } = await execAsync(
          'powershell -NoProfile -NonInteractive -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Csv -NoTypeInformation"',
          { timeout: 1500, windowsHide: true }
        );
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 3) {
            const mountpoint = `${(parts[0] || '').replace(/"/g, '').trim()  }:`;
            const usedBytes = parseInt(parts[1], 10) || 0;
            const freeBytes = parseInt(parts[2], 10) || 0;
            const totalBytes = usedBytes + freeBytes;
            const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
            if (totalBytes > 0) {
              disks.push({
                mountpoint,
                totalMB: Math.round(totalBytes / 1048576),
                usedMB: Math.round(usedBytes / 1048576),
                freeMB: Math.round(freeBytes / 1048576),
                usedPercent,
              });
            }
          }
        }
      } catch (_psErr) {
        // PowerShell fallback: wmic as last resort
        try {
          const { stdout } = await execAsync(
            'wmic logicaldisk get deviceid,size,freespace /format:csv',
            { timeout: 1000, windowsHide: true }
          );
          const lines = stdout.split(/\r?\n/).filter(Boolean);
          if (lines.length > 1) {
            for (let i = 1; i < lines.length; i++) {
              const parts = lines[i].split(',');
              if (parts.length >= 4) {
                const mountpoint = (parts[1] || '').trim();
                const sizeBytes = parseInt(parts[3], 10) || 0;
                const freeBytes = parseInt(parts[2], 10) || 0;
                const usedBytes = sizeBytes - freeBytes;
                const usedPercent = sizeBytes > 0 ? Math.round((usedBytes / sizeBytes) * 100) : 0;
                if (sizeBytes > 0) {
                  disks.push({
                    mountpoint,
                    totalMB: Math.round(sizeBytes / 1048576),
                    usedMB: Math.round(usedBytes / 1048576),
                    freeMB: Math.round(freeBytes / 1048576),
                    usedPercent,
                  });
                }
              }
            }
          }
        } catch (_wmicErr) {
          // Both failed — return empty array
        }
      }
    } else {
      const { stdout } = await execAsync('df -k -P 2>/dev/null', { timeout: 1000 });
      const lines = stdout.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 6) {
          if (parts[0].startsWith('/dev/') || parts[5] === '/') {
            const totalKB = parseInt(parts[1], 10) || 0;
            const usedKB = parseInt(parts[2], 10) || 0;
            const freeKB = parseInt(parts[3], 10) || 0;
            const usedPercent = parseInt(parts[4], 10) || 0;
            disks.push({
              mountpoint: parts[5],
              totalMB: Math.round(totalKB / 1024),
              usedMB: Math.round(usedKB / 1024),
              freeMB: Math.round(freeKB / 1024),
              usedPercent,
            });
          }
        }
      }
    }
  } catch (e) {
    // Silent fail
  }
  return disks;
}

/**
 * Get disk usage stats using fs.statSync (non-blocking, no external commands).
 * @returns {Array<{device:string, totalMB:number, usedMB:number, freeMB:number, usedPct:number}>}
 */
function _getDiskUsage() {
  const disks = [];
  try {
    if (isWin) {
      // Windows: use PowerShell Get-PSDrive (fast, available on Win10+)
      try {
        const out = execSync(
          'powershell -NoProfile -NonInteractive -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | ConvertTo-Csv -NoTypeInformation"',
          { timeout: 1500, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        // CSV output: "Name","Used","Free"
        const lines = out.split(/\r?\n/).filter(Boolean);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 3) {
            const mountpoint = `${(parts[0] || '').replace(/"/g, '').trim()  }:`;
            const usedBytes = parseInt(parts[1], 10) || 0;
            const freeBytes = parseInt(parts[2], 10) || 0;
            const totalBytes = usedBytes + freeBytes;
            const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
            if (totalBytes > 0) {
              disks.push({
                mountpoint,
                totalMB: Math.round(totalBytes / 1048576),
                usedMB: Math.round(usedBytes / 1048576),
                freeMB: Math.round(freeBytes / 1048576),
                usedPercent,
              });
            }
          }
        }
      } catch (_psErr) {
        // PowerShell fallback: use os.networkInterfaces() + stat
        // Try `wmic` as last resort (may fail on Win11, quick timeout)
        try {
          const out = execSync(
            'wmic logicaldisk get deviceid,size,freespace /format:csv',
            { timeout: 1000, encoding: 'utf8', windowsHide: true }
          );
          const lines = out.split(/\r?\n/).filter(Boolean);
          if (lines.length > 1) {
            for (let i = 1; i < lines.length; i++) {
              const parts = lines[i].split(',');
              if (parts.length >= 4) {
                const mountpoint = (parts[1] || '').trim();
                const sizeBytes = parseInt(parts[3], 10) || 0;
                const freeBytes = parseInt(parts[2], 10) || 0;
                const usedBytes = sizeBytes - freeBytes;
                const usedPercent = sizeBytes > 0 ? Math.round((usedBytes / sizeBytes) * 100) : 0;
                if (sizeBytes > 0) {
                  disks.push({
                    mountpoint,
                    totalMB: Math.round(sizeBytes / 1048576),
                    usedMB: Math.round(usedBytes / 1048576),
                    freeMB: Math.round(freeBytes / 1048576),
                    usedPercent,
                  });
                }
              }
            }
          }
        } catch (_wmicErr) {
          // WMIC also failed — return empty array silently
        }
      }
    } else {
      // Linux/Mac: df -k -P (output in KB)
      const out = execSync('df -k -P 2>/dev/null', { timeout: 1000, encoding: 'utf8' });
      const lines = out.split(/\r?\n/);
      // Skip header line: Filesystem 1024-blocks Used Available Capacity Mounted on
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 6) {
          // Filter only local filesystems (ext4, xfs, apfs, tmpfs for root)
          if (parts[0].startsWith('/dev/') || parts[5] === '/') {
            const totalKB = parseInt(parts[1], 10) || 0;
            const usedKB = parseInt(parts[2], 10) || 0;
            const freeKB = parseInt(parts[3], 10) || 0;
            const usedPercent = parseInt(parts[4], 10) || 0;
            disks.push({
              mountpoint: parts[5],  // mount point
              totalMB: Math.round(totalKB / 1024),
              usedMB: Math.round(usedKB / 1024),
              freeMB: Math.round(freeKB / 1024),
              usedPercent,
            });
          }
        }
      }
    }
  } catch (e) {
    // Silent fail — disk info will be unavailable
  }
  return disks;
}

// ============================================================
// Poll network IO on module load (seed first snapshot) — non-blocking
// ============================================================
setTimeout(() => {
  try { _pollNetworkIO(); } catch (e) {
    console.warn('[System] Initial network IO poll failed:', e.message);
  }
}, 100);

module.exports = {
  isWin,
  _procStatsCache,
  _cpuState,
  _netIoState,
  _parseCpuTimeSeconds,
  _calcCpuPercent,
  _pollNetworkIOAsync,
  _pollNetworkIO,
  _getDiskUsageAsync,
  _getDiskUsage,
};
