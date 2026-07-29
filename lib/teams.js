/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Team Workspaces (B2) — foundational data model + API surface
//
// Workspaces group users and own PTY sessions. Full cross-WS permission
// enforcement is incremental; this module provides the store, the API
// (create / list / members), and the ownership tagging used by the audit
// bus and (later) the terminal layer.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ACCOUNTS_FILE, DATA_DIR } = require('./config');

function db() {
  let raw;
  try {
    raw = fs.existsSync(ACCOUNTS_FILE)
      ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
      : { users: [], workspaces: [] };
  } catch { raw = { users: [], workspaces: [] }; }
  if (!Array.isArray(raw.workspaces)) raw.workspaces = [];
  return raw;
}

function save(raw) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(raw, null, 2), 'utf-8');
  } catch (e) { console.error('[teams] save failed:', e.message); }
}

function createWorkspace({ name, ownerId }) {
  if (!name) throw new Error('workspace name required');
  const raw = db();
  if (raw.workspaces.find((w) => w.name === name)) throw new Error('Workspace name exists');
  const ws = {
    id: crypto.randomUUID(),
    name,
    ownerId: ownerId || null,
    members: ownerId ? [ownerId] : [],
    createdAt: new Date().toISOString(),
  };
  raw.workspaces.push(ws);
  save(raw);
  return ws;
}

function getWorkspace(id) { return db().workspaces.find((w) => w.id === id) || null; }

function listWorkspacesForUser(userId) {
  if (!userId) return [];
  return db().workspaces.filter((w) => w.members.includes(userId));
}

function addMember(workspaceId, userId) {
  const raw = db();
  const w = raw.workspaces.find((x) => x.id === workspaceId);
  if (!w) throw new Error('Workspace not found');
  if (!w.members.includes(userId)) w.members.push(userId);
  save(raw);
  return w;
}

function removeMember(workspaceId, userId) {
  const raw = db();
  const w = raw.workspaces.find((x) => x.id === workspaceId);
  if (!w) throw new Error('Workspace not found');
  w.members = w.members.filter((m) => m !== userId);
  save(raw);
  return w;
}

module.exports = { createWorkspace, getWorkspace, listWorkspacesForUser, addMember, removeMember };
