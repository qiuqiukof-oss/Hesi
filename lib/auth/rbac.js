/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Role-Based Access Control (A1)
//
// Three roles: admin > user > viewer. Permissions are capability strings
// checked via can(role, permission). 'admin' implicitly has every permission.
// ============================================================
const ROLE_PERMISSIONS = {
  admin: [
    'admin:all', 'audit:read', 'audit:export', 'users:read', 'users:write',
    'config:read', 'config:write', 'sessions:read', 'sessions:control',
    'workspaces:read', 'workspaces:write', 'license:read', 'metrics:read',
  ],
  user: [
    'sessions:read', 'sessions:control', 'workspaces:read', 'workspaces:write',
    'metrics:read', 'license:read', 'config:read',
  ],
  viewer: [
    'sessions:read', 'workspaces:read', 'metrics:read', 'license:read',
    'audit:read', 'config:read',
  ],
};

const ROLES = ['admin', 'user', 'viewer'];

function can(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('admin:all') || perms.includes(permission);
}

function normalizeRole(role) {
  return ROLES.includes(role) ? role : 'viewer';
}

module.exports = { ROLES, ROLE_PERMISSIONS, can, normalizeRole };
