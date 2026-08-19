/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Process Manager — spawn, monitor, and restart MCP child
//
// Extracted from server.js to reduce main file size and make
// MCP lifecycle testable in isolation.
// ============================================================
const childProcess = require('child_process');
const path = require('path');

/**
 * @typedef {object} MCPOptions
 * @property {boolean}  [withMcp=false]       — auto-start MCP on construction
 * @property {object}   [wsManager]           — used for broadcast(METRIC events)
 * @property {number}   [heartbeatInterval]   — health check interval ms (default 30000)
 * @property {number}   [heartbeatTimeout]    — no-data timeout ms (default 120000)
 * @property {number}   [maxRestarts]         — max restart attempts (default 5)
 */

class MCPProcessManager {
  /** @type {MCPProcessManager|null} 当前活跃实例（供退出钩子回收子进程） */
  static _activeInstance = null;
  /** @type {boolean} 退出钩子是否已在进程级注册（只注册一次） */
  static _exitHookRegistered = false;

  /**
   * @param {MCPOptions} [opts={}]
   */
  constructor(opts = {}) {
    /** @type {import('child_process').ChildProcess|null} */
    this.mcpProcess = null;
    this.mcpHeartbeatTimer = null;
    this.mcpSpawnTime = 0;
    this.mcpLastActivity = 0;
    this.mcpRestartCount = 0;
    this.mcpRestartTimeout = null;

    // Private telemetry
    this._mcpPid = null;
    this._mcpStdoutBytes = 0;
    this._mcpStderrBytes = 0;
    this._mcpMetricCount = 0;

    // Config
    this.wsManager = opts.wsManager || null;
    this.heartbeatInterval = opts.heartbeatInterval || 30000;
    this.heartbeatTimeout = opts.heartbeatTimeout || 120000;
    this.maxRestarts = opts.maxRestarts || 5;

    if (opts.withMcp) {
      this.spawn();
    }

    // 父进程退出兜底：即使 shutdown() 未被调用（如 process.exit 的其它路径、
    // 未捕获异常），也在退出瞬间同步杀掉 MCP 子进程，避免孤儿 node 进程残留。
    // 仅注册一次，且为同步钩子（process 'exit' 不允许异步）。
    if (!MCPProcessManager._exitHookRegistered) {
      MCPProcessManager._exitHookRegistered = true;
      process.once('exit', () => {
        const proc = MCPProcessManager._activeInstance && MCPProcessManager._activeInstance.mcpProcess;
        if (proc && proc.exitCode === null) {
          try { proc.kill(); } catch (e) { /* already exited */ }
        }
      });
    }
    MCPProcessManager._activeInstance = this;
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  /** Current child-process reference (may be null). */
  get process() { return this.mcpProcess; }

  /** Is MCP currently running? */
  get isRunning() {
    return this.mcpProcess !== null && this.mcpProcess.exitCode === null;
  }

  /** Uptime in ms, or 0 if not running. */
  get uptime() {
    return this.mcpSpawnTime > 0 ? Date.now() - this.mcpSpawnTime : 0;
  }

  /** Metrics accumulated over the lifetime of this manager. */
  get stats() {
    return {
      pid: this._mcpPid,
      restartCount: this.mcpRestartCount,
      stdoutBytes: this._mcpStdoutBytes,
      stderrBytes: this._mcpStderrBytes,
      metricCount: this._mcpMetricCount,
      uptimeMs: this.uptime,
    };
  }

  /**
   * Start (or restart) the MCP child process.
   * Safe to call multiple times — previous process is killed first.
   */
  spawn() {
    this._clearTimers();
    this._killExisting();

    const cwd = path.join(__dirname, '..');
    this.mcpSpawnTime = Date.now();
    this.mcpLastActivity = Date.now();
    this._mcpPid = null;
    this._mcpStdoutBytes = 0;
    this._mcpStderrBytes = 0;
    this._mcpMetricCount = 0;

    console.log(`[MCP] Starting MCP server as child process... (restart #${this.mcpRestartCount})`);

    try {
      // 用 process.execPath 而非裸 'node'：Windows 下避免依赖 PATH 解析，
      // 并确保子进程与父进程使用同一个 node 二进制（版本一致）。
      this.mcpProcess = childProcess.spawn(process.execPath, ['mcp-server.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
      });
    } catch (err) {
      console.error(`[MCP] ❌ spawn() failed: ${err.message}`);
      this.mcpProcess = null;
      this._scheduleRestart();
      return;
    }

    this._mcpPid = this.mcpProcess.pid;
    console.log(`[MCP] Spawned | pid=${this._mcpPid} | node=mcp-server.js`);
    this.mcpProcess.unref();

    this._wireStdio();
    this._wireLifecycle();
    this._startHeartbeat();
  }

  /**
   * Gracefully shut down the MCP child process and stop timers.
   */
  shutdown() {
    this._clearTimers();
    this._killExisting();
    this.mcpProcess = null;
    console.log('[MCP] Shutdown complete');
  }

  // ──────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────

  _clearTimers() {
    if (this.mcpHeartbeatTimer) {
      clearInterval(this.mcpHeartbeatTimer);
      this.mcpHeartbeatTimer = null;
    }
    if (this.mcpRestartTimeout) {
      clearTimeout(this.mcpRestartTimeout);
      this.mcpRestartTimeout = null;
    }
  }

  _killExisting() {
    if (this.mcpProcess && this.mcpProcess.exitCode === null) {
      try {
        this.mcpProcess.kill();
        console.log(`[MCP] Killed old process before restart | pid=${this._mcpPid}`);
      } catch (e) {
        // MCP already exited — expected if process crashed before kill; safe to ignore
      }
      this.mcpProcess.removeAllListeners();
    }
    this.mcpProcess = null;
  }

  _wireStdio() {
    const proc = this.mcpProcess;
    if (!proc) return;

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const bytes = Buffer.byteLength(text);
      this._mcpStderrBytes += bytes;
      this.mcpLastActivity = Date.now();
      this.mcpRestartCount = 0;
      process.stderr.write(text);

      // 计数与广播解耦：指标计数始终进行（属诊断指标，不依赖广播接线）；
      // 仅当 wsManager 存在时才把 METRIC 事件广播出去。
      let lineMetricCount = 0;
      for (const line of text.split('\n').filter(Boolean)) {
        if (line.startsWith('[METRIC]')) {
          try {
            const payload = JSON.parse(line.replace('[METRIC] ', ''));
            this._mcpMetricCount++;
            lineMetricCount++;
            if (this.wsManager && this.wsManager.broadcast) {
              this.wsManager.broadcast({ type: 'mcp_metric', data: payload });
            }
          } catch (e) {
            // JSON parse errors are expected for non-METRIC stderr lines — skip silently
            if (e instanceof SyntaxError) {
              // malformed METRIC line, skip
            } else {
              // broadcast failure — log for observability
              console.warn(`[MCP] METRIC broadcast failed: ${e?.message}`);
            }
          }
        }
      }
      if (lineMetricCount > 0) {
        console.log(`[MCP] stderr | pid=${this._mcpPid} | bytes=${bytes} | metrics=${lineMetricCount} | totalMetrics=${this._mcpMetricCount}`);
      }
    });

