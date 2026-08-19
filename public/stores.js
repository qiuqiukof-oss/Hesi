/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Local Stores — IndexedDB persistence for:
//   - Command History (cross-tab)
//   - Output Pins (clippings)
//   - Code Snippets (command palette snippets)
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ──────────────────────────────────────────────
// DB Setup
// ──────────────────────────────────────────────
const DB_NAME = 'QCLIStores';
const DB_VERSION = 2;

let db = null;
let dbPromise = null;

function openDB() {
  if (db) return Promise.resolve(db);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const d = event.target.result;
        const tx = event.target.transaction;

        if (!d.objectStoreNames.contains('history')) {
          const store = d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('command', 'command', { unique: false });
          store.createIndex('tabId', 'tabId', { unique: false });
        }

        if (!d.objectStoreNames.contains('pins')) {
          const store = d.createObjectStore('pins', { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        } else if (event.oldVersion < 2) {
          // Migration v1→v2: add titleSearch index for pins
          const store = tx.objectStore('pins');
          if (!store.indexNames.contains('title')) {
            store.createIndex('title', 'title', { unique: false });
          }
        }

        if (!d.objectStoreNames.contains('snippets')) {
          const store = d.createObjectStore('snippets', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });

  return dbPromise;
}

// ──────────────────────────────────────────────
// Command History Store
// ──────────────────────────────────────────────
const HISTORY_MAX = 200;

export const HistoryStore = {
  /** Add a command to history */
  async add(command, tabId, tabName) {
    const d = await openDB();
    if (!d || !command || !command.trim()) return;
      try {
        const tx = d.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        store.add({
          command: command.trim(),
          tabId: tabId || '',
          tabName: tabName || '',
          timestamp: Date.now(),
          favorite: false,
        });
        // Trim old entries on complete
        tx.oncomplete = () => this.trim();
      } catch (e) { console.warn('[HistoryStore] add failed:', e?.message); }
    },

    /** Trim history to max entries */
    async trim() {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('history', 'readonly');
        const store = tx.objectStore('history');
        const index = store.index('timestamp');
        const req = index.getAll();
        req.onsuccess = () => {
          const all = req.result;
          if (all.length <= HISTORY_MAX) return;
          // Keep the most recent HISTORY_MAX entries
          all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const toRemove = all.slice(HISTORY_MAX);
          const tx2 = d.transaction('history', 'readwrite');
          const store2 = tx2.objectStore('history');
          for (const item of toRemove) {
            store2.delete(item.id);
          }
        };
      } catch (e) { console.warn('[HistoryStore] trim failed:', e?.message); }
    },

    /** Search command history */
    async search(query) {
      const d = await openDB();
      if (!d) return [];
      try {
        const tx = d.transaction('history', 'readonly');
        const store = tx.objectStore('history');
        const index = store.index('timestamp');
        return new Promise((resolve) => {
          const req = index.getAll();
          req.onsuccess = () => {
            let results = req.result || [];
            results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            if (query) {
              const q = query.toLowerCase();
              results = results.filter(r =>
                r.command.toLowerCase().includes(q) ||
                (r.tabName && r.tabName.toLowerCase().includes(q))
              );
            }
            resolve(results.slice(0, HISTORY_MAX));
          };
          req.onerror = () => resolve([]);
        });
      } catch (e) { console.warn('[HistoryStore] search failed:', e?.message); return []; }
    },

    /** Toggle favorite status */
    async toggleFavorite(id) {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        const req = store.get(id);
        req.onsuccess = () => {
          const item = req.result;
          if (item) {
            item.favorite = !item.favorite;
            store.put(item);
          }
        };
      } catch (e) { console.warn('[HistoryStore] toggleFavorite failed:', e?.message); }
    },

    /** Get all favorites */
    async getFavorites() {
      const all = await this.search('');
      return all.filter(r => r.favorite);
    },

    /** Clear all history */
    async clear() {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('history', 'readwrite');
        tx.objectStore('history').clear();
      } catch (e) { console.warn('[HistoryStore] clear failed:', e?.message); }
    },
  };

  // ──────────────────────────────────────────────
  // Output Pins Store — upgraded with title, tags, update
  // ──────────────────────────────────────────────
  const PIN_MAX = 100;

  export const PinStore = {
    /** Pin a terminal output snippet */
    async add(text, source, tabName, title) {
      const d = await openDB();
      if (!d || !text) return;
      try {
        const tx = d.transaction('pins', 'readwrite');
        const store = tx.objectStore('pins');
        const id = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        store.add({
          id,
          title: title || '',
          text: text.slice(0, 5000),
          source: source || '',
          tabName: tabName || '',
          tags: [],
          timestamp: Date.now(),
        });
        tx.oncomplete = () => this.trim();
        return id;
      } catch (e) { console.warn('[PinStore] add failed:', e?.message); }
    },

    async trim() {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('pins', 'readonly');
        const index = tx.objectStore('pins').index('timestamp');
        const req = index.getAll();
        req.onsuccess = () => {
          const all = req.result;
          if (all.length <= PIN_MAX) return;
          all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const toRemove = all.slice(PIN_MAX);
          const tx2 = d.transaction('pins', 'readwrite');
          const store2 = tx2.objectStore('pins');
          for (const item of toRemove) store2.delete(item.id);
        };
      } catch (e) { console.warn('[PinStore] trim failed:', e?.message); }
    },

    /** Get all pins */
    async getAll() {
      const d = await openDB();
      if (!d) return [];
      try {
        const tx = d.transaction('pins', 'readonly');
        const index = tx.objectStore('pins').index('timestamp');
        return new Promise((resolve) => {
          const req = index.getAll();
          req.onsuccess = () => {
            const results = req.result || [];
            results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            resolve(results);
          };
          req.onerror = () => resolve([]);
        });
      } catch (e) { console.warn('[PinStore] getAll failed:', e?.message); return []; }
    },

    /** Update a pin (title, tags, etc.) */
    async update(id, changes) {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('pins', 'readwrite');
        const store = tx.objectStore('pins');
        const req = store.get(id);
        req.onsuccess = () => {
          const item = req.result;
          if (item) {
            if (changes.title !== undefined) item.title = changes.title;
            if (changes.tags !== undefined) item.tags = changes.tags;
            if (changes.text !== undefined) item.text = changes.text;
            if (changes.source !== undefined) item.source = changes.source;
            store.put(item);
          }
        };
      } catch (e) { console.warn('[PinStore] update failed:', e?.message); }
    },

    /** Remove a pin */
    async remove(id) {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('pins', 'readwrite');
        tx.objectStore('pins').delete(id);
      } catch (e) { console.warn('[PinStore] remove failed:', e?.message); }
    },

    /** Clear all pins */
    async clear() {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('pins', 'readwrite');
        tx.objectStore('pins').clear();
      } catch (e) { console.warn('[PinStore] clear failed:', e?.message); }
    },
  };

  // ──────────────────────────────────────────────
  // Snippet Store
  // ──────────────────────────────────────────────
  export const SnippetStore = {
    /** Add a snippet */
    async add(name, command, description) {
      const d = await openDB();
      if (!d || !name || !command) return;
      try {
        const tx = d.transaction('snippets', 'readwrite');
        tx.objectStore('snippets').add({
          name: name.trim(),
          command: command.trim(),
          description: (description || '').trim(),
          timestamp: Date.now(),
        });
      } catch (e) { console.warn('[SnippetStore] add failed:', e?.message); }
    },

    /** Update a snippet */
    async update(id, data) {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('snippets', 'readwrite');
        const store = tx.objectStore('snippets');
        const req = store.get(id);
        req.onsuccess = () => {
          const item = req.result;
          if (item) {
            if (data.name !== undefined) item.name = data.name;
            if (data.command !== undefined) item.command = data.command;
            if (data.description !== undefined) item.description = data.description;
            store.put(item);
          }
        };
      } catch (e) { console.warn('[SnippetStore] update failed:', e?.message); }
    },

    /** Get all snippets */
    async getAll() {
      const d = await openDB();
      if (!d) return [];
      try {
        const tx = d.transaction('snippets', 'readonly');
        const store = tx.objectStore('snippets');
        const index = store.index('name');
        return new Promise((resolve) => {
          const req = index.getAll();
          req.onsuccess = () => {
            const results = req.result || [];
            results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            resolve(results);
          };
          req.onerror = () => resolve([]);
        });
      } catch (e) { console.warn('[SnippetStore] getAll failed:', e?.message); return []; }
    },

    /** Search snippets */
    async search(query) {
      const all = await this.getAll();
      if (!query) return all;
      const q = query.toLowerCase();
      return all.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
      );
    },

    /** Remove a snippet */
    async remove(id) {
      const d = await openDB();
      if (!d) return;
      try {
        const tx = d.transaction('snippets', 'readwrite');
        tx.objectStore('snippets').delete(id);
      } catch (e) { console.warn('[SnippetStore] remove failed:', e?.message); }
    },
  };

  // ──────────────────────────────────────────────
  // Legacy compat (window.QCLI)
  // ──────────────────────────────────────────────
  Q.HistoryStore = HistoryStore;
  Q.PinStore = PinStore;
  Q.SnippetStore = SnippetStore;

  // Warm up DB
  openDB().then(d => {
    if (d) console.log('[Stores] Ready');
  }).catch(err => console.error('[Store] openDB failed:', err));
