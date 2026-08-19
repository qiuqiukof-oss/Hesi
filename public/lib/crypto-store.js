/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// CryptoStore — Web Crypto API 加密存储（防 XSS / 同域脚本读取）
//
// 用法：
//   const ok = await CryptoStore.ready();        // 初始化（幂等）
//   const ct = await CryptoStore.encrypt(key);   // 明文 → 密文（base64）
//   const pt = await CryptoStore.decrypt(ct);    // 密文 → 明文
//
// 密钥派生：用 crypto.subtle.generateKey 生成 non-exportable AES-GCM
// CryptoKey，存于 IndexedDB。该密钥本身无法被 JS 读出原始字节，
// 因此即使 XSS 拿到 localStorage 密文也无法解密（缺 CryptoKey 句柄）。
// ============================================================
'use strict';

const DB_NAME = 'qcli-crypto';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'aes-gcm-key';
const ALGO = { name: 'AES-GCM', length: 256 };

/** @type {CryptoKey|null} */
let _key = null;
let _readyPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE_NAME); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredKey(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function storeKey(db, raw) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(raw, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function initKey() {
  if (_key) return _key;
  const db = await openDB();
  let raw = await getStoredKey(db);
  if (raw) {
    _key = raw;
  } else {
    _key = await crypto.subtle.generateKey(ALGO, false /* non-exportable */, ['encrypt', 'decrypt']);
    await storeKey(db, _key);
  }
  return _key;
}

/**
 * 确保 CryptoStore 就绪（幂等）。在首次 setApiKey 前调用。
 * @returns {Promise<boolean>} true=就绪 / false=浏览器不支持
 */
async function ready() {
  if (!crypto || !crypto.subtle || !indexedDB) return false;
  if (_readyPromise) return _readyPromise;
  _readyPromise = initKey().then(() => true).catch(() => false);
  return _readyPromise;
}

/**
 * 加密明文 → base64 密文（含 12-byte IV 前缀）。
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
async function encrypt(plaintext) {
  if (!_key) throw new Error('CryptoStore not ready — call ready() first');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _key, enc);
  // 格式：iv (12B) + ciphertext (变长)
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...buf));
}

/**
 * 解密 base64 密文 → 明文。
 * @param {string} ciphertext
 * @returns {Promise<string>}
 */
async function decrypt(ciphertext) {
  if (!_key) throw new Error('CryptoStore not ready — call ready() first');
  const buf = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _key, ct);
  return new TextDecoder().decode(dec);
}

export const CryptoStore = { ready, encrypt, decrypt };
