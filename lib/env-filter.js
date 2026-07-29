/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// env-filter — shared sensitive environment variable patterns
//
// Centralised so both ws-handler.js (PTY sessions) and
// ws/pty.js (headless PTY for agents/workflows) use the
// same filter patterns. Prevents credential leaks to sub‑processes.
// ============================================================

/** @type {RegExp[]} 26 patterns covering major cloud provider credentials */
const SENSITIVE_VAR_PATTERNS = [
  /^API_KEY/i, /^API_SECRET/i, /^ACCESS_KEY/i, /^SECRET_KEY/i,
  /^TOKEN/i, /^PASSWORD/i, /^PASSWD/i, /^CREDENTIAL/i,
  /^AUTH/i, /^SESSION/i, /^COOKIE/i, /^BEARER/i,
  /^PRIVATE_KEY/i, /^SSH_KEY/i, /^PGP_KEY/i, /^GPG_KEY/i,
  /^AWS_SECRET/i, /^AWS_SESSION_TOKEN/i, /^TF_VAR/i,
  /^DB_PASSWORD/i, /^DB_URL/i, /^DATABASE_URL/i,
  /^REDIS_URL/i, /^MONGODB_URI/i, /^MONGO_URI/i,
  /^NPM_TOKEN/i, /^GITHUB_TOKEN/i, /^GH_TOKEN/i,
  /^SLACK_TOKEN/i, /^DISCORD_TOKEN/i, /^TELEGRAM/i,
  /^OPENAI_API_KEY/i, /^ANTHROPIC_API_KEY/i,
  /^CODEX_API_KEY/i, /^CLAUDE_API_KEY/i,
  /^JWT/i, /^SECRET/i,
];

/**
 * Filter process.env to remove sensitive entries.
 * Returns a new plain object containing only non‑sensitive variables.
 * @param {object} env - Environment object (typically process.env)
 * @returns {object} Safe environment object
 */
function filterSensitiveEnv(env) {
  const safe = {};
  for (const [key, value] of Object.entries(env)) {
    const isSensitive = SENSITIVE_VAR_PATTERNS.some(pattern => pattern.test(key));
    if (!isSensitive) {
      safe[key] = value;
    }
  }
  return safe;
}

module.exports = { SENSITIVE_VAR_PATTERNS, filterSensitiveEnv };
