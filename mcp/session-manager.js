/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Session Manager — persistent WS session pool
//
// Manages a pool of long-lived terminal sessions. Each session
// wraps a WebSocket connection to the Hesi server + a PTY tab.
// Output is buffered in a ring buffer for later readback.
// Sessions auto-expire after TTL.
// ============================================================
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const stripAnsiMod = require("strip-ansi");
const stripAnsi = stripAnsiMod.default || stripAnsiMod;

const { RingBuffer } = require('../ring-buffer');

// ── Session ──
class Session {
  constructor(cliId, wsUrl) {
    this.id = uuidv4();
    this.cliId = cliId;
    this.state = "starting"; // starting → running → killed | timedout
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.buffer = new RingBuffer();
    this.exitCode = null;
    this._expectExitCode = false;
    this._ws = null;
    this._drainTimer = null;
    this._ttlTimer = null;
    this._wsUrl = wsUrl;
    this._resolveReady = null;
    this._ready = new Promise((resolve) => { this._resolveReady = resolve; });
    this._pendingResolve = null; // for poll-mode read
  }

  get alive() {
    return this.state === "starting" || this.state === "running";
  }

  get age() {
    return Date.now() - this.createdAt;
  }

  get idle() {
    return Date.now() - this.lastActivity;
  }

  /**
   * Connect to Hesi via WS and launch the CLI PTY.
   */
  async connect(extraEnv) {
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._wsUrl);
      } catch (err) {
        this.state = "killed";
        reject(err);
        return;
      }

      // Connection timeout — reject if WebSocket doesn't open within 10s
      const connectTimeout = setTimeout(() => {
        this.state = "killed";
        this._cleanup();
        reject(new Error(`WebSocket connection timed out (${this._wsUrl})`));
      }, config.wsConnectTimeoutMs || 10000);

      const tabId = `mcp-${this.id}`;

      this._ws.on("open", () => {
        clearTimeout(connectTimeout);
        this._ws.send(JSON.stringify({
          type: "launch", cliId: this.cliId, cols: 120, rows: 40, tabId,
          env: extraEnv || undefined,
        }));
      });

      this._ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === "launched" && msg.tabId === tabId) {
          this.state = "running";
          this._scheduleTTL();
          if (this._resolveReady) {
            this._resolveReady();
            this._resolveReady = null;
          }
          resolve();
        }

        if (msg.type === "output" && msg.tabId === tabId) {
          this.buffer.append(msg.data);
          this.lastActivity = Date.now();
          this._resetDrain();
          // If someone is polling for output, resolve their promise
          if (this._pendingResolve) {
            const r = this._pendingResolve;
            this._pendingResolve = null;
            r(this.buffer.tail(50));
          }
        }

        if (msg.type === "exit" && msg.tabId === tabId) {
          this.state = "killed";
          this.exitCode = msg.exitCode !== undefined ? msg.exitCode : 0;
          this._cleanup();
        }
      });

      this._ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        this.state = "killed";
        this._cleanup();
        if (this._resolveReady) {
          this._resolveReady();
          this._resolveReady = null;
        }
        reject(err);
      });

      this._ws.on("close", () => {
        clearTimeout(connectTimeout);
        if (this.state === "running") this.state = "killed";
        this._cleanup();
      });
    });
  }

  /**
   * Write input to the session (execute a command).
   */
  write(input) {
    if (!this.alive) throw new Error("Session is not alive");
    this.lastActivity = Date.now();
    this._ws.send(JSON.stringify({ type: "input", data: `${input  }\n`, tabId: `mcp-${this.id}` }));
  }

  /**
   * Read output from the session buffer.
   * @param {object} opts
   * @param {'full'|'tail'|'poll'|'delta'} [opts.mode='full']
   * @param {number} [opts.tailLines=50]
   * @param {number} [opts.pollTimeout=5000]
   * @param {number} [opts.cursor] - For delta mode: last known cursor position
   * @param {boolean} [opts.stripAnsi] - For delta mode: strip ANSI escape sequences
   * @param {number} [opts.maxChars] - For delta mode: max chars to return (default 50000)
   * @returns {Promise<string|object>} Returns string for full/tail/poll, object for delta
   */
  async read(opts = {}) {
    const mode = opts.mode || "full";
    if (mode === "full") return this.buffer.full();
    if (mode === "tail") return this.buffer.tail(opts.tailLines || 50);
    if (mode === "poll") {
      // Wait for new output or timeout
      return new Promise((resolve) => {
        const timeout = opts.pollTimeout || 5000;
        const timer = setTimeout(() => {
          this._pendingResolve = null;
          resolve(this.buffer.tail(opts.tailLines || 50));
        }, timeout);
        this._pendingResolve = (data) => {
          clearTimeout(timer);
          resolve(data);
        };
      });
    }
    if (mode === "delta") {
      const cursor = opts.cursor;
      const strip = opts.stripAnsi === true;
      const maxChars = opts.maxChars || 50000;
      let output = "";
      let reset = false;

      // Case 1: no cursor provided → return last 50 lines + current cursor
      if (cursor === undefined || cursor === null) {
        output = this.buffer.tail(50);
        reset = true;
      } else {
        // Case 3: cursor points to evicted position → fall back to tail
        const sliced = this.buffer.slice(cursor);
        if (sliced === null) {
          output = this.buffer.tail(50);
          reset = true;
        } else {
          output = sliced;
        }
      }

      // Strip ANSI if requested
      if (strip && output) output = stripAnsi(output);

      // Truncate if needed
      let truncated = false;
      if (output.length > maxChars) {
        output = output.slice(-maxChars);
        truncated = true;
        reset = true;
      }

      return {
        output,
        cursor: this.buffer.length,
        noNewData: !reset && output.length === 0,
        truncated,
        reset,
        exitCode: this.state === "killed" ? this.exitCode : undefined,
      };
    }
    return this.buffer.full();
  }

  /**
   * Kill this session.
   */
  kill() {
    if (!this.alive) return;
    this.state = "killed";
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(JSON.stringify({ type: "kill", tabId: `mcp-${this.id}` }));
    }
    this._cleanup();
  }

  /**
   * Send a POSIX signal to the PTY process.
   * @param {'SIGINT'|'SIGTERM'|'SIGKILL'|'SIGHUP'} sig
   */
  signal(sig) {
    if (!this.alive) throw new Error("Session is not alive");

    const signalMap = {
      "SIGINT": 2,
      "SIGTERM": 15,
      "SIGKILL": 9,
      "SIGHUP": 1,
    };

    const sigNum = signalMap[sig];
    if (!sigNum) throw new Error(`Unsupported signal: ${sig}`);

    this._ws.send(JSON.stringify({
      type: "signal",
      signal: sigNum,
      tabId: `mcp-${this.id}`,
    }));
  }

  /**
   * Resize the PTY dimensions.
   * @param {number} [cols=120] - Columns (80-400)
   * @param {number} [rows=40] - Rows (10-200)
   */
  resize(cols = 120, rows = 40) {
    if (!this.alive) throw new Error("Session is not alive");

    cols = Math.min(400, Math.max(80, cols));
    rows = Math.min(200, Math.max(10, rows));

    this._ws.send(JSON.stringify({
      type: "resize",
      cols,
      rows,
      tabId: `mcp-${this.id}`,
    }));
  }

  toJSON() {
    return {
      id: this.id,
      cliId: this.cliId,
      state: this.state,
      age: this.age,
      idle: this.idle,
      exitCode: this.exitCode,
    };
  }

  // ── Private helpers ──

  _resetDrain() {
    if (this._drainTimer) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
  }

  _scheduleTTL() {
    if (this._ttlTimer) clearTimeout(this._ttlTimer);
    this._ttlTimer = setTimeout(() => {
      if (this.state === "running") {
        this.state = "timedout";
        this._cleanup();
      }
    }, config.sessionTtlMs);
  }

  _cleanup() {
    this._resetDrain();
    if (this._ttlTimer) { clearTimeout(this._ttlTimer); this._ttlTimer = null; }
    try { if (this._ws) this._ws.close(); } catch {}
    this._ws = null;
  }
}

