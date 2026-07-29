/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Account Store (A1)
//
// JSON-file backed user directory for enterprise (multi-user) mode.
// Passwords are hashed with scrypt + per-user salt. A simple promise-chain
// mutex serializes writes so concurrent requests can't corrupt the file.
// Falls back gracefully when the file is missing or unreadable.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ACCOUNTS_FILE, BOOTSTRAP_ADMIN_USER, BOOTSTRAP_ADMIN_PASS } = require('../config');

let _cache = null;
let _mutex = Promise.resolve();

function read() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      _cache = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    } else {
      _cache = { users: [], workspaces: [] };
    }
  } catch {
    _cache = { users: [], workspaces: [] };
  }
  if (!Array.isArray(_cache.users)) _cache.users = [];
  if (!Array.isArray(_cache.workspaces)) _cache.workspaces = [];
  return _cache;
}

function persist() {
  _mutex = _mutex.then(() => new Promise((resolve) => {
    try {
      const dir = path.dirname(ACCOUNTS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFile(ACCOUNTS_FILE, JSON.stringify(_cache, null, 2), 'utf-8', () => resolve());
    } catch (e) {
      console.error('[auth] persist failed:', e.message);
      resolve();
    }
  }));
  return _mutex;
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function sanitize(u) {
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, active: u.active };
}

// Create the first admin from env (headless bootstrap) if no users exist.
function ensureBootstrap() {
  const db = read();
  if (db.users.length === 0) {
    if (BOOTSTRAP_ADMIN_USER && BOOTSTRAP_ADMIN_PASS) {
      const { salt, hash } = hashPassword(BOOTSTRAP_ADMIN_PASS);
      db.users.push({
        id: crypto.randomUUID(),
        username: BOOTSTRAP_ADMIN_USER,
        salt, hash, role: 'admin',
        createdAt: new Date().toISOString(), active: true,
      });
      persist();
      console.log(`[auth] Bootstrapped admin account '${BOOTSTRAP_ADMIN_USER}'`);
    } else {
      console.warn('[auth] No accounts exist. Create the first admin via POST /api/auth/bootstrap ' +
        '(local mode) or set HESI_BOOTSTRAP_ADMIN_USER / HESI_BOOTSTRAP_ADMIN_PASS.');
    }
  }
  return db;
}

function findUser(username) {
  return read().users.find((u) => u.username === username) || null;
}

async function createUser({ username, password, role = 'user' }) {
  if (!username || !password) throw new Error('username and password are required');
  const db = read();
  if (db.users.find((u) => u.username === username)) throw new Error('User already exists');
  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(), username, salt, hash,
    role, createdAt: new Date().toISOString(), active: true,
  };
  db.users.push(user);
  await persist();
  return sanitize(user);
}

function authenticate(username, password) {
  const u = findUser(username);
  if (!u || !u.active) return null;
  if (!verifyPassword(password, u.salt, u.hash)) return null;
  return sanitize(u);
}

function listUsers() { return read().users.map(sanitize); }
function getUserById(id) { const u = read().users.find((x) => x.id === id); return u ? sanitize(u) : null; }
function getRawById(id) { return read().users.find((x) => x.id === id) || null; }
function updateRole(id, role) {
  const u = read().users.find((x) => x.id === id);
  if (!u) return null;
  u.role = role;
  persist();
  return sanitize(u);
}
function setActive(id, active) {
  const u = read().users.find((x) => x.id === id);
  if (!u) return null;
  u.active = !!active;
  persist();
  return sanitize(u);
}

module.exports = {
  ensureBootstrap, findUser, createUser, authenticate,
  listUsers, getUserById, getRawById, updateRole, setActive, sanitize,
};
