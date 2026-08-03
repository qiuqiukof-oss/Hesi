/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// WebSocket message dispatch — delegates each `msg.type` to a handler.
//
// Extracted from ws-handler.js to shrink that file's connection handler.
// The logic is byte-for-byte equivalent to the original `switch (msg.type)`
// block; the only change is that shared state (PTY map, managers, helpers)
// is passed in via `ctx` instead of closed over. ws-handler.js assembles
// `ctx` once and calls dispatchWSMessage(ctx, ws, msg).
// ============================================================
const path = require('path');
const { loadRegistry, resolveCommand } = require('../cli-discovery');
const { createDigitalEmployee } = require('./digital-employee');

/**
 * Dispatch a single parsed WebSocket message.
 *
 * @param {object} ctx — shared state assembled by ws-handler.setupWebSocket()
 * @param {object} ctx.activePTYs        — Map<WebSocket, Map<tabId, tab>>
 * @param {object} ctx.orphanedTabs      — Map<tabId, tab> PTYs kept alive after disconnect
 * @param {object} ctx.counters          — { tabId: number } mutable counter
 * @param {object} ctx.ptyPolicy         — PTY policy engine
 * @param {object} ctx.agentManager      — agent session manager
 * @param {object} ctx.workflowEngine    — workflow engine
 * @param {object} ctx.digitalEmployeeTeam — digital employee team
 * @param {object} ctx.contextStore      — cross-agent context store
 * @param {Function} ctx.broadcast       — (data) => wsManager.broadcast(data)
 * @param {Function} ctx.killTab         — (ws, tabId) => void
 * @param {Function} ctx.killAllTabs     — (ws) => void
 * @param {Function} ctx.createPTY       — (cliEntry, ws, cols, rows, tabId) => pty|null
 * @param {object} ws  — the WebSocket connection
 * @param {object} msg — parsed JSON message
 */