// ── Session Manager ──

class SessionManager {
  constructor() {
    /** @type {Map<string, Session>} */
    this._sessions = new Map();
    this._cleanupInterval = null;
  }

  /**
   * Create a new persistent session.
   * @param {string} cliId - CLI identifier (e.g. 'bash', 'node')
   * @param {object} [opts]
   * @param {object} [opts.env] - Extra environment variables
   * @returns {Promise<Session>}
   */
  async create(cliId, opts = {}) {
    if (this._sessions.size >= config.maxSessions) {
      // Evict oldest stale session
      this._evictStale();
      if (this._sessions.size >= config.maxSessions) {
        throw new Error(`Max sessions (${config.maxSessions}) reached. Kill a session first.`);
      }
    }

    const session = new Session(cliId, config.wsUrl);
    this._sessions.set(session.id, session);

    try {
      await session.connect(opts.env);
    } catch (err) {
      this._sessions.delete(session.id);
      throw err;
    }

    // Reset TTL each activity cycle (done via lastActivity updates in read/write)

    this._ensureCleanupLoop();
    return session;
  }

  /**
   * Get a session by ID.
   */
  get(id) {
    const s = this._sessions.get(id);
    if (!s) return null;
    if (!s.alive) {
      this._sessions.delete(id);
      return null;
    }
    return s;
  }

  /**
   * Kill and remove a session.
   */
  kill(id) {
    const s = this._sessions.get(id);
    if (!s) return false;
    s.kill();
    this._sessions.delete(id);
    return true;
  }

  /**
   * List all active sessions.
   */
  list() {
    const result = [];
    for (const [, s] of this._sessions) {
      if (!s.alive) {
        this._sessions.delete(s.id);
        continue;
      }
      result.push(s.toJSON());
    }
    return result;
  }

  /**
   * Get total active session count.
   */
  get count() {
    return this._sessions.size;
  }

  /**
   * Destroy all sessions (for shutdown).
   */
  destroy() {
    for (const [, s] of this._sessions) {
      s.kill();
    }
    this._sessions.clear();
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  // ── Internal ──

  _ensureCleanupLoop() {
    if (this._cleanupInterval) return;
    this._cleanupInterval = setInterval(() => {
      for (const [id, s] of this._sessions) {
        if (!s.alive) {
          this._sessions.delete(id);
        }
      }
    }, 60000);
  }

  _evictStale() {
    let oldest = null;
    let oldestKey = null;
    for (const [id, s] of this._sessions) {
      if (!s.alive) {
        this._sessions.delete(id);
        continue;
      }
      if (!oldest || s.createdAt < oldest.createdAt) {
        oldest = s;
        oldestKey = id;
      }
    }
    if (oldestKey) {
      oldest.kill();
      this._sessions.delete(oldestKey);
    }
  }
}

// Singleton
const sessionManager = new SessionManager();

module.exports = { SessionManager, Session, sessionManager };
