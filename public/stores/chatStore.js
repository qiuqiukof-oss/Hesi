/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// chatStore — AI Chat Drawer State
//
// Manages the chat panel: messages, open/close, sending state.
// ============================================================
// @ts-check
'use strict';

import { createStore } from './createStore.js';

/**
 * @typedef {{ role: 'user'|'assistant', content: string }} ChatMessage
 */

/**
 * @typedef {Object} ChatState
 * @property {boolean} open - Whether chat drawer is visible
 * @property {ChatMessage[]} messages - Chat message history
 * @property {boolean} sending - Whether a response is in progress
 */

const initialState = {
  /** @type {boolean} */
  open: false,
  /** @type {ChatMessage[]} */
  messages: [],
  /** @type {boolean} */
  sending: false,
};

export const chatStore = createStore(initialState);
