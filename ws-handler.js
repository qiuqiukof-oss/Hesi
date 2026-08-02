/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// WebSocket + PTY Manager — per-client isolated terminal sessions
//
// Orchestrates terminal tabs, agent sessions, and workflow execution.
// Heavy lifting delegated to ws/ modules; message dispatch lives in
// ws/message-dispatch.js so this file stays focused on connection lifecycle.
// ============================================================
const { WebSocketServer, WebSocket } = require('ws');

// ── WebSocket message rate limiter ──
// Per-IP fixed window: 500 messages / 30s window (loopback IPs are exempt).
// A fixed window (not a sliding window that refreshes on every hit) guarantees
// that a steady low-rate abuser is still throttled once the window fills.
const wsMessageCount = new Map();
function isLocalIP(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost' || ip === 'unknown';
}
function checkWSRateLimit(ip) {
  if (isLocalIP(ip)) return true;
  const now = Date.now();
  const WINDOW_MS = 30000;
  const MAX_MSGS = 500;
  const entry = wsMessageCount.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    wsMessageCount.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > MAX_MSGS) {
    return false;
  }
  return true;
}

// Periodic cleanup to prevent memory leak from stale IP entries
setInterval(() => {
  const now = Date.now();
  const WINDOW_MS = 30000;
  for (const [ip, entry] of wsMessageCount) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      wsMessageCount.delete(ip);
    }
  }
}, 60000).unref();

// node-pty is a native addon that may be missing in some environments.
// Guard the require so the WS server still starts; terminal/agent features
// degrade gracefully (createPTY returns a clear error instead of crashing).
let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.warn('[PTY] node-pty native addon not built — terminal/agent features disabled. Run `npm rebuild node-pty` and restart.');
}

const { loadRegistry, resolveCommand, resolveCliExecutable, isWin } = require('./cli-discovery');
const { createHeadlessPTY } = require('./ws/pty');
const { getAgentCommand, lookupCommand } = require('./ws/agent-utils');
const { createAgentSessionManager } = require('./ws/agent');
const { createOrchestrator } = require('./ws/orchestrator');
const { createContextStore } = require('./ws/context-store');
const { createPTYPolicy } = require('./ws/pty-policy');
const { createDigitalEmployee, createDigitalEmployeeTeam, ROLES } = require('./ws/digital-employee');
const { agentPool } = require('./routes/ai-tools/agent-pool');
const { filterSensitiveEnv } = require('./lib/env-filter');
const { getWorkspace } = require('./lib/workspace');
const { wsAllowed } = require('./lib/access-auth');
const { dispatchWSMessage } = require('./ws/message-dispatch');

/**
 * Set up the WebSocket server with PTY management.
 *
 * @param {http.Server} server  — the HTTP server to attach to
 * @param {object}      [opts]
 * @param {number}      [opts.port=3001]  — used for CLI_BRIDGE_URL env var
 * @returns {{ wss: WebSocketServer, activePTYs: Map, close: Function }}
 */
/**
 * Create the shared WebSocket/PTY manager. State only — not bound to any HTTP
 * server yet. Call `manager.attach(httpServer)` to wire it to one or more HTTP
 * servers (e.g. a dual loopback bind on 127.0.0.1 + ::1). Sharing one manager
 * across servers keeps terminal/agent/workflow state unified.
 *
 * @param {object} [opts]
 * @param {number} [opts.port=3001]  — used for CLI_BRIDGE_URL env var
 * @returns {WSManager}
 */
