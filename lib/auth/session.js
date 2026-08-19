/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Session Management (A1)
//
// Stateless, HMAC-signed session tokens (no express-session dependency).
// A token is `<base64url(payload)>.<base64url(hmac)>`. Express middleware
// extracts the token (Bearer header / cookie / query) and resolves req.user.
//
// Mode behavior:
//   - local (default): personal mode → full admin access, no login required.
//   - enterprise:      multi-user accounts enforced; valid session required.
//   - QCLI_ACCESS_TOKEN (legacy single token) still grants admin in either mode.
// ============================================================
const crypto = require('crypto');
const { SESSION_SECRET, AUTH_MODE } = require('../config');
const rbac = require('./rbac');

function sign(body) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
}

function createSession(user, ttlMs = 7 * 24 * 3600 * 1000) {
  const iat = Date.now();
  const payload = {
    sub: user.id, username: user.username, role: user.role,
    iat, exp: iat + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let expected;
  try { expected = sign(body); } catch { return null; }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')); }
  catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

function extractToken(req) {
  const auth = req.headers && req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  if (req.cookies && req.cookies.hesi_session) return req.cookies.hesi_session;
  if (req.query && typeof req.query.session === 'string') return req.query.session;
  return '';
}

// Resolve req.user. Never throws — delegates to next() with an appropriate identity.
function requireAuth(req, res, next) {
  const token = extractToken(req);

  // 1) Valid session token from our own auth system
  if (token) {
    const p = verifyToken(token);
    if (p) {
      req.user = { id: p.sub, username: p.username, role: p.role };
      req.isAuthed = true;
      return next();
    }
  }

  // 2) Legacy single access token (personal deploy)
  const legacy = process.env.QCLI_ACCESS_TOKEN;
  if (legacy && token === legacy) {
    req.user = { id: 'local', username: 'local', role: 'admin' };
    req.isAuthed = true;
    return next();
  }

  // 3) Local / personal mode → treat as admin (full access, no login needed)
  if (AUTH_MODE !== 'enterprise') {
    req.user = { id: 'local', username: 'local', role: 'admin' };
    req.isAuthed = false;
    return next();
  }

  // 4) Enterprise mode with no valid session → 401
  return res.status(401).json({ error: 'Authentication required' });
}

// Role/capability gate. In local mode every action is permitted.
function requireRole(permission) {
  return (req, res, next) => {
    if (AUTH_MODE !== 'enterprise') return next(); // personal mode = full access
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (rbac.can(req.user.role, permission) || req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { createSession, verifyToken, extractToken, requireAuth, requireRole };
