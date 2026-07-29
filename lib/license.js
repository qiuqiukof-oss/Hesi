/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// License / Capability Gating (B1)
//
// Community vs Commercial capability matrix. Runtime mode is resolved from
// HESI_LICENSE_MODE (env) or data/license.json (activated license).
// Other modules call hasCapability() to decide whether a feature is unlocked.
// ============================================================
const fs = require('fs');
const { LICENSE_MODE, LICENSE_FILE } = require('./config');

const CAPABILITIES = {
  multiAgent:     { community: true,  commercial: true,  label: '多 Agent 圆桌协作' },
  offline:        { community: true,  commercial: true,  label: '离线 / 便携运行' },
  openSource:     { community: true,  commercial: true,  label: '开源核心' },
  audit:          { community: false, commercial: true,  label: '统一审计总线' },
  teamWorkspace:  { community: false, commercial: true,  label: '团队工作区' },
  sso:            { community: false, commercial: true,  label: 'SSO / 企业身份' },
  privateDeploy:  { community: false, commercial: true,  label: '私有部署管控' },
};

function resolveMode() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const lic = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
      if (lic && lic.mode) return lic.mode === 'commercial' ? 'commercial' : 'community';
    }
  } catch { /* ignore */ }
  return LICENSE_MODE === 'commercial' ? 'commercial' : 'community';
}

function hasCapability(name) {
  const cap = CAPABILITIES[name];
  if (!cap) return false;
  return !!cap[resolveMode()];
}

function status() {
  const mode = resolveMode();
  const caps = {};
  for (const [k, v] of Object.entries(CAPABILITIES)) {
    caps[k] = { enabled: !!v[mode], label: v.label };
  }
  return { mode, capabilities: caps };
}

// Minimal activation stub — flips to commercial. A production build would
// verify a signed license key against a license server.
function activate(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') throw new Error('license key required');
  const payload = {
    mode: 'commercial',
    keyHint: `${licenseKey.slice(0, 8)  }…`,
    activatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  return status();
}

module.exports = { CAPABILITIES, resolveMode, hasCapability, status, activate };
