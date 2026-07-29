/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Finance Store — IndexedDB persistence layer
// Stores: budgets, settlements, assets, dcaPlans
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const DB_NAME = 'QCLI_FinanceDB';
const DB_VERSION = 1;
const STORES = ['budgets', 'settlements', 'assets', 'dcaPlans'];

let _db = null;

function openDB() {
  return new Promise(function (resolve, reject) {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      STORES.forEach(function (name) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = function (e) {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = function (e) {
      reject(e.target.error);
    };
  });
}

function getStore(name, mode) {
  return openDB().then(function (db) {
    const tx = db.transaction(name, mode || 'readonly');
    return tx.objectStore(name);
  });
}

const FinanceStore = {
  // ── Read all ──
  loadAll: function (storeName) {
    return getStore(storeName).then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  // ── Get by ID ──
  getById: function (storeName, id) {
    return getStore(storeName).then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  // ── Add ──
  add: function (storeName, item) {
    if (!item.id) item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    return getStore(storeName, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.add(item);
        req.onsuccess = function () { resolve(item); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  // ── Update ──
  update: function (storeName, id, changes) {
    return this.getById(storeName, id).then(function (existing) {
      if (!existing) throw new Error('Not found: ' + id);
      Object.assign(existing, changes);
      existing.updatedAt = new Date().toISOString();
      return getStore(storeName, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          const req = store.put(existing);
          req.onsuccess = function () { resolve(existing); };
          req.onerror = function () { reject(req.error); };
        });
      });
    });
  },

  // ── Delete ──
  remove: function (storeName, id) {
    return getStore(storeName, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.delete(id);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  // ── Clear store ──
  clear: function (storeName) {
    return getStore(storeName, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.clear();
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  // ── Query by index ──
  queryByIndex: function (storeName, indexName, value) {
    return openDB().then(function (db) {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      return new Promise(function (resolve, reject) {
        const req = index.getAll(value);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },
};

Q.FinanceStore = FinanceStore;
