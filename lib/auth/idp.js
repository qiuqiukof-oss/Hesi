// ============================================================
// SSO / Identity Provider Abstraction (B4)
//
// Pluggable OIDC-style providers for enterprise identity: 企业微信 (wecom),
// 飞书 (feishu), Okta. This is a STUB interface — the authorization-code
// flow scaffolding is here; real token exchange + account upsert is wired
// when an enterprise connects their tenant.
// ============================================================
const crypto = require('crypto');

const PROVIDERS = {
  wecom:  { name: '企业微信', authUrl: '', tokenUrl: '', userInfoUrl: '', clientId: '', scope: 'snsapi_base' },
  feishu: { name: '飞书',     authUrl: '', tokenUrl: '', userInfoUrl: '', clientId: '', scope: 'openid' },
  okta:   { name: 'Okta',     authUrl: '', tokenUrl: '', userInfoUrl: '', clientId: '', scope: 'openid email' },
};

function getProvider(id) { return PROVIDERS[id] || null; }

function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, configured: !!p.authUrl }));
}

// Begin an authorization-code flow. Returns the provider's authorize URL.
function beginAuth(providerId, redirectUri) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${  providerId}`);
  if (!p.authUrl) {
    return { configured: false, hint: `Set ${providerId} OIDC endpoints in lib/auth/idp.js to enable SSO` };
  }
  const state = crypto.randomBytes(16).toString('hex');
  const url = `${p.authUrl}?client_id=${encodeURIComponent(p.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(p.scope)}&state=${state}`;
  return { configured: true, url, state };
}

// Exchange code for tokens + map to a Hesi account (stub).
async function handleCallback(providerId, code) {
  const p = getProvider(providerId);
  if (!p) throw new Error(`Unknown provider: ${  providerId}`);
  if (!p.tokenUrl) {
    return { configured: false, hint: `Set ${providerId} token/userinfo endpoints to complete SSO` };
  }
  // Real implementation: POST code→token, GET userInfo, upsert account,
  // then return a Hesi session user. Left as a hook for enterprise onboarding.
  return { configured: true, stub: true, note: 'SSO token exchange not yet implemented; see lib/auth/idp.js' };
}

module.exports = { PROVIDERS, getProvider, listProviders, beginAuth, handleCallback };
