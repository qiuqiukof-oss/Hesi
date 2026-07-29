/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Agent Session Manager — headless AI agent PTY sessions
//
// Extracted from ws-handler.js. Manages agent session state
// (agentSessions map, counters). Each session is an isolated
// PTY with captured output log.
// ============================================================

const { RingBuffer } = require('../ring-buffer');

/**
 * Create an agent session manager instance.
 *
 * @param {object} deps
 * @param {Function} deps.createHeadlessPTY  — from ws/pty.js
 * @param {Function} deps.resolveCommand     — from cli-discovery (for pre-flight checks)
 * @param {object}   [deps.contextStore]      — optional ContextStore for cross-agent memory
 * @returns {{
 *   createAgentPTY:        (cmd: string, args: string[], ws: object, sessionId: string, agentId: string) => object|null,
 *   killAgentSession:      (ws: object, sessionId: string) => void,
 *   killAllAgentSessions:  (ws: object) => void,
 *   listAgentSessions:     (ws: object) => Array<{sessionId, agentId, name}>,
 *   agentSessions:         Map
 * }}
 */
function createAgentSessionManager({ createHeadlessPTY, resolveCommand, contextStore }) {
  /** Map<WebSocket, Map<sessionId, { pty, agentId, name, log }>> */
  const agentSessions = new Map();
  /** Counter for generating unique session IDs */
  let agentSessionCounter = 0;

  const MAX_LOG_CHARS = parseInt(process.env.AGENT_LOG_MAX_CHARS, 10) || 50000;

  /** Grace window for a client to reconnect and re-attach an orphaned headless
   *  agent PTY before it is reaped. Mirrors the terminal-tab grace in ws-handler.
   *  A transient WebSocket drop must NOT make a running agent (e.g. opencode)
   *  vanish — only an explicit agent:kill (×/CTRL+C) should. */
  const AGENT_RECONNECT_GRACE_MS = parseInt(process.env.AGENT_RECONNECT_GRACE_MS, 10) || 60_000;
  /** Map<sessionId, { pty, agentId, name, log, ws, timer, _orphaned }>
   *  Agent sessions whose client disconnected but whose PTY is still alive. */
  const orphanedAgents = new Map();

  // ── Liveness watchdog ──────────────────────────────────────────────
  // Two jobs:
  //   1. Zombie reaper (always on): node-pty normally reports exit via onExit,
  //      but in a rare race (e.g. ws mid-orphan) a PTY can die without firing
  //      onExit, leaving a "dead but active" session the client waits on
  //      forever. We periodically verify each session's process is still alive
  //      and reap any whose process is gone but exit was never reported.
  //   2. Idle/hang killer (opt-in via AGENT_IDLE_WATCHDOG_MS, default OFF):
  //      kills a *connected* session that has produced no output for the
  //      threshold — a strong signal the agent hung. Disabled by default
  //      because a live agent can legitimately idle while awaiting human input;
  //      set the env var (ms) to enable, e.g. 1800000 for 30 min.
  const WATCHDOG_INTERVAL_MS = parseInt(process.env.AGENT_WATCHDOG_INTERVAL_MS, 10) || 60_000;
  const IDLE_WATCHDOG_MS = parseInt(process.env.AGENT_IDLE_WATCHDOG_MS, 10) || 0;
  let watchdogTimer = null;

  function reapZombie(sessionId, session) {
    if (session.pty && session.pty.exitCode == null && !session.pty.process) {
      console.warn('[AgentSrv] Watchdog reaped zombie session:', sessionId, '| agent:', session.agentId);
      if (session.ws && session.ws.readyState === 1) {
        session.ws.send(JSON.stringify({ type: 'agent:exit', sessionId, code: -1, signal: null, zombie: true }));
      }
      if (session.timer) clearTimeout(session.timer);
      try { session.pty.kill(); } catch (e) { /* already dead */ }
      return true;
    }
    return false;
  }

  function watchdogTick() {
    for (const [, sessions] of agentSessions) {
      for (const [sessionId, session] of sessions) {
        if (reapZombie(sessionId, session)) { sessions.delete(sessionId); continue; }
        if (IDLE_WATCHDOG_MS > 0 && session.pty && !session._orphaned &&
            session.ws && session.ws.readyState === 1 &&
            Date.now() - (session.lastOutputAt || session._startTime || 0) > IDLE_WATCHDOG_MS) {
          console.warn('[AgentSrv] Watchdog killed idle/hung session:', sessionId, '| agent:', session.agentId);
          if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({
              type: 'agent:error', sessionId, agentId: session.agentId,
              errorCode: 'watchdog_timeout',
              message: `Agent "${session.agentId}" produced no output for ${Math.round(IDLE_WATCHDOG_MS / 60000)} min — killed as suspected hang`,
            }));
          }
          try { session.pty.kill(); } catch (e) { /* already dead */ }
          sessions.delete(sessionId);
        }
      }
    }
    for (const [sessionId, session] of orphanedAgents) {
      if (reapZombie(sessionId, session)) orphanedAgents.delete(sessionId);
    }
  }

  function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
    if (watchdogTimer && typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
  }

  function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }

  /**
   * Create a headless PTY for an agent session (no terminal output to client,
   * output is captured to a log buffer).
   *
   * @param {string} cmd - Command to run
   * @param {string[]} args - Command arguments
   * @param {object} ws - WebSocket connection (for sending output events)
   * @param {string} sessionId - Unique session ID
   * @param {string} agentId - Agent identifier
   * @returns {{ pty: object, log: RingBuffer }|null}
   */
  function createAgentPTY(cmd, args, ws, sessionId, agentId) {
    console.log('[AgentSrv] createAgentPTY:', agentId, '| cmd:', cmd, '| args:', args);
    const log = new RingBuffer(MAX_LOG_CHARS);
    /** Mutable session record — referenced by onData/onExit so orphaning
     *  (which nulls .ws) is observed by the live callbacks. The same object is
     *  stored in agentSessions, so re-attaching just rewrites .ws. */
    const session = { pty: null, agentId, name: agentId, log, ws, sessionId, _orphaned: false, timer: null, lastOutputAt: Date.now(), _startTime: Date.now() };

    let p;
    p = createHeadlessPTY(cmd, args || [], {
      onData: (cleaned) => {
        log.append(cleaned);
        session.lastOutputAt = Date.now();
        if (session.ws && session.ws.readyState === 1) {
          session.ws.send(JSON.stringify({ type: 'agent:output', sessionId, data: cleaned }));
        }
      },
      onExit: ({ exitCode, signal }) => {
        const duration = Date.now() - (p ? p._startTime || Date.now() : Date.now());
        console.log('[AgentSrv] PTY exited:', agentId, '| session:', sessionId, '| code:', exitCode, '| signal:', signal, '| duration:', `${Math.round(duration / 1000)  }s`);
        const orphan = orphanedAgents.get(sessionId);
        if (orphan) {
          // PTY exited while the client was disconnected — keep the entry so a
          // later reconnect can notify the client via agent:exit; the grace
          // timer reaps the (already dead) PTY if no reconnect happens.
        } else {
          const sessions = agentSessions.get(session.ws);
          if (sessions) sessions.delete(sessionId);
        }
        if (session.ws && session.ws.readyState === 1) {
          session.ws.send(JSON.stringify({ type: 'agent:exit', sessionId, code: exitCode, signal }));
        }
        // Publish agent output to shared context store
        if (contextStore) {
          const fullOutput = log.join();
          contextStore.publish(agentId, {
            sessionId,
            exitCode,
            signal,
            output: fullOutput.slice(0, 3000),
            duration: Math.round(duration / 1000),
          }, {
            tags: ['agent', `agent:${agentId}`],
            type: 'agent:output',
            ttl: 300000, // 5 min for agent results
          });
        }
      },
      onError: (err) => {
        console.log('[AgentSrv] PTY spawn error:', agentId, '| session:', sessionId, '| error:', err.message);
        if (session.ws && session.ws.readyState === 1) {
          session.ws.send(JSON.stringify({
            type: 'agent:error',
            sessionId,
            agentId,
            errorCode: 'spawn_error',
            message: err.message,
          }));
        }
      },
    });

    if (!p) {
      console.log('[AgentSrv] createHeadlessPTY returned null for', agentId);
      return null;
    }
    p._startTime = Date.now();
    console.log('[AgentSrv] PTY spawned successfully:', agentId, '| pid:', p.pid);
    session.pty = p;
    startWatchdog(); // lazily spin up the liveness watchdog on first PTY
    return session;
  }

  /**
   * Initialize agent session tracking for a new WebSocket connection.
   */
  function initSessionMap(ws) {
    if (!agentSessions.has(ws)) {
      agentSessions.set(ws, new Map());
    }
  }

  /**
   * Kill a specific agent session.
   */
  function killAgentSession(ws, sessionId) {
    const sessions = agentSessions.get(ws);
    if (!sessions) {
      console.log('[AgentSrv] killAgentSession: no sessions for client');
      return;
    }
    const session = sessions.get(sessionId);
    if (session) {
      console.log('[AgentSrv] Killing agent session:', sessionId, '| agentId:', session.agentId);
      try { session.pty.kill(); } catch (e) { /* PTY already dead — expected when agent exits before kill; best-effort cleanup */ }
      sessions.delete(sessionId);
    } else {
      console.log('[AgentSrv] killAgentSession: session not found:', sessionId);
    }
  }

  /**
   * Kill all agent sessions for a client.
   */
  function killAllAgentSessions(ws) {
    const sessions = agentSessions.get(ws);
    if (!sessions) return;
    for (const [, session] of sessions) {
      try { session.pty.kill(); } catch (e) { /* PTY already dead — expected when agent exits before kill; best-effort cleanup */ }
    }
    agentSessions.delete(ws);
  }

  /**
   * On client disconnect, keep headless agent PTYs alive for a grace window
   * instead of killing them. A transient WebSocket drop must NOT make a running
   * agent (e.g. opencode) vanish — only an explicit agent:kill (×/CTRL+C) should.
   */
  function orphanAllAgentSessions(ws) {
    const sessions = agentSessions.get(ws);
    if (!sessions) return;
    for (const [sessionId, session] of sessions) {
      if (!session || !session.pty) continue;
      session.ws = null;
      session._orphaned = true;
      // Snapshot current log length so a later reconnect replays ONLY the
      // output produced during the disconnect gap (not the whole history).
      session._gapBase = session.log.join('');
      session.timer = setTimeout(() => {
        try { session.pty.kill(); } catch (e) { /* already dead */ }
        orphanedAgents.delete(sessionId);
      }, AGENT_RECONNECT_GRACE_MS);
      orphanedAgents.set(sessionId, session);
    }
    agentSessions.delete(ws);
  }

  /**
   * Re-attach a client to an orphaned agent PTY by sessionId (called on
   * reconnect). Returns the session if re-attached, or null if there is no live
   * orphan to re-attach (expired/killed → caller should start a fresh one).
   */
  function reattachAgent(ws, sessionId) {
    const orphan = orphanedAgents.get(sessionId);
    if (!orphan || !orphan.pty) {
      // No orphan to re-attach (never existed or already reaped) — let caller
      // start a fresh session with a brand-new sessionId.
      return null;
    }
    if (orphan.pty.exitCode != null) {
      // Orphaned PTY already exited while the client was away — notify the
      // client so it can drop the stale entry, then let it start fresh.
      if (orphan.timer) clearTimeout(orphan.timer);
      orphanedAgents.delete(sessionId);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'agent:exit', sessionId, code: orphan.pty.exitCode, signal: null }));
      }
      return null;
    }
    if (orphan.timer) clearTimeout(orphan.timer);
    orphan.timer = null;
    orphan.ws = ws;
    orphan._orphaned = false;
    const sessions = agentSessions.get(ws) || new Map();
    sessions.set(sessionId, orphan);
    agentSessions.set(ws, sessions);
    orphanedAgents.delete(sessionId);
    // Replay ONLY the output produced while the client was disconnected (gap),
    // not the whole session history — mirrors the terminal-tab behavior and
    // avoids duplicating what the client already received live. Falls back to a
    // tail if the ring buffer wrapped past the snapshot.
    const full = orphan.log.join('');
    let gap = full;
    if (orphan._gapBase != null && full.startsWith(orphan._gapBase)) {
      gap = full.slice(orphan._gapBase.length);
    } else if (full.length > 4000) {
      gap = full.slice(-4000);
    }
    if (gap) {
      ws.send(JSON.stringify({ type: 'agent:output', sessionId, data: gap, replay: true }));
    }
    return orphan;
  }

  /**
   * Tear down everything (active + orphaned) — used on server shutdown.
   */
  function close() {
    stopWatchdog();
    for (const [, session] of agentSessions) {
      if (session && session.pty) { try { session.pty.kill(); } catch (e) {} }
    }
    for (const [, session] of orphanedAgents) {
      if (session.timer) clearTimeout(session.timer);
      if (session.pty) { try { session.pty.kill(); } catch (e) {} }
    }
    agentSessions.clear();
    orphanedAgents.clear();
  }

  /**
   * List all active agent sessions for a client.
   */
  function listAgentSessions(ws) {
    const sessions = agentSessions.get(ws);
    const list = [];
    if (sessions) {
      for (const [sid, session] of sessions) {
        list.push({ sessionId: sid, agentId: session.agentId, name: session.name });
      }
    }
    return list;
  }

  /**
   * Generate a new unique agent session ID.
   */
  function nextSessionId() {
    agentSessionCounter++;
    return `agent-${  agentSessionCounter}`;
  }

  return {
    createAgentPTY,
    killAgentSession,
    killAllAgentSessions,
    orphanAllAgentSessions,
    reattachAgent,
    listAgentSessions,
    initSessionMap,
    nextSessionId,
    agentSessions,
    orphanedAgents,
    close,
    startWatchdog,
    stopWatchdog,
  };
}

module.exports = { createAgentSessionManager };
