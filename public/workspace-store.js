/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Workspace Store — Save/restore tab configurations as profiles
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

import { safeStorage } from './lib/storage.js';

/** @type {string} */
const STORAGE_KEY = 'qcli-workspaces';
const MAX_WORKSPACES = 20;

/**
 * @typedef {Object} Workspace
 * @property {string} id
 * @property {string} name
 * @property {Array<{cliId:string,name:string,icon:string,init:string}>} tabs
 * @property {number} createdAt
 * @property {number} tabCount
 */

/** @type {{getAll():Array, _saveAll(workspaces:Array):void, save(name:string, tabs:Array):Promise<Object|null>, remove(id:string):void, get(id:string):Object|null}} */
export const WorkspaceStore = {
  /** Get all saved workspaces */
  getAll() {
    return safeStorage.getJSON(STORAGE_KEY, []);
  },

  /** Save all workspaces */
  _saveAll(workspaces) {
    safeStorage.setJSON(STORAGE_KEY, workspaces);
  },

  /** Create a new workspace from current tabs */
  async save(name, tabs) {
    if (!name || !name.trim()) return null;
    const workspaces = this.getAll();
    // Sort tabs: pinned first
    const sorted = [...tabs].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });
    const ws = {
      id: 'ws-' + Date.now(),
      name: name.trim(),
      tabs: sorted.map(t => ({
        cliId: t.cliId,
        name: t.name,
        icon: t.icon,
        init: t.init || '',
      })),
      createdAt: Date.now(),
      tabCount: sorted.length,
    };
    workspaces.push(ws);
    if (workspaces.length > MAX_WORKSPACES) {
      workspaces.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      workspaces.length = MAX_WORKSPACES;
    }
    this._saveAll(workspaces);
    return ws;
  },

  /** Delete a workspace by id */
  remove(id) {
    const workspaces = this.getAll().filter(w => w.id !== id);
    this._saveAll(workspaces);
  },

  /** Get a single workspace by id */
  get(id) {
    return this.getAll().find(w => w.id === id) || null;
  },
};

// Legacy compat
Q.WorkspaceStore = WorkspaceStore;
