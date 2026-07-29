/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Safe Storage — unified Web Storage wrapper with error handling
//
// Replaces ad-hoc try/catch { /* ignore */ } patterns throughout
// the codebase with a consistent, logged approach.
//
// Two backends are exposed:
//   safeStorage  → localStorage   (persistent prefs: theme, provider, ...)
//   safeSession  → sessionStorage (secrets / per-tab: e.g. AI API key)
//
// Usage:
//   import { safeStorage, safeSession } from './lib/storage.js';
//   const val = safeStorage.get('my-key', 'default');
//   safeStorage.set('my-key', 'value');
//   const key = safeSession.get('secret', '');
// ============================================================

const MODULE = '[Storage]';

/**
 * Build a safe wrapper around a Web Storage backend (localStorage /
 * sessionStorage). The backend is resolved lazily on each call so the module
 * can be imported in non-browser contexts (Node unit tests) without throwing.
 *
 * @param {() => Storage} getBackend — returns the underlying Storage object
 * @param {string} label — short name used in warning logs
 */
function makeSafeStore(getBackend, label) {
  return {
    /**
     * Get an item with a fallback.
     * @param {string} key
     * @param {*} [fallback=null]
     * @returns {string|null}
     */
    get(key, fallback = null) {
      try {
        const val = getBackend().getItem(key);
        return val !== null ? val : fallback;
      } catch (e) {
        console.warn(MODULE, `${label}.get("${key}") failed:`, e?.message);
        return fallback;
      }
    },

    /**
     * Set an item.
     * @param {string} key
     * @param {*} value — will be converted to String
     * @returns {boolean} true on success
     */
    set(key, value) {
      try {
        getBackend().setItem(key, String(value));
        return true;
      } catch (e) {
        console.warn(MODULE, `${label}.set("${key}") failed:`, e?.message);
        return false;
      }
    },

    /**
     * Remove an item.
     * @param {string} key
     * @returns {boolean} true on success
     */
    remove(key) {
      try {
        getBackend().removeItem(key);
        return true;
      } catch (e) {
        console.warn(MODULE, `${label}.remove("${key}") failed:`, e?.message);
        return false;
      }
    },

    /**
     * Get and parse JSON.
     * @param {string} key
     * @param {*} [fallback=null]
     * @returns {*}
     */
    getJSON(key, fallback = null) {
      try {
        const raw = getBackend().getItem(key);
        return raw !== null ? JSON.parse(raw) : fallback;
      } catch (e) {
        console.warn(MODULE, `${label}.getJSON("${key}") failed:`, e?.message);
        return fallback;
      }
    },

    /**
     * Store a JSON-serializable value.
     * @param {string} key
     * @param {*} value — must be JSON-serializable
     * @returns {boolean} true on success
     */
    setJSON(key, value) {
      try {
        getBackend().setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn(MODULE, `${label}.setJSON("${key}") failed:`, e?.message);
        return false;
      }
    },

    /**
     * Get all keys that start with a given prefix.
     * @param {string} [prefix='']
     * @returns {string[]}
     */
    keys(prefix = '') {
      try {
        const store = getBackend();
        const keys = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k && (!prefix || k.startsWith(prefix))) {
            keys.push(k);
          }
        }
        return keys;
      } catch (e) {
        console.warn(MODULE, `${label}.keys("${prefix}") failed:`, e?.message);
        return [];
      }
    },
  };
}

/**
 * Persistent storage (localStorage) — for non-secret preferences.
 * @type {ReturnType<typeof makeSafeStore>}
 */
export const safeStorage = makeSafeStore(() => localStorage, 'local');

/**
 * Per-tab storage (sessionStorage) — for secrets like the AI API key.
 * Cleared automatically when the tab/browser closes, so credentials are not
 * left persisted on disk indefinitely.
 * @type {ReturnType<typeof makeSafeStore>}
 */
export const safeSession = makeSafeStore(() => sessionStorage, 'session');

// Legacy global export for non-ESM code.
// Guarded so this module can be imported in non-browser contexts (e.g. Node
// unit tests) without throwing "window is not defined".
if (typeof window !== 'undefined') {
  const Q = /** @type {import('../types').QCLI} */ (window.QCLI = window.QCLI || {});
  Q.safeStorage = safeStorage;
  Q.safeSession = safeSession;
}
