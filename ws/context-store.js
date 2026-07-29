/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Context Store — in-memory shared context bus for AI agents
//
// Enables structured data sharing across agent sessions and
// workflow steps. Agents can publish analysis results and
// other agents can consume them without re-running work.
//
// Features:
//   - TTL-based automatic expiry
//   - Tag-based & type-based queries
//   - Reactive subscriptions (pub/sub)
//   - Automatic LRU eviction when over capacity
//   - Stats for monitoring
// ============================================================

const DEFAULT_TTL = 300_000;       // 5 minutes
const MAX_ENTRIES = 1000;           // soft cap; oldest evicted first
const CLEANUP_INTERVAL_MS = 60_000; // periodic stale-sweep interval

/**
 * Create a shared Context Store instance.
 *
 * @param {object} [opts]
 * @param {number} [opts.defaultTTL=300000]       — default TTL in ms (0 = no expiry)
 * @param {number} [opts.maxEntries=1000]          — max entries before eviction
 * @param {number} [opts.cleanupInterval=60000]    — periodic cleanup interval (0 = disable)
 * @returns {ContextStore}
 */
function createContextStore(opts = {}) {
  const defaultTTL = opts.defaultTTL !== undefined ? opts.defaultTTL : DEFAULT_TTL;
  const maxEntries = opts.maxEntries || MAX_ENTRIES;
  const cleanupInterval = opts.cleanupInterval !== undefined ? opts.cleanupInterval : CLEANUP_INTERVAL_MS;

  /** @type {Map<string, Entry>} key → entry */
  const _store = new Map();

  /** @type {Map<string, Set<Function>>} keyPrefix → subscribers */
  const _subscribers = new Map();

  /** @type {number|null} cleanup timer handle */
  let _cleanupTimer = null;

  // ──── Entry structure ────
  //
  //   {
  //     key,         // string
  //     value,       // any
  //     tags,        // string[]
  //     type,        // string (e.g. 'analysis', 'file_tree', 'agent:output')
  //     source,      // string | null (agentId, sessionId, etc.)
  //     timestamp,   // number (Date.now())
  //     ttl,         // number (ms; 0 = no expiry)
  //   }

  // ──────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────

  /** Check if an entry has expired */
  function _isExpired(entry) {
    return entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl;
  }

  /** Notify subscribers whose pattern matches the key */
  function _notify(key, entry) {
    for (const [pattern, callbacks] of _subscribers) {
      // pattern matching: exact match OR prefix match (keyPrefix subscribers)
      const matches = key === pattern || key.startsWith(pattern);
      if (!matches) continue;
      for (const cb of callbacks) {
        try { cb(entry, store); } catch (e) {
          console.error('[ContextStore] Subscriber error:', e);
        }
      }
    }
  }

  /** Evict expired + oldest entries when over capacity */
  function _evictIfNeeded() {
    if (_store.size <= maxEntries) return;

    // 1. Remove all expired entries
    for (const [key, entry] of _store) {
      if (_isExpired(entry)) _store.delete(key);
    }

    // 2. If still over limit, remove oldest entries
    if (_store.size > maxEntries) {
      const sorted = [..._store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const excess = _store.size - maxEntries;
      for (let i = 0; i < excess; i++) {
        _store.delete(sorted[i][0]);
      }
    }
  }

  /** Periodic cleanup sweep */
  function _sweepExpired() {
    for (const [key, entry] of _store) {
      if (_isExpired(entry)) _store.delete(key);
    }
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  const store = {

    /**
     * Set a value in the context store.
     *
     * @param {string} key           — unique key
     * @param {any}    value         — any JSON-serializable value
     * @param {object} [opts]
     * @param {number} [opts.ttl]    — TTL in ms (defaults to store defaultTTL; 0 = no expiry)
     * @param {string[]} [opts.tags] — tags for filtered queries
     * @param {string} [opts.type]   — semantic type for getLatestByType
     * @param {string} [opts.source] — who published this (agentId, sessionId, etc.)
     * @returns {object} the stored entry
     */
    set(key, value, opts = {}) {
      const ttl = opts.ttl !== undefined ? opts.ttl : defaultTTL;
      const entry = {
        key,
        value,
        tags: opts.tags || [],
        type: opts.type || 'general',
        source: opts.source || null,
        timestamp: Date.now(),
        ttl,
      };
      _store.set(key, entry);
      _evictIfNeeded();
      _notify(key, entry);
      return entry;
    },

    /**
     * Get a value by key.
     * Returns null if key not found or entry has expired.
     *
     * @param {string} key
     * @returns {object|null} entry or null
     */
    get(key) {
      const entry = _store.get(key);
      if (!entry) return null;
      if (_isExpired(entry)) {
        _store.delete(key);
        return null;
      }
      return entry;
    },

    /**
     * Delete a specific key.
     *
     * @param {string} key
     * @returns {boolean} true if deleted
     */
    delete(key) {
      return _store.delete(key);
    },

    /**
     * Find all non-expired entries that have a specific tag.
     *
     * @param {string} tag
     * @returns {object[]} matching entries
     */
    findByTag(tag) {
      const results = [];
      for (const entry of _store.values()) {
        if (_isExpired(entry)) {
          _store.delete(entry.key);
          continue;
        }
        if (entry.tags.includes(tag)) results.push(entry);
      }
      return results;
    },

    /**
     * Get the latest non-expired entry of a given type.
     *
     * @param {string} type
     * @returns {object|null} the latest entry, or null
     */
    getLatestByType(type) {
      let latest = null;
      for (const entry of _store.values()) {
        if (_isExpired(entry)) {
          _store.delete(entry.key);
          continue;
        }
        if (entry.type === type && (!latest || entry.timestamp >= latest.timestamp)) {
          latest = entry;
        }
      }
      return latest;
    },

    /**
     * Get all non-expired entries of a given type.
     *
     * @param {string} type
     * @returns {object[]} matching entries
     */
    getAllByType(type) {
      const results = [];
      for (const entry of _store.values()) {
        if (_isExpired(entry)) {
          _store.delete(entry.key);
          continue;
        }
        if (entry.type === type) results.push(entry);
      }
      return results;
    },

    /**
     * Publish an agent result. Shortcut for set() with automatic
     * key generation and consistent tagging.
     *
     * @param {string} sourceId       — agentId or sessionId
     * @param {any}    data           — the result value
     * @param {object} [opts]
     * @param {string[]} [opts.tags]  — additional tags
     * @param {string} [opts.type]    — defaults to 'agent:output'
     * @param {number} [opts.ttl]     — override default TTL
     * @returns {object} the stored entry
     */
    publish(sourceId, data, opts = {}) {
      const key = `ctx:${sourceId}:${Date.now()}`;
      const tags = ['published', `source:${sourceId}`, ...(opts.tags || [])];
      return store.set(key, data, {
        tags,
        type: opts.type || 'agent:output',
        source: sourceId,
        ttl: opts.ttl,
      });
    },

    /**
     * Query entries by an arbitrary filter function.
     *
     * @param {function(object):boolean} fn — filter(entry) → true to include
     * @returns {object[]} matching non-expired entries
     */
    query(fn) {
      const results = [];
      for (const entry of _store.values()) {
        if (_isExpired(entry)) {
          _store.delete(entry.key);
          continue;
        }
        if (fn(entry)) results.push(entry);
      }
      return results;
    },

    /**
     * Subscribe to context changes matching a key pattern.
     *
     * @param {string}   pattern  — key prefix or substring to match
     * @param {Function} callback — (entry, store) => void
     * @returns {Function}        — unsubscribe function
     */
    subscribe(pattern, callback) {
      if (!_subscribers.has(pattern)) {
        _subscribers.set(pattern, new Set());
      }
      _subscribers.get(pattern).add(callback);
      return function unsubscribe() {
        const callbacks = _subscribers.get(pattern);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) _subscribers.delete(pattern);
        }
      };
    },

    /**
     * Create a snapshot of all non-expired entries (for debugging / reporting).
     *
     * @returns {object[]} array of all current entries
     */
    snapshot() {
      const results = [];
      for (const entry of _store.values()) {
        if (_isExpired(entry)) {
          _store.delete(entry.key);
          continue;
        }
        results.push({ ...entry }); // shallow copy
      }
      return results;
    },

    /**
     * Clear all entries and subscribers.
     */
    clear() {
      _store.clear();
      _subscribers.clear();
    },

    /**
     * Manually trigger expired-entry cleanup.
     */
    cleanup() {
      _sweepExpired();
    },

    /**
     * Start periodic background cleanup.
     */
    startCleanup() {
      if (_cleanupTimer) return;
      if (cleanupInterval > 0) {
        _cleanupTimer = setInterval(_sweepExpired, cleanupInterval);
        _cleanupTimer.unref(); // don't prevent process exit
      }
    },

    /**
     * Stop periodic background cleanup.
     */
    stopCleanup() {
      if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
      }
    },

    /**
     * Current store statistics.
     *
     * @returns {{ entries: number, subscribers: number }}
     */
    get stats() {
      store.cleanup();
      const subCount = [..._subscribers.values()].reduce((sum, s) => sum + s.size, 0);
      return {
        entries: _store.size,
        subscribers: subCount,
        maxEntries,
        defaultTTL,
      };
    },
  };

  // Auto-start cleanup if interval is set
  if (cleanupInterval > 0) store.startCleanup();

  return store;
}

module.exports = { createContextStore };
