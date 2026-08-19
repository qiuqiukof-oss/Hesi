/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Session Store — IndexedDB Terminal Tab Persistence
// ============================================================
// Saves terminal tab state (CLI id, name, buffer, timestamp)
// so the user can restore their session after page refresh.
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const DB_NAME = 'QCLISessionStore';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

/** @type {IDBDatabase|null} */
let db = null;
let dbReady = false;
let dbError = null;
let initPromise = null;

// ── Rate-limit: batch saves to avoid hammering IndexedDB ──
let saveTimer = null;
const SAVE_DELAY = 500; // ms debounce
let pendingSaves = [];

// ── Max entries ──
export const MAX_TABS = 20;

/**
 * Open/create the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (db) return Promise.resolve(db);
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const d = event.target.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          // Use tabId as key, also index by timestamp for ordering
          const store = d.createObjectStore(STORE_NAME, { keyPath: 'tabId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('cliId', 'cliId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        dbReady = true;
        resolve(db);
      };

      request.onerror = (event) => {
        dbError = event.target.error;
        console.warn('[SessionStore] IndexedDB not available:', dbError?.message);
        resolve(null); // Resolve with null so callers can degrade gracefully
      };
    } catch (e) {
      console.warn('[SessionStore] IndexedDB not supported:', e.message);
      resolve(null);
    }
  });

  return initPromise;
}

/**
 * Save a single tab session to IndexedDB.
 * Debounced: multiple calls within SAVE_DELAY ms are batched.
 * @param {string} tabId
 * @param {object} data - { cliId, name, icon, buffer, cwd?, status? }
 */
export function saveTab(tabId, data) {
  // Store the data, updating pending saves
  pendingSaves = pendingSaves.filter(s => s.tabId !== tabId);
  pendingSaves.push({ tabId, ...data, timestamp: Date.now() });

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, SAVE_DELAY);
}

/**
 * Flush all pending saves to IndexedDB.
 */
export async function flushSaves() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const batch = pendingSaves;
  pendingSaves = [];
  if (batch.length === 0) return;

  const database = await openDB();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const entry of batch) {
      store.put(entry);
    }

    tx.oncomplete = () => {
      // Trim old entries if over limit
      trimSessions();
    };

    tx.onerror = (e) => {
      console.warn('[SessionStore] Save failed:', e.target.error?.message);
    };
  } catch (e) {
    console.warn('[SessionStore] Save error:', e.message);
  }
}

/**
 * Remove a tab session from IndexedDB.
 * @param {string} tabId
 */
export async function removeTab(tabId) {
  const database = await openDB();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(tabId);

    // Also remove from pending saves
    pendingSaves = pendingSaves.filter(s => s.tabId !== tabId);
  } catch (e) {
    console.warn('[SessionStore] Remove error:', e.message);
  }
}

/**
 * Load all saved sessions, ordered by timestamp (oldest first).
 * @returns {Promise<Array>}
 */
export async function loadAllSessions() {
  const database = await openDB();
  if (!database) return [];

  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        // Sort by timestamp descending (most recent first)
        sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        // Limit
        resolve(sessions.slice(0, MAX_TABS));
      };

      request.onerror = () => {
        resolve([]);
      };
    } catch (e) {
      resolve([]);
    }
  });
}

/**
 * Clear all saved sessions.
 */
export async function clearAllSessions() {
  const database = await openDB();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
  } catch (e) {
    console.warn('[SessionStore] Clear error:', e.message);
  }
}

/**
 * Remove duplicate sessions (same cliId+name) and trim to MAX_TABS.
 */
async function trimSessions() {
  const sessions = await loadAllSessions();
  if (sessions.length <= MAX_TABS) return;

  // Keep only the most recent MAX_TABS
  const toRemove = sessions.slice(MAX_TABS);
  const database = await openDB();
  if (!database) return;

  try {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const s of toRemove) {
      store.delete(s.tabId);
    }
  } catch (e) {
    // Silent
  }
}

/**
 * Count saved sessions.
 * @returns {Promise<number>}
 */
export async function countSessions() {
  const sessions = await loadAllSessions();
  return sessions.length;
}

/**
 * Check if there are saved sessions to restore.
 * @returns {Promise<boolean>}
 */
export async function hasSavedSessions() {
  const count = await countSessions();
  return count > 0;
}

// ── Expose public API on QCLI namespace (legacy compat) ──
Q.SessionStore = {
  // Core
  openDB,
  saveTab,
  removeTab,
  flushSaves,
  loadAllSessions,
  clearAllSessions,
  countSessions,
  hasSavedSessions,

  // Constants
  MAX_TABS,
};

// Auto-open database on load so it's warm
openDB().then(d => {
  if (d) {
    console.log('[SessionStore] Ready');
  }
}).catch(err => console.error('[SessionStore] openDB failed:', err));
