/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// terminalStore — WebSocket connection, xterm.js state, tabs
//
// Manages connection lifecycle, terminal instance references,
// and multi-session tab management state.
// ============================================================
// @ts-check
'use strict';

import { createStore } from './createStore.js';

/**
 * @typedef {Object} TerminalState
 * @property {boolean} connected - WebSocket connected
 * @property {boolean} launched - CLI process is running
 * @property {boolean} launching - CLI launch in progress
 * @property {number} reconnectAttempts - Current retry count
 * @property {number} maxReconnectAttempts - Max retries before giving up
 * @property {string|null} activeTabId - Currently focused tab id
 * @property {Array<{tabId:string, cliId:string, name?:string}>} tabs - Active terminal tabs
 * @property {string} connectionStatus - 'disconnected' | 'connected' | 'reconnecting' | 'error'
 */

const initialState = {
  /** @type {boolean} */
  connected: false,
  /** @type {boolean} */
  launched: false,
  /** @type {boolean} */
  launching: false,
  /** @type {number} */
  reconnectAttempts: 0,
  /** @type {number} */
  maxReconnectAttempts: 10,
  /** @type {string|null} */
  activeTabId: null,
  /** @type {Array<{tabId:string, cliId:string, name?:string}>} */
  tabs: [],
  /** @type {string} */
  connectionStatus: 'disconnected',
};

export const terminalStore = createStore(initialState);
