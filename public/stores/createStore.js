/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// createStore — Minimal reactive store factory
//
// Provides getState / setState / subscribe / reset contract
// used by all domain stores. Zero dependencies.
// ============================================================
// @ts-check

/** @typedef {import('../types').Store} Store */

/**
 * @template T
 * @param {T} initialState
 * @returns {Store<T> & {reset: () => void}}
 */
export function createStore(initialState) {
  /** @type {T} */
  let state = { ...initialState };

  /** @type {Set<(state: T) => void>} */
  const listeners = new Set();

  let active = true;

  return {
    /** Return a shallow copy of current state (caller should not mutate) */
    getState: () => state,

    /**
     * Merge a partial state object. Notifies all subscribers synchronously.
     * @param {Partial<T>} partial
     */
    setState: (partial) => {
      if (!active) return;
      const next = { ...state, ...partial };
      // Only notify if something actually changed (shallow check)
      let changed = false;
      for (const key of Object.keys(partial)) {
        if (next[key] !== state[key]) { changed = true; break; }
      }
      state = next;
      if (changed) {
        for (const fn of listeners) {
          try { fn(state); } catch (e) { console.warn('[Store] subscriber error:', e); }
        }
      }
    },

    /**
     * Subscribe to state changes. Returns an unsubscribe function.
     * The subscriber is called immediately with the current state.
     * @param {(state: T) => void} fn
     * @returns {() => void}
     */
    subscribe: (fn) => {
      listeners.add(fn);
      // Immediate call with current state
      try { fn(state); } catch (e) { console.warn('[Store] subscriber error:', e); }
      return () => { listeners.delete(fn); };
    },

    /** Reset state to initial values (useful for testing / hard reset) */
    reset: () => {
      state = { ...initialState };
      for (const fn of listeners) {
        try { fn(state); } catch (e) { console.warn('[Store] subscriber error:', e); }
      }
    },

    /** Destroy the store — clear all listeners */
    destroy: () => {
      active = false;
      listeners.clear();
    },
  };
}
