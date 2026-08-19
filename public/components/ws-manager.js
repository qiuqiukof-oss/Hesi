/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// <ws-manager> — WebSocket Connection Manager
//
// Phase 2: Extracts WebSocket connection lifecycle from app.js.
// Manages connect, reconnect, heartbeat, and message dispatch.
//
// API
//   Q.wsSend(data)           — send JSON over WebSocket
//   Q.wsConnect()            — initiate connection
//   Q.wsDisconnect()         — close + cleanup
//   Q.ws                     — raw WebSocket instance (set on connect)
//   Q.setConnectionStatus()  — update status indicator UI
//   Q.onWSMessage(msg)       — hook set by app.js for message routing
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

class WSManager {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    /** @type {number|null} */
    this.heartbeatInterval = null;
    /** @type {number|null} */
    this._qualityMonitorInterval = null;
    /** @type {number} */
    this.reconnectAttempts = 0;
    /** @type {number} */
    this.maxReconnectAttempts = 30;
    /** @type {number|null} */
    this._connectTimeout = null;
    /** @type {number} */
    this._connectionTimeoutMs = 10000;
    /** @type {Array} */
    this._messageQueue = [];
    /** @type {boolean} */
    this._messageQueueFlushing = false;
    /** @type {number} */
    this._lastPingTime = 0;
    /** @type {number} */
    this._lastPongTime = 0;
    /** @type {number} */
    this._averageLatency = 0;
    /** @type {number} */
    this._latencySamples = 0;
    /** @type {number} */
    this._consecutiveDrops = 0;
    /** @type {number} */
    this._pongTimeout = null;
  }

  // ── URL ──

  getWSURL() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  // ── Send ──

  send(data, { force = false } = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    } else if (force || data.type === 'ping') {
      // 丢弃心跳，不缓冲
      return false;
    } else {
      // 断线期间缓冲非关键消息，重连后发送
      if (this.reconnectAttempts > 0 && this.reconnectAttempts <= this.maxReconnectAttempts) {
        this._messageQueue.push(data);
        if (this._messageQueue.length > 50) {
          this._messageQueue.shift(); // 防止无限增长
        }
      }
      return false;
    }
  }

  /** 刷新消息队列 */
  _flushMessageQueue() {
    if (this._messageQueueFlushing) return;
    this._messageQueueFlushing = true;
    
    let sent = 0;
    while (this._messageQueue.length > 0) {
      const msg = this._messageQueue.shift();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(msg));
          sent++;
        } catch (e) {
          // 发送失败，重新放回队列
          this._messageQueue.unshift(msg);
          break;
        }
      } else {
        break;
      }
    }
    
    if (sent > 0) {
      console.log(`[WS] Flushed ${sent} queued messages`);
    }
    this._messageQueueFlushing = false;
  }

  // ── Connect ──

  connect() {
    const Q = window.QCLI || {};
    this.maxReconnectAttempts = Q.state?.maxReconnectAttempts || 30;
    const url = this.getWSURL();
    console.log('[WS] Connecting to', url, '(attempt', this.reconnectAttempts + 1, '/', this.maxReconnectAttempts + ')');

    // Show 'Connecting...' immediately
    this._setConnectionStatus('connecting', 'Connecting...');

    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* WS already closed — expected during reconnect; safe to ignore */ }
    }

    // Connection timeout — if WebSocket doesn't open within 15s, surface failure
    this._clearConnectTimeout();
    this._connectTimeout = setTimeout(() => {
      console.error('[WS] Connection timeout after ' + (this._connectionTimeoutMs / 1000) + 's to', url);
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      // _onClose will fire after close() and trigger reconnect logic
    }, this._connectionTimeoutMs);

    this.ws = new WebSocket(url);
    Q.ws = this.ws;

    // Wire WebSocket to sub-modules
    if (Q.Agents?.agents) Q.Agents.agents.ws = this.ws;
    if (Q.Workflows?.workflows) Q.Workflows.workflows.ws = this.ws;

    this.ws.onopen = () => this._onOpen();
    this.ws.onmessage = (event) => this._onMessage(event);
    this.ws.onclose = () => this._onClose();
    this.ws.onerror = (err) => this._onError(err);
  }

  // ── Disconnect ──

  disconnect() {
    this._clearConnectTimeout();
    this._clearHeartbeat();
    this._clearQualityMonitor();
    this._clearPongTimeout();
    this._messageQueue = [];
    if (this.ws) {
      try { this.ws.close(); } catch (e) { /* WS already closed — expected during reconnect; best-effort cleanup */ }
      this.ws = null;
    }
    const Q = window.QCLI || {};
    Q.ws = null;
  }

  // ── Internal: Connection timeout ──

  _clearConnectTimeout() {
    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
  }

  // ── Internal: Heartbeat ──

  _clearHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  _clearPongTimeout() {
    if (this._pongTimeout) {
      clearTimeout(this._pongTimeout);
      this._pongTimeout = null;
    }
  }

  _startHeartbeat() {
    this._clearHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._lastPingTime = Date.now();
        this.ws.send(JSON.stringify({ type: 'ping', t: this._lastPingTime }));
        
        // 设置 pong 超时检测（15秒内未收到 pong 认为连接异常；本地回环网络延迟极低，
        // 但服务端执行同步任务（验收命令等）时事件循环可能短暂冻结导致 pong 延迟——
        // 5s 太紧会误杀活跃连接（实测 30s 周期性断连），放宽到 15s）
        this._clearPongTimeout();
        this._pongTimeout = setTimeout(() => {
          console.warn('[WS] Pong not received within 15s — possible stale connection');
          this._consecutiveDrops++;
          
          // 连续 3 次 pong 超时，主动断开触发重连（放宽：2 次→3 次，容忍偶发忙碌）
          if (this._consecutiveDrops >= 3) {
            console.warn('[WS] 3 consecutive pong timeouts — forcing reconnect');
            this._consecutiveDrops = 0;
            if (this.ws) {
              try { this.ws.close(); } catch (e) { /* ignore */ }
            }
          }
        }, 15000);
      }
    }, 15000); // 从 30s 缩短到 15s
  }

  /** 连接质量监控：跟踪延迟和丢包 */
  _startQualityMonitor() {
    this._clearQualityMonitor();
    this._qualityMonitorInterval = setInterval(() => {
      const Q = window.QCLI || {};
      // 每 60s 输出一次诊断信息
      if (this._latencySamples > 0) {
        const avgLatency = Math.round(this._averageLatency / this._latencySamples);
        console.log(`[WS] Connection quality: ${avgLatency}ms avg latency, ${this._latencySamples} samples`);
        
        // 更新 UI 状态指示器添加延迟信息
        if (avgLatency > 500) {
          this._setConnectionStatus('degraded', `⚠️ ${avgLatency}ms`);
        } else {
          this._setConnectionStatus('connected', `${avgLatency}ms`);
        }
        
        this._averageLatency = 0;
        this._latencySamples = 0;
      }
    }, 60000);
  }

  _clearQualityMonitor() {
    if (this._qualityMonitorInterval) {
      clearInterval(this._qualityMonitorInterval);
      this._qualityMonitorInterval = null;
    }
  }

  // ── Re-launch terminal tabs that survived a disconnect so the server can
  //    re-attach them to their still-running PTYs (instead of vanishing). ──
  _reconnectTerminals() {
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    if (!Q.Tabs || !Q.Tabs.tabs) return;
    for (const tab of Q.Tabs.tabs) {
      if (!tab || !tab.cliId) continue;
      const cols = tab.term?.cols || 80;
      const rows = tab.term?.rows || 24;
      this.send({ type: 'launch', cliId: tab.cliId, tabId: tab.tabId, cols, rows });
    }
  }

  /** Re-launch any agent sessions that survived a disconnect so the server can
   *  re-attach them to their still-running headless PTYs (same grace principle
   *  as terminals). The server matches by the original sessionId. */
  _reconnectAgents() {
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    if (!Q.Agents || !Q.Agents.sessions) return;
    for (const sid in Q.Agents.sessions) {
      const s = Q.Agents.sessions[sid];
      if (!s || s.status !== 'running') continue;
      this.send({
        type: 'agent:launch',
        sessionId: sid,
        agentId: s.agentId,
        name: s.name,
      });
      console.log('[WS] Re-launching agent session', sid, 'for reconnect');
    }
  }

  // ── Internal: Event handlers ──

  _onOpen() {
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    console.log('[WS] Connected to', this.ws?.url || '(unknown)');
    this._clearConnectTimeout();
    this._clearPongTimeout();
    // Sync all state layers — dashboard reads Q.state.connected
    if (Q.state) Q.state.connected = true;
    if (Q.terminalStore) Q.terminalStore.setState({ connected: true });
    this.reconnectAttempts = 0;
    this._consecutiveDrops = 0;
    if (Q.state) Q.state.reconnectAttempts = 0;
    this._setConnectionStatus('connected');
    if (Q.hideProgressBar) Q.hideProgressBar();
    if (Q.Presets?.loadPresets) Q.Presets.loadPresets();
    this._startHeartbeat();
    this._startQualityMonitor();
    // 重连后刷新消息队列
    this._flushMessageQueue();
    // Re-launch any terminal tabs that survived a disconnect so the server can
    // re-attach them to their still-running PTYs.
    this._reconnectTerminals();
    // Re-launch any agent sessions that survived a disconnect so the server can
    // re-attach them to their still-running headless PTYs.
    this._reconnectAgents();
  }

  _onMessage(event) {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    
    // 处理心跳消息
    if (msg.type === 'pong') {
      this._clearPongTimeout();
      this._consecutiveDrops = 0;
      
      if (this._lastPingTime > 0) {
        const latency = Date.now() - this._lastPingTime;
        this._averageLatency += latency;
        this._latencySamples++;
      }
      return;
    }
    
    // 响应服务端 ping（含 timestamp 回显）
    if (msg.type === 'ping') {
      this.ws.send(JSON.stringify({ type: 'pong', _echo: msg.t || null }));
      return;
    }
    
    // Route to app.js message handler (set via Q.onWSMessage)
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    if (Q.onWSMessage) {
      Q.onWSMessage(msg);
    } else {
      console.log('[WS] No onWSMessage handler registered — dropping:', msg.type);
    }
  }

  _onClose() {
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    const wsUrl = this.ws?.url || '(no ws instance)';
    const willRetry = this.reconnectAttempts < this.maxReconnectAttempts;
    console.log('[WS] Disconnected from', wsUrl, '| retry:', willRetry, '| attempt:', this.reconnectAttempts + 1);

    this._clearConnectTimeout();
    this._clearHeartbeat();

    // Sync all state layers — dashboard reads Q.state.connected
    if (Q.state) Q.state.connected = false;
    if (Q.terminalStore) Q.terminalStore.setState({ connected: false, launched: false });

    // NOTE: Do NOT close terminal tabs on a transient disconnect — the server
    // keeps the PTY alive for a reconnect grace window and re-attaches on
    // reconnect, so a running terminal (e.g. opencodecli) survives a blip.
    // Tabs are only force-closed if reconnection is permanently lost (below).

    // Notify workflows of disconnect
    if (Q.Workflows?.handleDisconnect) Q.Workflows.handleDisconnect();

    // Reconnect with adaptive backoff
    if (willRetry) {
      if (Q.state) Q.state.reconnectAttempts = this.reconnectAttempts;
      this.reconnectAttempts++;
      
      // 自适应退避：首次快速重试，后续指数级增长，最长 20s
      let delay;
      if (this.reconnectAttempts <= 2) {
        delay = 500;  // 前两次快速重试（500ms）
      } else if (this.reconnectAttempts <= 5) {
        delay = 1000; // 第 3-5 次 1s
      } else {
        delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 5), 20000);
      }
      
      // 显示重连进度
      const pct = Math.round((this.reconnectAttempts / this.maxReconnectAttempts) * 100);
      this._setConnectionStatus('reconnecting', `重连中 ${pct}%`);
      
      console.log('[WS] Reconnecting in ' + delay + 'ms (attempt ' + this.reconnectAttempts + '/' + this.maxReconnectAttempts + ')');
      
      // 显示重连进度条
      if (Q.showProgressBar) {
        Q.showProgressBar(pct, `正在重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      }
      
      setTimeout(() => this.connect(), delay);
    } else {
      this._setConnectionStatus('error', '连接已断开');
      console.warn('[WS] Max reconnect attempts (' + this.maxReconnectAttempts + ') reached. Closing tabs.');
      // Reconnection is permanently lost — now it is safe to tear down tabs.
      if (Q.showProgressBar) Q.showProgressBar(100, '重连失败');
      if (Q.Tabs) Q.Tabs.closeAll();
      if (Q.dom?.connectionLost) Q.dom.connectionLost.classList.add('visible');
    }
  }

  /** @param {Event} err */
  _onError(err) {
    const wsUrl = this.ws?.url || '(unknown)';
    const readyState = this.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState] || this.ws.readyState : 'N/A';
    console.error('[WS] Error on', wsUrl, '| state:', readyState, '| event:', err.type || err);
  }

  // ── Internal: Status indicator ──

  /**
   * @param {string} status
   * @param {string} [customText]
   */
  _setConnectionStatus(status, customText) {
    const Q = /** @type {QCLI} */ (window.QCLI || {});
    if (!Q.dom) return;
    
    // 更新状态指示器
    if (Q.dom.statusIndicator) {
      Q.dom.statusIndicator.className = 'status-indicator ' + status;
      // 添加 data 属性供 CSS 使用
      Q.dom.statusIndicator.dataset.status = status;
    }
    
    // 更新连接状态容器
    const connStatus = document.getElementById('connection-status');
    if (connStatus) {
      connStatus.className = 'status-indicator ' + status;
      connStatus.dataset.status = status;
    }
    
    // 文本映射
    const labels = {
      connecting: customText || '连接中…',
      connected: customText || '已连接',
      disconnected: customText || '已断开',
      reconnecting: customText || '重连中…',
      error: customText || '连接失败',
      degraded: customText || '⚠️ 延迟高',
    };
    
    if (Q.dom.statusText) {
      Q.dom.statusText.textContent = labels[status] || status;
    }
    
    // 更新连接状态描述
    const statusTextEl = document.querySelector('#connection-status .status-text');
    if (statusTextEl) {
      statusTextEl.textContent = labels[status] || status;
    }
  }
}

// ── Patch QCLI namespace ──

const Q = window.QCLI = window.QCLI || {};
const manager = new WSManager();
Q.wsManager = manager;
Q.wsSend = (data) => manager.send(data);
Q.wsConnect = () => manager.connect();
Q.wsDisconnect = () => manager.disconnect();
Q.setConnectionStatus = (status, customText) => manager._setConnectionStatus(status, customText);
// Q.ws is set dynamically on each connect()

export default WSManager;
