// @ts-check
// ============================================================
// System Route — process inspection & control
//
// GET  /api/system/process-stats   — CPU/MEM per running PTY process
// GET  /api/system/process-detail  — on-demand detail for a single PID
// POST /api/system/kill-process     — terminate a PID (SIGTERM/SIGKILL or taskkill)
//
// Shared state/helpers come from ./monitoring (imported by reference so
// mutations stay visible across modules).
// ============================================================
const express = require('express');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const {
  isWin,
  _procStatsCache,
  _cpuState,
} = require('./monitoring');

/**
 * Create the process-inspection sub-router.
 * @param {Map<WebSocket, Map<string, {pty: object, cliId: string, name: string}>>} activePTYs
 * @returns {import('express').Router}
 */
function createProcessRouter(activePTYs) {
  const router = express.Router();

  // ── GET /api/system/process-stats ──────────────────────
  // Optimized: single async exec per platform (batch query all PIDs)
  router.get('/system/process-stats', async (req, res) => {
    // ── Cache check: return cached response if within 500ms ──
    const now = Date.now();
    if (_procStatsCache.response && (now - _procStatsCache.ts) < _procStatsCache.TTL) {
      // Return cached response with fresh timestamp (don't mutate cached object)
      return res.json(Object.assign({}, _procStatsCache.response, { ts: now }));
    }

    // ── Step 1: Collect all PIDs and their tab metadata ──
    /** @type {Array<{tabId: string, cliId: string, name: string, pid: number}>} */
    const pids = [];
    for (const [, tabs] of activePTYs) {
      for (const [tabId, tab] of tabs) {
        const pty = tab.pty;
        if (!pty || typeof pty.pid !== 'number') continue;
        pids.push({
          tabId,
          cliId: tab.cliId || '',
          name: tab.name || tab.cliId || 'Unknown',
          pid: pty.pid,
        });
      }
    }

    if (pids.length === 0) {
      return res.json({ success: true, processes: [], total: 0, ts: Date.now() });
    }

    // ── Step 2: Batch query all PIDs in a single async exec ──
    /** @type {Map<number, {cpu: number, memKB: number}>} */
    const statsMap = new Map();

    // Track the set of PIDs we found for history cleanup
    const foundPids = new Set();

    try {
      if (isWin) {
        // Windows: single tasklist returns ALL processes, filter by PID locally
        try {
          const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 2000, windowsHide: true });
          const lines = stdout.trim().split(/\r?\n/);
          const pidSet = new Set(pids.map(p => p.pid));
          for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].split('","');
            if (parts.length >= 5) {
              const pid = parseInt(parts[1].replace(/"/g, ''), 10);
              if (pidSet.has(pid)) {
                const memStr = parts[4].replace(/[,"\r\n\s"]/g, '');
                const memKB = parseInt(memStr, 10) || 0;
                statsMap.set(pid, { cpu: 0, memKB });
                foundPids.add(pid);
                pidSet.delete(pid);
              }
            }
          }          } catch (_e) {
            console.warn('[System] tasklist query failed:', _e.message);
          }
      } else {
        // Linux/Mac: ps accepts comma-separated PIDs in a single call
        const pidList = pids.map(p => p.pid).join(',');
        try {
          const { stdout } = await execAsync(
            `ps -p ${pidList} -o pid,%cpu,rss --no-headers 2>/dev/null`,
            { timeout: 2000 }
          );
          const lines = stdout.trim().split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 3) {
              const pid = parseInt(parts[0], 10);
              const cpu = parseFloat(parts[1]) || 0;
              const memKB = parseInt(parts[2], 10) || 0;
              statsMap.set(pid, { cpu, memKB });
              foundPids.add(pid);
            }
          }          } catch (_e) {
            console.warn('[System] ps query failed:', _e.message);
          }
      }
    } catch (e) {
      console.warn('[System] Batch process query failed:', e.message);
    }

    // ── Step 2b: Clean up stale CPU history entries ──
    // Remove history for PIDs no longer in the active set to prevent memory leak
    for (const pid of _cpuState._history.keys()) {
      if (!foundPids.has(pid)) {
        _cpuState._history.delete(pid);
      }
    }

    // ── Step 3: Build response ──
    const processes = pids.map(p => {
      const stat = statsMap.get(p.pid);
      const alive = !!stat;
      const cpu = stat ? stat.cpu : 0;
      const memKB = stat ? stat.memKB : 0;
      return {
        tabId: p.tabId,
        cliId: p.cliId,
        name: p.name,
        pid: p.pid,
        cpu: parseFloat(cpu.toFixed(1)),
        memKB,
        memMB: Math.round(memKB / 1024),
        alive,
      };
    });

    const response = {
      success: true,
      processes,
      total: processes.length,
      ts: now,
    };

    // Cache the response
    _procStatsCache.response = response;
    _procStatsCache.ts = now;

    res.json(response);
  });

  // ── GET /api/system/process-detail?pid=NNNN ───────────-
  // On-demand detail for a single process (threads, handles, CPU time)
  router.get('/system/process-detail', (req, res) => {
    const pid = parseInt(req.query.pid, 10);
    if (!pid || isNaN(pid)) {
      return res.json({ success: false, error: 'Missing or invalid pid' });
    }

    const detail = { pid, threads: 0, handles: 0, cpuTime: '', cmdLine: '' };

    try {
      if (isWin) {
        // Windows: use tasklist for basic info, skip wmic (deprecated)
        // CPU time from tasklist
        try {
          const taskOut = execSync(
            `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
            { timeout: 1500, encoding: 'utf8', windowsHide: true }
          );
          const parts = taskOut.trim().split('","');
          if (parts.length >= 5) {
            detail.imageName = parts[0].replace(/"/g, '').trim();
            detail.cpuTime = 'N/A'; // tasklist without /v doesn't include CPU time
          }
        } catch (e) {
          console.warn('[System] Tasklist process detail query failed:', e.message);
        }
      } else {
        // Linux/Mac: detailed ps output
        const out = execSync(
          `ps -p ${pid} -o pid,%cpu,rss,time,nlwp,args 2>/dev/null`,
          { timeout: 2000, encoding: 'utf8' }
        );
        const lines = out.trim().split(/\r?\n/);
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 6) {
            detail.cpu = parseFloat(parts[1]) || 0;
            detail.rss = parseInt(parts[2], 10) || 0;
            detail.cpuTime = parts[3] || '';
            detail.threads = parseInt(parts[4], 10) || 0;
            detail.cmdLine = parts.slice(5).join(' ');
          }
        }
        // Handle count: On Linux, read from /proc/PID/status
        try {
          const statusOut = execSync(
            `grep -E "^(Threads|FDSize):" /proc/${pid}/status 2>/dev/null | cut -d: -f2`,
            { timeout: 1000, encoding: 'utf8' }
          );
          const lines = statusOut.trim().split(/\r?\n/);
          if (lines.length >= 1) {
            detail.handles = parseInt(lines[1] || lines[0], 10) || 0;
          }
        } catch (e) {
          console.warn('[System] /proc status read failed:', e.message);
        }
      }
    } catch (e) {
      return res.json({ success: false, error: e.message });
    }

    res.json({ success: true, detail });
  });

  // ── POST /api/system/kill-process ──────────────────────
  // Send SIGTERM (Linux/Mac) or taskkill (Windows) to a PID
  router.post('/system/kill-process', (req, res) => {
    const pid = parseInt(req.body?.pid, 10);
    if (!pid || isNaN(pid)) {
      return res.json({ success: false, message: 'Missing or invalid pid' });
    }

    try {
      if (isWin) {
        // Windows: taskkill /F sends forceful termination (SIGTERM analog)
        execSync(`taskkill /PID ${pid} /T /F`, { timeout: 2000, encoding: 'utf8', windowsHide: true });
        res.json({ success: true, message: `进程 ${pid} 已终止`, signal: 'taskkill /F' });
      } else {
        // Linux/Mac: send SIGTERM first, then verify the process is actually gone.
        // NOTE: `kill -15` returns 0 as soon as the signal is *delivered*, not when the
        // process has *exited*. SIGTERM is async, so we must re-check liveness before
        // reporting success — otherwise a hung/ignoring process would be reported as killed.
        try {
          execSync(`kill -15 ${pid} 2>/dev/null`, { timeout: 1000, encoding: 'utf8' });
        } catch (e) {
          // kill -15 failed (e.g. permission / no such process) — fall through to the
          // liveness check below; if already dead it'll be caught there.
        }
        // Give the process a moment to exit, then probe liveness with `kill -0`.
        const alive = (p) => {
          try {
            execSync(`kill -0 ${p} 2>/dev/null`, { timeout: 1000, encoding: 'utf8' });
            return true; // still exists
          } catch (e) {
            return false; // gone (or no permission — treat as gone)
          }
        };
        let dead = !alive(pid);
        if (!dead) {
          // Graceful shot missed — escalate to SIGKILL and re-verify.
          try { execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 1000, encoding: 'utf8' }); } catch (e) { /* ignore */ }
          dead = !alive(pid);
        }
        if (dead) {
          res.json({ success: true, message: `进程 ${pid} 已终止`, signal: 'SIGTERM/SIGKILL' });
        } else {
          res.json({ success: false, message: `进程 ${pid} 仍存活，终止失败（可能权限不足或受保护）`, signal: null });
        }
      }
    } catch (e) {
      // Various exit codes & messages indicate process not found / already dead:
      //   Linux kill:   status=1, stderr="No such process"
      //   Windows taskkill: status=128, stderr="not found" / "没有找到"
      const isNotFound = e.status === 1 || e.status === 128
        || (e.message && (e.message.includes('not found') || e.message.includes('No such process') || e.message.includes('没有找到')))
        || (e.stderr && (e.stderr.includes('not found') || e.stderr.includes('No such process') || e.stderr.includes('没有找到')));
      res.json({
        success: isNotFound ? true : false,  // "already dead" is still success
        message: isNotFound ? `进程 ${pid} 已不存在` : `终止失败: ${e.message}`,
        signal: null,
      });
    }
  });

  return router;
}

module.exports = { createProcessRouter };
