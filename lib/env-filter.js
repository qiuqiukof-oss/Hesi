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

/**
 * @type {RegExp[]} Sensitive variable patterns
 *
 * 段边界匹配（非 `^` 锚定）：变量名按 `_` 分段，任一敏感段即命中。
 * - 覆盖前缀式命名：OPENAI_API_KEY、QCLI_ACCESS_TOKEN、MY_SESSION_COOKIE ✓
 * - 不误伤无害变量：TOKENIZERS_PARALLELISM（TOKEN 后跟 I 非边界）✓
 * - 保留全名保险层：已知连接串/密钥变量名显式列出
 */
const SENSITIVE_VAR_PATTERNS = [
  // 凭据类段：API key / access / secret key / token
  /(^|_)(API[_-]?KEY|API[_-]?SECRET|ACCESS[_-]?KEY|ACCESS[_-]?TOKEN|SECRET[_-]?KEY|SECRET[_-]?TOKEN)(_|$)/i,
  // 通用敏感词段
  /(^|_)(TOKEN|PASSWORD|PASSWD|CREDENTIALS?|AUTH|SESSION|COOKIE|BEARER|JWT|SECRET|PRIVATE[_-]?KEY|SSH[_-]?KEY|PGP[_-]?KEY|GPG[_-]?KEY)(_|$)/i,
  // 连接串 / 已知全名保险层
  /(^|_)(DB_URL|DATABASE_URL|REDIS_URL|MONGODB_URI|MONGO_URI|AWS_SECRET|AWS_SESSION_TOKEN|TF_VAR|NPM_TOKEN|GITHUB_TOKEN|GH_TOKEN|SLACK_TOKEN|DISCORD_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|CODEX_API_KEY|CLAUDE_API_KEY)(_|$)/i,
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
