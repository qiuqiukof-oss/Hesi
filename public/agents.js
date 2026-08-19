/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Agent Workbench — manage AI CLI agents in sidebar
// ============================================================
'use strict';

import { escapeHtml } from './escape.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

  // ── Constants ──
  const AGENT_LAUNCH_TIMEOUT = 15000; // 15 seconds

  // ── State ──
  const agents = {
    list: [],           // list of known agents from /api/agents
    sessions: {},       // { sessionId: { agentId, name, status, log: [] } }
    pendingLaunches: {},// { agentId: timeoutId } — agents waiting for 'agent:started'
    failedLaunches: {}, // { agentId: errorMessage } — agents that failed to start
    _sessionToAgentId: {}, // { sessionId: agentId } — fallback mapping for error handling
    pendingStops: {},      // { sessionId: true } — stops awaiting backend confirmation
    ws: null,
    _logCallbacks: {},  // { sessionId: fn } for log streaming
  };

  // ── Fetch agent list from API ──
  async function loadAgents() {
    try {
      const resp = await fetch('/api/agents');
      if (!resp.ok) return [];
      const data = await resp.json();
      agents.list = data.agents || [];
      const installed = agents.list.filter(a => a.installed).length;
      console.log('[Agents] Loaded', agents.list.length, 'agents (' + installed + ' installed)');
      renderAgentList();
      return agents.list;
    } catch (err) {
      console.warn('[Agents] Load failed:', err);
      return [];
    }
  }

  // ── Render agent section in sidebar ──
  function renderAgentList() {
    const container = document.getElementById('agent-list');
    if (!container) return;

    const installed = agents.list.filter(a => a.installed);
    const notInstalled = agents.list.filter(a => !a.installed);

    container.innerHTML = '';

    if (installed.length === 0 && Object.keys(agents.failedLaunches).length === 0) {
      container.innerHTML = '<div class="agent-empty">No AI agents detected</div>';
      return;
    }

    // Track which agent IDs we've rendered
    const renderedIds = new Set();

    for (const agent of installed) {
      renderedIds.add(agent.id);

      const running = isAgentRunning(agent.id);
      const pending = agent.id in agents.pendingLaunches;
      const failed = agents.failedLaunches[agent.id];

      const el = document.createElement('div');
      let cls = 'agent-item';
      if (running) cls += ' running';
      if (pending) cls += ' pending';
      if (failed) cls += ' failed';
      el.className = cls;
      el.dataset.agentId = agent.id;

      // Icon + name
      const icon = document.createElement('span');
      icon.className = 'agent-icon';
      icon.textContent = pending ? '⏳' : (failed ? '❌' : agent.icon);
      el.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'agent-info';

      const name = document.createElement('div');
      name.className = 'agent-name';
      name.textContent = agent.displayName;
      info.appendChild(name);

      if (pending) {
        const statusText = document.createElement('div');
        statusText.className = 'agent-version agent-status-text';
        statusText.textContent = 'Starting...';
        info.appendChild(statusText);
      } else if (failed) {
        const statusText = document.createElement('div');
        statusText.className = 'agent-version agent-status-text error';
        statusText.textContent = failed;
        info.appendChild(statusText);
      } else if (agent.version && agent.version !== 'unknown') {
        const ver = document.createElement('div');
        ver.className = 'agent-version';
        ver.textContent = agent.version;
        info.appendChild(ver);
      }

      el.appendChild(info);

      // Status indicator
      const status = document.createElement('span');
      status.className = 'agent-status-dot';
      if (pending) status.classList.add('pending');
      if (failed) status.classList.add('error');
      el.appendChild(status);

      // Action button
      const btn = document.createElement('button');
      btn.className = 'agent-action-btn';
      if (pending) {
        btn.textContent = '◌';
        btn.title = 'Launching...';
        btn.disabled = true;
      } else if (running) {
        btn.textContent = '■';
        btn.title = 'Stop agent';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          stopAgent(agent.id);
        });
      } else {
        btn.textContent = failed ? '↻' : '▶';
        btn.title = failed ? 'Retry' : 'Start agent';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Clear previous failure
          delete agents.failedLaunches[agent.id];
          startAgent(agent);
        });
      }
      el.appendChild(btn);

      // Click to view log if running
      el.addEventListener('click', () => {
        if (running) showAgentLog(agent.id);
      });

      container.appendChild(el);
    }

    // ── Render fictional failed agents (not in installed list) ──
    for (const agentId in agents.failedLaunches) {
      if (renderedIds.has(agentId)) continue;

      const errorMsg = agents.failedLaunches[agentId];
      const el = document.createElement('div');
      el.className = 'agent-item failed';
      el.dataset.agentId = agentId;

      // Icon
      const icon = document.createElement('span');
      icon.className = 'agent-icon';
      icon.textContent = '❌';
      el.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.className = 'agent-info';

      const name = document.createElement('div');
      name.className = 'agent-name';
      name.textContent = agentId;
      info.appendChild(name);

      const statusText = document.createElement('div');
      statusText.className = 'agent-version agent-status-text error';
      statusText.textContent = errorMsg;
      info.appendChild(statusText);

      el.appendChild(info);

      // Red status dot
      const status = document.createElement('span');
      status.className = 'agent-status-dot error';
      el.appendChild(status);

      // Dismiss button
      const btn = document.createElement('button');
      btn.className = 'agent-action-btn';
      btn.textContent = '✕';
      btn.title = 'Dismiss';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        delete agents.failedLaunches[agentId];
        renderAgentList();
      });
      el.appendChild(btn);

      container.appendChild(el);
    }
  }

  // ── Check if agent has a running session ──
  function isAgentRunning(agentId) {
    for (const sid in agents.sessions) {
      if (agents.sessions[sid].agentId === agentId) return true;
    }
    return false;
  }

  // ── Clear a pending launch (by agentId) ──
  function clearPendingLaunch(agentId) {
    if (agentId in agents.pendingLaunches) {
      clearTimeout(agents.pendingLaunches[agentId]);
      delete agents.pendingLaunches[agentId];
      console.log('[Agents] Cleared pending launch:', agentId);
    }
  }

  // ── Start an agent via WebSocket ──
  function startAgent(agent) {
    const wsState = agents.ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][agents.ws.readyState] || 'UNKNOWN' : 'NO_WS';
    console.log('[Agents] startAgent:', agent?.id, '| path:', agent?.path, '| args:', agent?.defaultArgs || [], '| ws:', wsState);

    // Validate agent object
    if (!agent || !agent.id) {
      showAgentToast('Cannot start: invalid agent', 'error');
      return;
    }

    // Validate path — fail fast instead of sending a WS message that will error out
    if (!agent.path) {
      agents.failedLaunches[agent.id] = 'No command configured';
      renderAgentList();
      showAgentToast(`${agent.displayName || agent.id}: no command configured`, 'error');
      return;
    }

    if (!agents.ws || agents.ws.readyState !== WebSocket.OPEN) {
      showAgentToast('WebSocket not connected', 'error');
      return;
    }
    if (isAgentRunning(agent.id)) {
      showAgentToast(`${agent.displayName} is already running`, 'info');
      return;
    }
    if (agent.id in agents.pendingLaunches) {
      showAgentToast(`${agent.displayName} is already starting...`, 'info');
      return;
    }

    // Mark as pending with timeout
    delete agents.failedLaunches[agent.id];
    const timeoutId = setTimeout(() => {
      delete agents.pendingLaunches[agent.id];
      agents.failedLaunches[agent.id] = 'Timed out';
      console.log('[Agents] Timeout for', agent.id, '(' + AGENT_LAUNCH_TIMEOUT + 'ms)');
      renderAgentList();
      showAgentToast(`${agent.displayName} failed to start (timeout ${AGENT_LAUNCH_TIMEOUT / 1000}s)`, 'error');
    }, AGENT_LAUNCH_TIMEOUT);
    agents.pendingLaunches[agent.id] = timeoutId;

    agents.ws.send(JSON.stringify({
      type: 'agent:launch',
      agentId: agent.id,
      name: agent.displayName,
      cmd: agent.path,
      args: agent.defaultArgs || [],
    }));
    console.log('[Agents] Sent agent:launch:', agent.id, '| sessionId pending');
    renderAgentList();
    showAgentToast(`Starting ${agent.displayName}...`, 'info');
  }

  // ── Stop an agent ──
  function stopAgent(agentId) {
    for (const sid in agents.sessions) {
      if (agents.sessions[sid].agentId === agentId) {
        if (!agents.ws || agents.ws.readyState !== WebSocket.OPEN) return;
        console.log('[Agents] Stopping:', agentId, '| session:', sid);
        agents.pendingStops[sid] = true;
        agents.ws.send(JSON.stringify({ type: 'agent:kill', sessionId: sid }));
        // Toast deferred to agent:exit / agent:killed confirmation
        return;
      }
    }
    console.log('[Agents] stopAgent: no running session for', agentId);
  }

  // ── Show agent log in a floating overlay ──
  function showAgentLog(agentId) {
    for (const sid in agents.sessions) {
      if (agents.sessions[sid].agentId === agentId) {
        const session = agents.sessions[sid];
        // Create or reuse log overlay
        let overlay = document.getElementById('agent-log-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'agent-log-overlay';
          overlay.className = 'agent-log-overlay';
          overlay.innerHTML = `
            <div class="agent-log-header">
              <span class="agent-log-title"></span>
              <span class="agent-log-hint">Esc close</span>
            </div>
            <div class="agent-log-content"></div>
          `;
          document.body.appendChild(overlay);

          overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeAgentLog();
          });
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeAgentLog();
          });
        }

        overlay.classList.remove('hidden');
        overlay.querySelector('.agent-log-title').textContent = `📋 ${session.name} Log`;
        const content = overlay.querySelector('.agent-log-content');
        content.innerHTML = session.log.map(l => `<div class="agent-log-line">${escapeHtml(l)}</div>`).join('');
        content.scrollTop = content.scrollHeight;
        return;
      }
    }
  }

  function closeAgentLog() {
    const overlay = document.getElementById('agent-log-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ── Simple inline toast ──
  function showAgentToast(msg, type) {
    const el = document.getElementById('agent-toast') || (() => {
      const e = document.createElement('div');
      e.id = 'agent-toast';
      e.className = 'agent-toast';
      document.body.appendChild(e);
      return e;
    })();
    el.textContent = msg;
    el.className = 'agent-toast ' + (type || 'info');
    el.classList.add('visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // ── Handle WebSocket messages for agents ──
  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'agent:started': {
        console.log('[Agents] Received agent:started:', msg.agentId, '| session:', msg.sessionId, '| reattached:', !!msg.reattached);
        clearPendingLaunch(msg.agentId);
        delete agents.failedLaunches[msg.agentId];
        agents._sessionToAgentId[msg.sessionId] = msg.agentId;
        const existing = agents.sessions[msg.sessionId];
        if (existing && msg.reattached) {
          // Re-connected to the same still-running agent PTY — keep log/UI state.
          existing.status = 'running';
          existing.reattached = true;
        } else {
          agents.sessions[msg.sessionId] = {
            agentId: msg.agentId,
            name: msg.name,
            status: 'running',
            log: [],
            reattached: !!msg.reattached,
          };
        }
        renderAgentList();
        break;
      }

      case 'agent:output': {
        const session = agents.sessions[msg.sessionId];
        if (session) {
          const isFirstOutput = session.log.length === 0;
          session.log.push(msg.data);
          if (session.log.length > 500) session.log.splice(0, session.log.length - 500);
          if (isFirstOutput) {
            console.log('[Agents] First output from', session.name, '| session:', msg.sessionId, '| size:', msg.data.length);
          }
          // Update log overlay if open
          const logContent = document.querySelector('#agent-log-overlay .agent-log-content');
          if (logContent && !logContent.closest('.hidden')) {
            const line = document.createElement('div');
            line.className = 'agent-log-line';
            line.textContent = msg.data;
            logContent.appendChild(line);
            logContent.scrollTop = logContent.scrollHeight;
          }
        }
        break;
      }

      case 'agent:exit': {
        const session = agents.sessions[msg.sessionId];
        console.log('[Agents] Received agent:exit:', msg.sessionId, '| code:', msg.code, '| signal:', msg.signal);
        if (session) {
          session.status = 'exited';
          const wasUserStop = msg.sessionId in agents.pendingStops;
          if (wasUserStop) {
            showAgentToast(`${session.name} stopped`, 'info');
          } else if (msg.code === 0) {
            showAgentToast(`${session.name} completed`, 'success');
          } else {
            showAgentToast(`${session.name} exited (code ${msg.code})`, 'error');
          }
          clearPendingLaunch(session.agentId);
          delete agents.failedLaunches[session.agentId];
          delete agents._sessionToAgentId[msg.sessionId];
          delete agents.pendingStops[msg.sessionId];
          delete agents.sessions[msg.sessionId];
          renderAgentList();
        } else {
          console.log('[Agents] exit for unknown session:', msg.sessionId);
        }
        break;
      }

      case 'agent:killed': {
        console.log('[Agents] Received agent:killed:', msg.sessionId);
        // Fallback: if agent:exit didn't arrive, clean up via agent:killed
        const killedSession = agents.sessions[msg.sessionId];
        if (killedSession) {
          showAgentToast(`${killedSession.name} stopped`, 'info');
          clearPendingLaunch(killedSession.agentId);
          delete agents.failedLaunches[killedSession.agentId];
          delete agents._sessionToAgentId[msg.sessionId];
          delete agents.pendingStops[msg.sessionId];
          delete agents.sessions[msg.sessionId];
          renderAgentList();
        } else {
          // Session already cleaned up by agent:exit — just clean up pendingStops
          delete agents.pendingStops[msg.sessionId];
        }
        break;
      }

      case 'agent:error': {
        console.log('[Agents] Received agent:error:', msg.agentId || '(no agentId)', '| session:', msg.sessionId, '| code:', msg.errorCode, '| msg:', msg.message);
        // Try direct agentId, then fallback to sessionId → agentId mapping
        let agentId = msg.agentId;
        if (!agentId && msg.sessionId && agents._sessionToAgentId[msg.sessionId]) {
          agentId = agents._sessionToAgentId[msg.sessionId];
          console.log('[Agents] Resolved agentId via _sessionToAgentId:', agentId);
        }
        // Build user-facing error message based on errorCode
        let displayMessage = msg.message || 'Launch failed';
        let toastMessage = 'Agent error';
        switch (msg.errorCode) {
          case 'no_command':
            displayMessage = 'No command specified';
            toastMessage = `${agentId ? agents.list.find(a => a.id === agentId)?.displayName || agentId : 'Agent'}: no command configured`;
            break;
          case 'command_not_found':
            displayMessage = msg.message || 'Command not found in PATH';
            toastMessage = `${agentId ? agents.list.find(a => a.id === agentId)?.displayName || agentId : 'Agent'}: command not found`;
            break;
          case 'spawn_error':
            displayMessage = msg.message || 'Failed to spawn process';
            toastMessage = `${agentId ? agents.list.find(a => a.id === agentId)?.displayName || agentId : 'Agent'}: failed to start`;
            break;
          default:
            toastMessage = 'Agent error: ' + (msg.message || 'unknown');
            break;
        }
        // If we matched a pending launch, mark it as failed
        if (agentId && agentId in agents.pendingLaunches) {
          clearPendingLaunch(agentId);
          agents.failedLaunches[agentId] = displayMessage;
          renderAgentList();
        } else {
          console.log('[Agents] Error not matched to pending launch:', JSON.stringify({ agentId, pendingKeys: Object.keys(agents.pendingLaunches) }));
        }
        showAgentToast(toastMessage, 'error');
        break;
      }
    }
  }

  // ── Wire up ──
  export const Agents = {
    loadAgents,
    renderAgentList,
    startAgent,
    stopAgent,
    handleWSMessage,
    isAgentRunning,
    showAgentLog,
    closeAgentLog,
    agents,
  };
  Q.Agents = Agents;