    proc.stderr.on('error', (err) => {
      console.error(`[MCP] ⚠ stderr pipe error | pid=${this._mcpPid} | err=${err.message}`);
    });

    proc.stdout.on('data', (chunk) => {
      const bytes = Buffer.byteLength(chunk);
      this._mcpStdoutBytes += bytes;
      this.mcpLastActivity = Date.now();
      this.mcpRestartCount = 0;
      process.stdout.write(chunk);
      console.log(`[MCP] stdout | pid=${this._mcpPid} | bytes=${bytes} | totalStdout=${this._mcpStdoutBytes}`);
    });

    proc.stdout.on('error', (err) => {
      console.error(`[MCP] ⚠ stdout pipe error | pid=${this._mcpPid} | err=${err.message}`);
    });
  }

  _wireLifecycle() {
    const proc = this.mcpProcess;
    if (!proc) return;

    proc.on('exit', (code, signal) => {
      const duration = this.uptime;
      const durStr = duration >= 60000
        ? `${(duration / 1000 / 60).toFixed(1)}m ${duration % 60000 / 1000}s`
        : `${(duration / 1000).toFixed(1)}s`;
      const signalStr = signal ? ` | signal=${signal}` : '';
      const crashStr = code !== 0 ? ' ⚠ (non-zero exit)' : '';
      console.log(`[MCP] ⏹ Child exited | pid=${this._mcpPid} | code=${code}${signalStr} | duration=${durStr} | stdout=${this._mcpStdoutBytes} bytes | stderr=${this._mcpStderrBytes} bytes | metrics=${this._mcpMetricCount}${crashStr}`);

      if (this.mcpProcess) {
        this.mcpProcess.removeAllListeners();
        this.mcpProcess = null;
      }
      this._mcpPid = null;
      this._scheduleRestart();
    });

    proc.on('error', (err) => {
      console.error(`[MCP] ❌ Failed to start | pid=${this._mcpPid || 'N/A'} | err=${err.message}`);
      if (this.mcpProcess) {
        this.mcpProcess.removeAllListeners();
        this.mcpProcess = null;
      }
      this._scheduleRestart();
    });

    proc.on('close', (code, signal) => {
      console.log(`[MCP] 🔌 Child stdio closed | pid=${this._mcpPid} | code=${code} | signal=${signal}`);
    });
  }

  _startHeartbeat() {
    this.mcpHeartbeatTimer = setInterval(() => this._checkHealth(), this.heartbeatInterval);
    this.mcpHeartbeatTimer.unref();
  }

  _checkHealth() {
    if (this.mcpRestartTimeout) return;
    if (!this.mcpProcess && this.mcpRestartCount >= this.maxRestarts) return;

    const now = Date.now();
    const alive = this.mcpProcess && this.mcpProcess.exitCode === null;

    if (!alive && this.mcpProcess === null) {
      console.warn(`[MCP] Health check: process dead, scheduling restart | restartCount=${this.mcpRestartCount}`);
      this._scheduleRestart();
      return;
    }

    if (alive) {
      const idleMs = now - this.mcpLastActivity;
      if (idleMs > this.heartbeatTimeout) {
        console.warn(`[MCP] Health check: no data for ${(idleMs / 1000).toFixed(0)}s (timeout=${(this.heartbeatTimeout / 1000).toFixed(0)}s) | pid=${this._mcpPid} | killing...`);
        try {
          try { this.mcpProcess.kill('SIGTERM'); } catch (e) {
            // graceful shutdown not possible; fall through to SIGKILL
          }
          setTimeout(() => {
            try {
              if (this.mcpProcess && this.mcpProcess.exitCode === null) {
                this.mcpProcess.kill('SIGKILL');
              }
            } catch (e) {
              // forced kill raced with process exit; harmless
            }
          }, 3000).unref();
        } catch (e) {
          console.error(`[MCP] kill failed: ${e.message}`);
          this.mcpProcess = null;
          this._scheduleRestart();
        }
      }
    }
  }

  _scheduleRestart() {
    if (this.mcpRestartTimeout) {
      clearTimeout(this.mcpRestartTimeout);
      this.mcpRestartTimeout = null;
    }
    if (this.mcpRestartCount >= this.maxRestarts) {
      console.error(`[MCP] Max restarts (${this.maxRestarts}) reached, giving up`);
      return;
    }

    this.mcpRestartCount++;
    const delay = Math.min(Math.pow(2, this.mcpRestartCount) * 1000, 30000);
    console.log(`[MCP] Restart scheduled in ${(delay / 1000).toFixed(0)}s | attempt=${this.mcpRestartCount}/${this.maxRestarts}`);

    this.mcpRestartTimeout = setTimeout(() => {
      this.mcpRestartTimeout = null;
      this.spawn();
    }, delay);
    this.mcpRestartTimeout.unref();
  }
}

module.exports = { MCPProcessManager };
