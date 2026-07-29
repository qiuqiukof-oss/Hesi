/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Hesi Platform Config — central env wiring for enterprise features
//
// This module is the single place new product-config env vars are read.
// It is intentionally independent from mcp/config.js (which serves the MCP
// subprocess). No external dependencies — pure Node.
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
  catch { /* ignore */ }
}

// ── AUTH_MODE ──
// 'local'      → personal / single-token mode (default, mirrors legacy behavior)
// 'enterprise' → multi-user accounts enforced (A1)
const AUTH_MODE = (process.env.AUTH_MODE || 'local').toLowerCase();

// ── SESSION_SECRET ──
// Signs stateless session tokens. Persisted to a 0600 file so tokens survive
// restarts; generated on first run if unset.
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  const secretFile = path.join(DATA_DIR, '.session-secret');
  try {
    if (fs.existsSync(secretFile)) {
      SESSION_SECRET = fs.readFileSync(secretFile, 'utf-8').trim();
    } else {
      ensureDataDir();
      SESSION_SECRET = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, SESSION_SECRET, { mode: 0o600 });
    }
  } catch {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  }
}

const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 90;
const TELEMETRY_OPT_IN = process.env.TELEMETRY_OPT_IN === '1';

// Audit log path (append-only JSONL). Falls back to data/audit.jsonl.
const AUDIT_LOG = process.env.QCLI_AUDIT_LOG || path.join(DATA_DIR, 'audit.jsonl');

// License / capability gating (B1)
const LICENSE_MODE = (process.env.HESI_LICENSE_MODE || 'community').toLowerCase();
const LICENSE_FILE = path.join(DATA_DIR, 'license.json');

// Account store (A1)
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Telemetry aggregate store (C1)
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.json');

// First-run bootstrap admin (set via env for headless setup)
const BOOTSTRAP_ADMIN_USER = process.env.HESI_BOOTSTRAP_ADMIN_USER || '';
const BOOTSTRAP_ADMIN_PASS = process.env.HESI_BOOTSTRAP_ADMIN_PASS || '';

module.exports = {
  DATA_DIR,
  AUTH_MODE,
  isEnterprise: AUTH_MODE === 'enterprise',
  SESSION_SECRET,
  AUDIT_RETENTION_DAYS,
  TELEMETRY_OPT_IN,
  AUDIT_LOG,
  LICENSE_MODE,
  LICENSE_FILE,
  ACCOUNTS_FILE,
  TELEMETRY_FILE,
  BOOTSTRAP_ADMIN_USER,
  BOOTSTRAP_ADMIN_PASS,
};