function createWSManager({ port = 3001 } = {}) {
  // One or more WebSocketServer instances (one per bound HTTP server).
  /** @type {Array<import('ws').WebSocketServer>} */
  const wssList = [];

  // ── Terminal tab state (managed locally, tightly coupled to WS) ──
  /** Map<WebSocket, Map<tabId, { pty, cliId, name, outputBuffer, ws, timer, _orphaned }>> */
  const activePTYs = new Map();

  // ── Orphaned terminal tabs: client disconnected but PTY kept alive so the
  //    terminal can be re-attached on reconnect. Prevents a running interactive
  //    CLI (e.g. opencodecli) from vanishing on a transient WebSocket drop. ──
  /** Map<tabId, { pty, cliId, name, outputBuffer, ws, timer, _orphaned }> */
  const orphanedTabs = new Map();
  const TAB_RECONNECT_GRACE_MS = 60_000;

  const counters = { tabId: 0 };

  // ── Shared Context Store (cross-agent memory) ──
  const contextStore = createContextStore();

  // ── PTY Policy (MCP policy engine bridge to WS layer) ──
  const ptyPolicy = createPTYPolicy();

  // ── Delegated sub-systems ──
  const agentManager = createAgentSessionManager({ createHeadlessPTY, resolveCommand, contextStore });
  const workflowEngine = createOrchestrator({ createHeadlessPTY, getAgentCommand, lookupCommand, contextStore });

  // ── Digital Employee Team ──
  // Wire the shared agentPool + broadcast so dispatched tasks actually execute
  // (roundtable real execution) and stream cleaned output to every client.
  // `broadcast` is a hoisted function declaration below, so referencing it here
  // (before its textual definition) is safe — we only capture the reference.
  const digitalEmployeeTeam = createDigitalEmployeeTeam({
    contextStore, agentManager, agentPool, broadcast,
  });

  /**
   * Kill a specific tab's PTY for a client.
   */
  function killTab(ws, tabId) {
    const tabs = activePTYs.get(ws);
    if (!tabs) return;
    const tab = tabs.get(tabId);
    if (tab) {
      try { tab.pty.kill(); } catch (e) { /* PTY already dead — expected during cleanup; race between close events is harmless */ }
      tabs.delete(tabId);
      if (tabs.size === 0) activePTYs.delete(ws);
    }
  }

  /**
   * Kill all tabs for a client.
   */
  function killAllTabs(ws) {
    const tabs = activePTYs.get(ws);
    if (!tabs) return;
    for (const [, tab] of tabs) {
      try { tab.pty.kill(); } catch (e) { /* PTY already dead — non-critical best-effort cleanup; process may have exited already */ }
    }
    activePTYs.delete(ws);
  }

  /**
   * Move a terminal tab into the orphaned state: keep its PTY alive but detach
   * it from the (now-closed) WebSocket, and schedule a grace-period reaping.
   * If the client reconnects and re-launches the same tabId within the grace
   * window, the tab is re-attached to the live PTY instead of being killed.
   */
  function orphanTab(ws, tabId, tab) {
    tab.ws = null;
    tab._orphaned = true;
    tab.outputBuffer = ''; // restart gap buffer; only post-disconnect output is replayed
    tab.timer = setTimeout(() => {
      // Grace expired without a reconnect — reap the PTY
      try { tab.pty.kill(); } catch (e) { /* already dead — reaping is best-effort */ }
      orphanedTabs.delete(tabId);
    }, TAB_RECONNECT_GRACE_MS);
    orphanedTabs.set(tabId, tab);
  }

  /**
   * Create a PTY for the given registry entry and client.
   * Checks command policy before spawning.
   */
  function createPTY(cliEntry, ws, cols, rows, tabId, tab) {
    // ── Policy check ──
    const policyCheck = ptyPolicy.checkCLIEntry(cliEntry);
    if (!policyCheck.allowed) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: `Policy denied: ${policyCheck.reason}`,
        }));
      }
      return null;
    }

    // ── Audit: record the command execution on the unified audit bus (A2) ──
    // Never let audit break the terminal — wrap in try/catch.
    try {
      const audit = require('./lib/audit');
      const cwd = typeof cliEntry.cwd === 'string'
        ? cliEntry.cwd
        : (process.env.HOME || process.env.USERPROFILE || '');
      audit.ptyCommand({
        user: (ws && ws._user) || 'anonymous',
        session: tabId || (ws && ws._sessionId) || 'unknown',
        cwd,
        cmd: [cliEntry.name, ...(cliEntry.args || [])].join(' '),
        policyResult: 'allowed',
      });
    } catch (e) { /* audit must never break the terminal */ }

    if (!pty) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Terminal unavailable: node-pty native addon is not built. Run `npm rebuild node-pty` and restart the server.',
        }));
      }
      return null;
    }

    // Resolve to an absolute, runnable executable. Self-heals against stale
    // cached paths (e.g. registry copied from another machine) by falling
    // back to PATH resolution of the command name.
    const cmd = resolveCliExecutable(cliEntry);
    if (!cmd) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: `Cannot resolve command "${cliEntry.name}" — not found in PATH`,
        }));
      }
      return null;
    }
    const args = cliEntry.args || [];

    // Filter process.env to avoid leaking secrets
    const safeEnv = filterSensitiveEnv(process.env);

    const shellOpts = {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: getWorkspace(),
      env: {
        ...safeEnv,
        TERM: 'xterm-256color',
        TERMINAL_PROGRAM: 'Universal-CLI-Bridge',
        CLI_BRIDGE_URL: `http://localhost:${port}`,
      },
    };

    if (isWin) {
      shellOpts.useConpty = true;
    }

    let p;
    try {
      p = pty.spawn(cmd, args, shellOpts);
    } catch (err) {
      if (isWin && shellOpts.useConpty !== false) {
        shellOpts.useConpty = false;
        try {
          p = pty.spawn(cmd, args, shellOpts);
        } catch (err2) {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Failed to spawn "${cmd}": ${err2.message}`,
            }));
          }
          return null;
        }
      } else {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Failed to spawn "${cmd}": ${err.message}`,
          }));
        }
        return null;
      }
    }

    const ptyStartTime = Date.now();

    p.onData((data) => {
      // Buffer only while orphaned (client dropped but PTY still alive) so the
      // post-disconnect output can be replayed on reconnect — avoids both
      // duplicating live output and unbounded memory growth.
      if (tab._orphaned) tab.outputBuffer += data;
      if (tab.ws && tab.ws.readyState === 1) {
        tab.ws.send(JSON.stringify({ type: 'output', data, tabId }));
      }
    });

    p.onExit(({ exitCode, signal }) => {
      p.exitCode = exitCode;
      // Detach from whichever map holds this tab (active or orphaned)
      const tabs = activePTYs.get(tab.ws);
      if (tabs && tabs.get(tabId)) {
        tabs.delete(tabId);
        if (tabs.size === 0) activePTYs.delete(tab.ws);
      }
      const orphan = orphanedTabs.get(tabId);
      if (orphan) {
        if (orphan.timer) clearTimeout(orphan.timer);
        orphanedTabs.delete(tabId);
      }

      const duration = Date.now() - ptyStartTime;
      const commandDuration = Math.round(duration / 1000);

      if (tab.ws && tab.ws.readyState === 1) {
        tab.ws.send(JSON.stringify({
          type: 'exit',
          code: exitCode,
          signal,
          tabId,
          duration: commandDuration,
          cli: tab.cliId,
        }));

        const isLongRunning = commandDuration >= 5;
        const isErrorExit = exitCode !== 0 && exitCode !== null;
        if (isLongRunning || isErrorExit) {
          tab.ws.send(JSON.stringify({
            type: 'command:complete',
            tabId,
            exitCode,
            duration: commandDuration,
            cliName: tab.name,
            isLongRunning,
            isError: isErrorExit,
          }));
        }
      }
    });

    return p;
  }

  /**
   * Broadcast a message to all connected WebSocket clients.
   * @param {object|string} data — JSON-serializable object or string to send
   */
  function broadcast(data) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const wss of wssList) {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }

  // ── Assemble shared state for message dispatch ──
  const dispatchCtx = {
    activePTYs,
    orphanedTabs,
    counters,
    ptyPolicy,
    agentManager,
    workflowEngine,
    digitalEmployeeTeam,
    contextStore,
    broadcast,
    killTab,
    killAllTabs,
    createPTY,
  };

  // ──────────────────────────────────────────────
  // Connection handler
  // ──────────────────────────────────────────────
  function handleConnection(ws, req) {
    // ── Access token guard (no-op when QCLI_ACCESS_TOKEN is unset) ──
    if (!wsAllowed(req)) {
      try { ws.close(4401, 'Unauthorized'); } catch { /* ignore */ }
      return;
    }

    console.log('[WS] Client connected');
    agentManager.initSessionMap(ws);
    activePTYs.set(ws, new Map());

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;

      // ── Rate limit: per-connection IP check ──
      const clientIp = ws._socket?.remoteAddress || 'unknown';
      if (!checkWSRateLimit(clientIp)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded (max 500 msg/30s), please slow down' }));
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // 直接在此处处理 pong 以重置本连接的心跳计数器（避免跨作用域传递回调）
      if (msg?.type === 'pong') {
        onServerPong?.();
        return;
      }

      try {
        dispatchWSMessage(dispatchCtx, ws, msg);
      } catch (err) {
        // A single malformed/buggy message must NOT bubble up to
        // process.on('uncaughtException') and crash the whole server
        // (which would drop EVERY terminal at once). Log and notify instead.
        console.error('[WS] Error handling message type', msg.type, '—', err?.message);
        try {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: `Internal error handling message: ${  err?.message || 'unknown'}` }));
          }
        } catch { /* ws already gone — ignore */ }
      }
    });

    // ── Server-side heartbeat ──
    // 发送 ping 后启动一个 8s 定时器等待客户端 pong 响应
    // 若定时器到期未收到 pong 则计为一次丢失，连续 3 次丢失判定客户端异常
    let serverHbInterval = null;
    let serverPongTimer = null;
    let consecutiveMissedPongs = 0;
    let lastServerPingTime = 0;
    
    const onServerPong = () => {
      if (serverPongTimer) {
        clearTimeout(serverPongTimer);
        serverPongTimer = null;
      }
      consecutiveMissedPongs = 0;
    };
    
    const startServerHeartbeat = () => {
      if (serverHbInterval) clearInterval(serverHbInterval);
      consecutiveMissedPongs = 0;
      
      serverHbInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          lastServerPingTime = Date.now();
          ws.send(JSON.stringify({ type: 'ping', server: true, t: lastServerPingTime }));
          
          // 15s 内未收到 pong 响应则计数（放宽：8s→15s——服务端执行同步任务时
          // 事件循环可能短暂冻结，8s 太紧会误断活跃连接）
          if (serverPongTimer) clearTimeout(serverPongTimer);
          serverPongTimer = setTimeout(() => {
            consecutiveMissedPongs++;
            console.warn('[WS] Pong not received from client (missed:', `${consecutiveMissedPongs  })`);
            
            if (consecutiveMissedPongs >= 5) {
              console.warn('[WS] Client unresponsive for 5 heartbeats — forcing close');
              consecutiveMissedPongs = 0;
              try { ws.close(); } catch (e) { /* already closed */ }
            }
          }, 15000);
        }
      }, 15000);
    };
    
    const stopServerHeartbeat = () => {
      if (serverHbInterval) {
        clearInterval(serverHbInterval);
        serverHbInterval = null;
      }
      if (serverPongTimer) {
        clearTimeout(serverPongTimer);
        serverPongTimer = null;
      }
    };
    
    // ── 连接时长追踪 ──
    let connectionStartTime = Date.now();

    ws.on('close', () => {
      const duration = Math.round((Date.now() - connectionStartTime) / 1000);
      console.log('[WS] Client disconnected after', `${duration  }s`);
      
      stopServerHeartbeat();
      
      const agentCount = agentManager.agentSessions.get(ws)?.size || 0;
      if (agentCount > 0) {
        console.log('[AgentSrv] Cleaning up', agentCount, 'agent session(s) on disconnect');
      }
      // ── Terminal tabs: keep the PTY alive for a reconnect grace window
      //    instead of killing it. A transient WebSocket drop must NOT make a
      //    running interactive CLI (e.g. opencodecli) vanish. ──
      const tabs = activePTYs.get(ws);
      if (tabs) {
        for (const [tabId, tab] of tabs) {
          orphanTab(ws, tabId, tab);
        }
        activePTYs.delete(ws);
      }
      // Agent sessions: keep the headless PTY alive for a reconnect grace window
      // (re-attach on reconnect) instead of killing it — same principle as
      // terminal tabs. Only an explicit agent:kill (×/CTRL+C) should terminate.
      agentManager.orphanAllAgentSessions(ws);
      // Workflow runs are still torn down on disconnect (resuming a multi-step
      // DAG mid-flight is not yet supported); tracked as a separate follow-up.
      workflowEngine.cleanupWorkflows(ws);
      ptyPolicy.cleanup(ws);
    });

    // ── 启动服务端心跳 ──
    startServerHeartbeat();
    connectionStartTime = Date.now();

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  }

  /**
   * Gracefully shut down all PTY sessions and close the WebSocket server.
   */
  /**
   * Wire this manager to an HTTP server (idempotent — call once per server you
   * want to serve WebSocket traffic on). Safe to call multiple times for a
   * dual/multi bind.
   * @param {import('http').Server} httpServer
   * @returns {import('ws').WebSocketServer}
   */
  function attach(httpServer) {
    const wss = new WebSocketServer({ server: httpServer });
    wssList.push(wss);
    wss.on('connection', handleConnection);
    return wss;
  }

  function close() {
    for (const [, tabs] of activePTYs) {
      for (const [, tab] of tabs) {
        try { tab.pty.kill(); } catch (e) { /* PTY already dead — non-critical best-effort cleanup; process may have exited already */ }
      }
    }
    activePTYs.clear();
    // Reap orphaned (disconnected-but-alive) terminal tabs too on full shutdown
    for (const [, tab] of orphanedTabs) {
      if (tab.timer) clearTimeout(tab.timer);
      try { tab.pty.kill(); } catch (e) { /* already dead — best-effort */ }
    }
    orphanedTabs.clear();
    // Reap orphaned (disconnected-but-alive) agent PTYs too on full shutdown
    agentManager.close();
    for (const wss of wssList) {
      try { wss.close(); } catch (e) { /* WSS already closed — expected during double-shutdown sequence */ }
    }
  }

  return {
    activePTYs,
    close,
    broadcast,
    digitalEmployeeTeam,
    attach,
    wssList,
    get wss() { return wssList[0]; },
  };
}

/**
 * Convenience wrapper: create a manager and attach it to a single HTTP server.
 * Preserved for backward compatibility (tests, single-bind callers).
 * @param {import('http').Server} server
 * @param {object} [opts]
 * @returns {ReturnType<typeof createWSManager>}
 */
function setupWebSocket(server, opts) {
  const manager = createWSManager(opts);
  manager.attach(server);
  return manager;
}

module.exports = { createWSManager, setupWebSocket, NODE_PTY_AVAILABLE: !!pty };