function dispatchWSMessage(ctx, ws, msg) {
  const {
    activePTYs, orphanedTabs, counters, ptyPolicy, agentManager, workflowEngine,
    digitalEmployeeTeam, contextStore, broadcast, killTab, killAllTabs, createPTY,
  } = ctx;

  switch (msg.type) {

    case 'launch': {
      // ── Check session mode ──
      const modeCheck = ptyPolicy.checkInputAllowed(ws);
      if (!modeCheck.allowed) {
        ws.send(JSON.stringify({ type: 'error', message: modeCheck.reason }));
        return;
      }

      const registry = loadRegistry();
      const entry = registry.clis.find(c => c.id === msg.cliId);
      if (!entry) {
        ws.send(JSON.stringify({
          type: 'error',
          message: `CLI "${msg.cliId}" not found in registry`,
        }));
        return;
      }

      const tabId = msg.tabId || (`tab-${  ++counters.tabId}`);

      const cols = typeof msg.cols === 'number'
        ? Math.max(10, Math.min(500, Math.floor(msg.cols)))
        : 80;
      const rows = typeof msg.rows === 'number'
        ? Math.max(2, Math.min(200, Math.floor(msg.rows)))
        : 24;

      // ── Re-attach if the client is reconnecting to a still-alive orphaned tab ──
      const orphan = orphanedTabs.get(tabId);
      if (orphan && orphan.pty && orphan.pty.exitCode == null) {
        if (orphan.timer) clearTimeout(orphan.timer);
        orphan.timer = null;
        orphan.ws = ws;
        orphan._orphaned = false;
        const tabs = activePTYs.get(ws) || new Map();
        tabs.set(tabId, orphan);
        activePTYs.set(ws, tabs);
        orphanedTabs.delete(tabId);
        // Replay output produced while the client was disconnected
        if (orphan.outputBuffer) {
          ws.send(JSON.stringify({ type: 'output', data: orphan.outputBuffer, tabId }));
        }
        ws.send(JSON.stringify({ type: 'launched', cli: entry, tabId, reattached: true }));
        console.log('[WS] Re-attached orphaned terminal tab', tabId, 'on reconnect');
        break;
      } else if (orphan) {
        // Orphaned but the PTY already exited — discard and create a fresh one
        if (orphan.timer) clearTimeout(orphan.timer);
        orphanedTabs.delete(tabId);
      }

      const tab = { pty: null, cliId: msg.cliId, name: entry.name, outputBuffer: '', ws, tabId, _orphaned: false };
      const pty = createPTY(entry, ws, cols, rows, tabId, tab);

      if (pty) {
        tab.pty = pty;
        const tabs = activePTYs.get(ws) || new Map();
        tabs.set(tabId, tab);
        activePTYs.set(ws, tabs);
        ws.send(JSON.stringify({ type: 'launched', cli: entry, tabId }));
      }
      break;
    }

    case 'input': {
      if (typeof msg.data !== 'string') return;

      // ── Policy: check session mode (readonly blocks all) ──
      const modeCheck = ptyPolicy.checkInputAllowed(ws);
      if (!modeCheck.allowed) {
        ws.send(JSON.stringify({ type: 'error', message: modeCheck.reason }));
        return;
      }

      const tabs = activePTYs.get(ws);
      if (!tabs) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active terminal session for this connection' }));
        return;
      }
      const tab = msg.tabId ? tabs.get(msg.tabId) : null;
      if (!tab) {
        ws.send(JSON.stringify({
          type: 'error',
          message: msg.tabId
            ? `Tab "${msg.tabId}" not found — it may have exited or was never launched`
            : 'No tabId specified and no default terminal session',
        }));
        return;
      }
      tab.pty.write(msg.data);
      break;
    }

    case 'resize': {
      if (typeof msg.cols !== 'number' || typeof msg.rows !== 'number') return;
      const cols = Math.max(10, Math.min(500, Math.floor(msg.cols)));
      const rows = Math.max(2, Math.min(200, Math.floor(msg.rows)));
      const tabs = activePTYs.get(ws);
      if (!tabs) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active terminal session for this connection' }));
        return;
      }
      const tab = msg.tabId ? tabs.get(msg.tabId) : null;
      if (!tab) {
        ws.send(JSON.stringify({
          type: 'error',
          message: msg.tabId
            ? `Tab "${msg.tabId}" not found — it may have exited or was never launched`
            : 'No tabId specified',
        }));
        return;
      }
      try {
        tab.pty.resize(cols, rows);
      } catch (e) {
        // PTY dead — resize on disposed terminal is harmless; session may have ended.
        // Log for observability rather than silently swallowing (no client error — non-fatal).
        console.debug('[WS] Resize on dead PTY (harmless):', msg.tabId);
      }
      break;
    }

    case 'signal': {
      if (typeof msg.signal !== 'number') return;
      const tabs = activePTYs.get(ws);
      if (!tabs) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active terminal session for this connection' }));
        return;
      }
      const tab = msg.tabId ? tabs.get(msg.tabId) : null;
      if (!tab) {
        ws.send(JSON.stringify({
          type: 'error',
          message: msg.tabId
            ? `Tab "${msg.tabId}" not found — it may have exited or was never launched`
            : 'No tabId specified',
        }));
        return;
      }
      if (tab.pty && tab.pty.process) {
        try {
          // node-pty kill() accepts POSIX signal numbers
          tab.pty.kill(msg.signal);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: `Signal ${msg.signal} failed: ${e.message}` }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: `Tab "${msg.tabId}" PTY is not running — nothing to signal` }));
      }
      break;
    }

    case 'kill': {
      if (msg.tabId) {
        killTab(ws, msg.tabId);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'killed', tabId: msg.tabId }));
        }
      } else {
        killAllTabs(ws);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'killed' }));
        }
      }
      break;
    }

    case 'agent:launch': {
      const { agentId, name, cmd, args, sessionId: clientSessionId } = msg;
      console.log('[AgentSrv] agent:launch received:', agentId, '| cmd:', cmd, '| args:', args, '| sessionId:', clientSessionId || '(new)');

      // ── Reconnect re-attach: if the client supplies a sessionId that matches
      //    an orphaned (disconnected-but-alive) agent PTY, re-attach to it
      //    instead of spawning a fresh one. Bypasses policy/cmd checks — the
      //    session already passed them when first launched. ──
      if (clientSessionId) {
        const reattached = agentManager.reattachAgent(ws, clientSessionId);
        if (reattached) {
          console.log('[AgentSrv] Re-attached orphaned agent PTY:', reattached.agentId, '| session:', clientSessionId);
          ws.send(JSON.stringify({
            type: 'agent:started',
            sessionId: clientSessionId,
            agentId: reattached.agentId,
            name: reattached.name,
            reattached: true,
          }));
          break;
        }
        // No live orphan to re-attach — fall through and start fresh. The stale
        // client sessionId is intentionally ignored (never reused as a new id).
      }

      // ── Policy: check session mode ──
      const modeCheck = ptyPolicy.checkInputAllowed(ws);
      if (!modeCheck.allowed) {
        ws.send(JSON.stringify({ type: 'agent:error', agentId, errorCode: 'readonly', message: modeCheck.reason }));
        break;
      }

      // ── Policy: check agent command ──
      if (cmd) {
        const agentPolicyCheck = ptyPolicy.checkAgent(cmd);
        if (!agentPolicyCheck.allowed) {
          ws.send(JSON.stringify({
            type: 'agent:error', agentId, errorCode: 'policy_denied',
            message: `Policy denied: ${agentPolicyCheck.reason}`,
          }));
          break;
        }
      }

      if (!cmd) {
        console.log('[AgentSrv] agent:launch rejected — no cmd for', agentId);
        ws.send(JSON.stringify({
          type: 'agent:error',
          agentId,
          errorCode: 'no_command',
          message: 'No command specified',
        }));
        break;
      }
      if (!path.isAbsolute(cmd) && !resolveCommand(cmd)) {
        console.log('[AgentSrv] agent:launch rejected — command not found:', cmd, 'for', agentId);
        ws.send(JSON.stringify({
          type: 'agent:error',
          agentId,
          errorCode: 'command_not_found',
          message: `Command "${cmd}" not found in PATH`,
        }));
        break;
      }
      const sessionId = agentManager.nextSessionId();
      console.log('[AgentSrv] Creating PTY for', agentId, '| session:', sessionId);
      const session = agentManager.createAgentPTY(cmd, args || [], ws, sessionId, agentId);
      if (session) {
        const sessions = agentManager.agentSessions.get(ws);
        // Store the SAME session object returned by createAgentPTY (no spread)
        // so orphaning on disconnect can mutate .ws and be observed by callbacks.
        session.name = name;
        sessions.set(sessionId, session);
        console.log('[AgentSrv] PTY created, sending agent:started:', agentId, '| session:', sessionId);
        ws.send(JSON.stringify({ type: 'agent:started', sessionId, agentId, name }));
      } else {
        console.log('[AgentSrv] PTY creation FAILED for', agentId, '| session:', sessionId, '(error already sent via onError)');
      }
      break;
    }

    case 'agent:input': {
      const { sessionId, data } = msg;
      if (typeof data !== 'string') break;
      const sessions = agentManager.agentSessions.get(ws);
      if (!sessions) break;
      const session = sessions.get(sessionId);
      if (session) {
        session.pty.write(data);
      }
      break;
    }

    case 'agent:kill': {
      if (msg.sessionId) {
        agentManager.killAgentSession(ws, msg.sessionId);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'agent:killed', sessionId: msg.sessionId }));
        }
      }
      break;
    }

    case 'agent:list': {
      const list = agentManager.listAgentSessions(ws);
      ws.send(JSON.stringify({ type: 'agent:list', sessions: list }));
      break;
    }

    // ── Workflow / Orchestration messages ──
    case 'workflow:start': {
      const { workflowId: wfId, name, steps } = msg;
      if (!steps || !Array.isArray(steps) || steps.length === 0) {
        ws.send(JSON.stringify({ type: 'workflow:error', message: 'No steps defined' }));
        break;
      }
      // Flat steps are auto-converted into a linear DAG by the orchestrator.
      workflowEngine.run(ws, { id: wfId, name, steps });
      break;
    }

    case 'workflow:run': {
      const { name, tasks, maxConcurrency, variables } = msg;
      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        ws.send(JSON.stringify({ type: 'workflow:error', message: 'No tasks defined' }));
        break;
      }
      workflowEngine.run(ws, { name, tasks, maxConcurrency, variables });
      break;
    }

    case 'workflow:addTask': {
      const { task, wfId } = msg;
      if (!task) {
        ws.send(JSON.stringify({ type: 'workflow:error', message: 'No task defined' }));
        break;
      }
      // wfId optional: omitted → routes to the client's most-recent run.
      const r = workflowEngine.addTask(ws, task, wfId);
      if (r && r.error) {
        ws.send(JSON.stringify({ type: 'workflow:error', message: r.error }));
      }
      break;
    }

    case 'workflow:cancel': {
      const { wfId: cancelId } = msg;
      if (cancelId) {
        workflowEngine.cancel(ws, cancelId);
      }
      break;
    }

    case 'agent:msg': {
      const { kind, msgId, from, to, payload, wfId } = msg;
      if (!kind || !to) {
        ws.send(JSON.stringify({ type: 'agent:error', message: 'kind and to are required' }));
        break;
      }
      // wfId optional: omitted → routes to the client's most-recent run.
      workflowEngine.sendMessage(ws, { kind, msgId, from, to, payload, wfId });
      break;
    }

    // ── Digital Employee messages ──
    case 'de:register': {
      const { role, name, agentId } = msg;
      if (!role || !agentId) {
        ws.send(JSON.stringify({ type: 'de:error', message: 'role and agentId are required' }));
        break;
      }
      const employee = createDigitalEmployee({ role, name, agentId, contextStore });
      digitalEmployeeTeam.register(employee);
      ws.send(JSON.stringify({ type: 'de:registered', employee: employee.getStatus() }));
      break;
    }

    case 'de:unregister': {
      const { employeeId } = msg;
      if (employeeId) {
        digitalEmployeeTeam.unregister(employeeId);
        ws.send(JSON.stringify({ type: 'de:unregistered', employeeId }));
      }
      break;
    }

    case 'de:team-status': {
      const status = digitalEmployeeTeam.getTeamStatus();
      ws.send(JSON.stringify({ type: 'de:team-status', ...status }));
      break;
    }

    case 'de:dispatch': {
      const { role, task } = msg;
      if (!role || !task) {
        ws.send(JSON.stringify({ type: 'de:error', message: 'role and task are required' }));
        break;
      }
      digitalEmployeeTeam.dispatchTask(role, task)
        .then(r => ws.send(JSON.stringify({ type: 'de:dispatched', role, task: task.id, result: r })))
        .catch(e => ws.send(JSON.stringify({ type: 'de:error', message: e.message })));
      break;
    }

    case 'human:respond': {
      const { taskId, answer } = msg;
      if (taskId && answer !== undefined) {
        contextStore.set(`human:response:${taskId}`, { answer, timestamp: Date.now() }, {
          tags: ['human:response'],
          type: 'human:response',
          source: 'human',
          ttl: 60000,
        });
        ws.send(JSON.stringify({ type: 'human:responded', taskId }));
      }
      break;
    }

    // ── Tab management ──
    case 'tab:list': {
      const tbs = activePTYs.get(ws);
      const list = [];
      if (tbs) {
        for (const [tid, tab] of tbs) {
          list.push({ tabId: tid, cliId: tab.cliId, name: tab.name });
        }
      }
      ws.send(JSON.stringify({ type: 'tab:list', tabs: list }));
      break;
    }

    // ── Context Store messages ──
    case 'set_mode': {
      const { mode } = msg;
      if (mode === 'readonly' || mode === 'normal') {
        ptyPolicy.setMode(ws, mode);
        ws.send(JSON.stringify({ type: 'mode:changed', mode }));
        console.log('[WS] Session mode set to', mode);
      }
      break;
    }

    case 'policy:check': {
      const { command, path: checkPath } = msg;
      if (command) {
        const result = ptyPolicy.checkCLI(command);
        ws.send(JSON.stringify({ type: 'policy:result', command, allowed: result.allowed, reason: result.reason }));
      } else if (checkPath) {
        const result = ptyPolicy.checkPath(checkPath);
        ws.send(JSON.stringify({ type: 'policy:result', path: checkPath, allowed: result.allowed, reason: result.reason }));
      }
      break;
    }

    case 'policy:reload': {
      // Hot-reload: re-read .cli-q-policy.json from disk
      const { reloadPolicy } = require('../mcp/security/policy');
      reloadPolicy();
      ws.send(JSON.stringify({ type: 'policy:reloaded' }));
      break;
    }

    case 'context:get': {
      const { key } = msg;
      if (!key) break;
      const entry = contextStore.get(key);
      ws.send(JSON.stringify({ type: 'context:entry', key, entry }));
      break;
    }

    case 'context:query': {
      const { type, tag, source } = msg;
      let results = [];
      if (tag) {
        results = contextStore.findByTag(tag);
      } else if (type) {
        results = contextStore.getAllByType(type);
      } else if (source) {
        results = contextStore.query(e => e.source === source);
      } else {
        results = contextStore.snapshot();
      }
      ws.send(JSON.stringify({
        type: 'context:query:result',
        query: { type, tag, source },
        entries: results.map(e => ({ ...e, value: '[truncated]' })),
        count: results.length,
      }));
      break;
    }

    case 'context:snapshot': {
      const snapshot = contextStore.snapshot();
      ws.send(JSON.stringify({
        type: 'context:snapshot',
        entries: snapshot.map(e => ({ ...e, value: '[truncated]' })),
        count: snapshot.length,
      }));
      break;
    }

    case 'context:stats': {
      ws.send(JSON.stringify({
        type: 'context:stats',
        stats: contextStore.stats,
      }));
      break;
    }

    case 'context:clear': {
      contextStore.clear();
      ws.send(JSON.stringify({ type: 'context:cleared' }));
      break;
    }

    case 'ping': {
      // Echo back the client timestamp for latency measurement
      const response = { type: 'pong' };
      if (msg.ts) response._echo = msg.ts;
      ws.send(JSON.stringify(response));
      break;
    }

    default:
      break;
  }
}

module.exports = { dispatchWSMessage };
