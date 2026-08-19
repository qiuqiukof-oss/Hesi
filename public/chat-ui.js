/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Chat UI Module — chat panel rendering & interactions
//
// Phase 2: Delegates to <chat-panel> Web Component.
// Keeps backward compat: Q.ChatUI namespace.
// ============================================================
'use strict';

// Import the Web Component — triggers customElements.define('chat-panel')
// The component's _patchQCLI() (deferred via microtask) will overwrite
// Q.ChatUI.* methods after app.js runs.
import './components/chat-panel.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/** @type {Object} */
export const ChatUI = {
  open: false,
  messages: /** @type {Array} */ ([]),
  sending: false,
  sendChatMessage: null,
  toggleChat: null,
  clearChatHistory: null,
  appendMessageToDOM: null,
  renderChatMessages: null,
  showThinkingIndicator: null,
  removeThinkingIndicator: null,
  scrollChatToBottom: null,
  init: null,
};

Q.ChatUI = ChatUI;
