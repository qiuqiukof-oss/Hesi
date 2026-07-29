/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// cliStore — CLI list, folders, active session, search, filters
//
// Manages the registry of available CLI tools, folder
// organization, current active CLI, search query, and
// category / favorites filtering.
// ============================================================
// @ts-check
'use strict';

import { createStore } from './createStore.js';
import { safeStorage } from '../lib/storage.js';

/** @typedef {{ id: string, name: string, version?: string, path?: string, args?: string[], type?: string, category?: string, init?: string }} CliEntry */
/** @typedef {{ id: string, name: string, cliIds: string[], collapsed?: boolean }} FolderEntry */

/**
 * @typedef {Object} CliState
 * @property {CliEntry[]} clis - All registered CLI entries
 * @property {FolderEntry[]} folders - All folder groupings
 * @property {string|null} activeCliId - Currently active/running CLI id (or null)
 * @property {string} searchQuery - Current search filter text
 * @property {string|null} renamingFolderId - Folder id being renamed (or null)
 * @property {string} categoryFilter - Active filter: 'all' | 'favorites' | 'agent' | 'directory' | 'tool'
 * @property {boolean} launched - Whether a CLI process is currently launched
 * @property {boolean} launching - Whether a launch is in progress
 */

const initialState = {
  /** @type {CliEntry[]} */
  clis: [],
  /** @type {FolderEntry[]} */
  folders: [],
  /** @type {string|null} */
  activeCliId: null,
  /** @type {string} */
  searchQuery: '',
  /** @type {string|null} */
  renamingFolderId: null,
  /** @type {string} */
  categoryFilter: 'all',
  /** @type {boolean} */
  launched: false,
  /** @type {boolean} */
  launching: false,
};

export const cliStore = createStore(initialState);

// ── Convenience selectors (computed from state) ──

/**
 * Find a CLI entry by id.
 * @param {string} id
 * @returns {CliEntry|null}
 */
export function getCli(id) {
  return cliStore.getState().clis.find(c => c.id === id) || null;
}

/**
 * Find which folder a CLI belongs to (or null if uncategorized).
 * @param {string} cliId
 * @returns {FolderEntry|null}
 */
export function findFolderForCli(cliId) {
  const { folders } = cliStore.getState();
  return folders.find(f => f.cliIds.includes(cliId)) || null;
}

/**
 * Get active CLI entry (or null).
 * @returns {CliEntry|null}
 */
export function getActiveCli() {
  const { clis, activeCliId } = cliStore.getState();
  return clis.find(c => c.id === activeCliId) || null;
}

// ── LocalStorage helpers for favorites / hidden (kept here for cohesion) ──

const FAV_KEY = 'qcli-favorites';
const HIDE_KEY = 'qcli-hidden';

/** @returns {string[]} */
export function getFavorites() {
  const val = safeStorage.getJSON(FAV_KEY, []);
  return Array.isArray(val) ? val : [];
}

/** @param {string[]} ids */
export function setFavorites(ids) {
  safeStorage.setJSON(FAV_KEY, ids);
}

/** @param {string} cliId @returns {boolean} */
export function isFavorite(cliId) {
  return getFavorites().includes(cliId);
}

/** @param {string} cliId */
export function toggleFavorite(cliId) {
  const favs = getFavorites();
  const idx = favs.indexOf(cliId);
  if (idx === -1) favs.push(cliId); else favs.splice(idx, 1);
  setFavorites(favs);
}

/** @returns {string[]} */
export function getHidden() {
  const val = safeStorage.getJSON(HIDE_KEY, []);
  return Array.isArray(val) ? val : [];
}

/** @param {string} cliId @returns {boolean} */
export function isHidden(cliId) {
  return getHidden().includes(cliId);
}

/** @param {string} cliId */
export function toggleHidden(cliId) {
  const hidden = getHidden();
  const idx = hidden.indexOf(cliId);
  if (idx === -1) hidden.push(cliId); else hidden.splice(idx, 1);
  safeStorage.setJSON(HIDE_KEY, hidden);
}

// ── Icon map (moved from app.js for reuse) ──
/** @param {string} name @returns {string} */
export function getCliIcon(name) {
  const icons = {
    opencode: '\u26a1', node: '\ud83d\udfe2',
    python: '\ud83d\udc0d', python3: '\ud83d\udc0d',
    git: '\u2387', docker: '\ud83d\udc33', kubectl: '\u2638',
    npm: '\ud83d\udce6', npx: '\ud83d\udce6', pnpm: '\ud83d\udce6',
    yarn: '\ud83d\udce6', bun: '\ud83e\udd5f',
    bash: '>_', zsh: '%', powershell: '\ud83e\ude9f', pwsh: '\ud83e\ude9f', cmd: '>',
    ssh: '\ud83d\udd10', mysql: '\ud83d\udc2c', redis: '\ud83d\udd34',
    mongosh: '\ud83c\udf43', cargo: '\ud83e\udd80', go: '\ud83d\udd37',
    deno: '\ud83e\udd95',
    vim: '\u270f\ufe0f', nvim: '\u270f\ufe0f', nano: '\u270f\ufe0f',
    tmux: '\u229e', lazygit: '\u2387', gh: '\ud83d\udc19',
    code: '\ud83d\udcbb', curl: '\ud83c\udf10', wget: '\u2b07',
    htop: '\ud83d\udcca', btop: '\ud83d\udcca',
    neofetch: '\ud83d\udda5', fastfetch: '\ud83d\udda5',
  };
  return icons[name] || '\u25b8';
}
