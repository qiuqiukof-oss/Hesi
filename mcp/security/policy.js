// ============================================================
// Policy — command and filesystem security policy engine
//
// Loads optional .cli-q-policy.json from project root or
// QCLI_POLICY_PATH. Provides:
// - Command allowlist/blocklist
// - Filesystem path sandbox
// - Session limits
// ============================================================
const fs = require("fs");
const path = require("path");
const config = require("../config");

// ── Default policy ──
// SECURITY: the engine defaults to `blocklist` mode with a curated set of
// destructive commands. Previously the default was `permissive` (allow-all),
// which meant the policy layer was effectively a no-op unless an operator
// hand-wrote a policy file. Now a fresh install blocks the most dangerous
// operations out of the box; operators can still opt into `permissive` or
// `allowlist` mode (or trim the blocklist) via .cli-q-policy.json.
//
// Blocklist entries are matched two ways:
//   1. Plain token  -> exact command name, or `command.startsWith(entry + ' ')`
//   2. /regex/ form -> `new RegExp(inner, 'i').test(command)` (substring match)
const DEFAULT_POLICY = {
  commands: {
    allowlist: [],
    blocklist: [
      // Disk / partition destruction
      'mkfs', 'mkfs.ext2', 'mkfs.ext3', 'mkfs.ext4', 'mkfs.xfs', 'mkfs.vfat', 'mkfs.ntfs',
      'dd', 'shred', 'wipefs', 'parted', 'fdisk', 'cfdisk', 'sfdisk', 'mkswap', 'swapon',
      // Power / init
      'shutdown', 'reboot', 'halt', 'poweroff', 'init',
      // Windows disk format
      'format',
      // Recursive forced deletes of root / wildcards / home
      '/^rm\\s+-rf\\s+\\//',
      '/^rm\\s+-rf\\s+\\*\\/?/',
      '/^rm\\s+-rf\\s+~\\/?/',
      // Raw device writes via redirection
      '/>\\s*\\/dev\\//',
      // Fork bomb
      '/:\\(\\)\\s*\\{.*\\};/',
      // World-unreadable chmod/chown -R 0
      '/^chmod\\s+-R\\s+0+\\s/',
      '/^chown\\s+-R\\s+0+\\s/',
    ],
    mode: "blocklist", // 'permissive' | 'allowlist' | 'blocklist'
  },
  filesystem: {
    allowedPaths: ["."],
    blockExtensions: [],
  },
  sessions: {
    maxSessions: config.maxSessions,
    sessionTtlMs: config.sessionTtlMs,
  },
};

/**
 * Match a single allow/block entry against a command string.
 * @param {string} entry — plain token or `/regex/` form
 * @param {string} command — full command string
 * @returns {boolean}
 */
function matchesEntry(entry, command) {
  if (entry.startsWith('/') && entry.endsWith('/') && entry.length > 2) {
    try {
      return new RegExp(entry.slice(1, -1), 'i').test(command);
    } catch {
      return false;
    }
  }
  const cmdName = command.trim().split(/\s+/)[0];
  return cmdName === entry || command === entry || command.startsWith(entry + ' ');
}

// ── AI-exec command policy (stricter, agent-facing) ──
// Used by routes/tools.js and the AI terminal tool, where a (potentially
// autonomous) agent runs commands. Threat model: prompt injection via tool
// output (web_fetch, an untrusted file read, etc.) could trick the agent into
// running hostile commands.
//
// The ALLOWLIST is the PRIMARY gate: any base command not on the list is
// rejected. This closes the "arbitrary binary execution" hole — including
// classic indirection like `sh -c "..."`, `bash -c "..."`, `node -e "..."`,
// `python -c "..."`, since `sh`/`bash`/`node`(with -e)/`python`(with -c) are
// either absent from the list or matched by the destructive DENY below.
//
// Shell features (pipes `|`, `&&`, redirection, `$()`) are PRESERVED by default
// so the agent can do real coding work (e.g. `npm run build && npm test`,
// `git log --since="$(date)"`). A SECONDARY destructive-pattern DENY-list
// catches the worst ops even for allowed bases, and also blocks destructive
// leaves hidden inside `$(...)` / backtick substitution.
//
// Set HESI_AI_EXEC_STRICT=1 for MAXIMUM lockdown: no shell, metachar ban,
// execFile-only (breaks pipe/chain workflows — only for high-trust-reduction
// scenarios). Extend the allowlist at runtime via HESI_AI_EXEC_ALLOW (csv).
//
// NOTE: regex entries below must NOT include a trailing flag — matchesEntry()
// applies the 'i' flag itself and only recognizes `/.../` as a regex.
const AI_EXEC_ALLOWLIST = new Set([
  // shells-as-base are intentionally ABSENT (sh/bash/cmd/powershell base => blocked)
  'ls', 'dir', 'cat', 'type', 'echo', 'pwd', 'cd', 'cls', 'clear', 'head', 'tail', 'wc', 'nl',
  'sort', 'uniq', 'cut', 'tr', 'tee', 'grep', 'egrep', 'fgrep', 'sed', 'awk', 'jq',
  'node', 'node.exe', 'python', 'python3', 'pip', 'pip3', 'npm', 'npx', 'yarn', 'pnpm',
  'bun', 'deno', 'git', 'cargo', 'go', 'rustc', 'make', 'cmake', 'gcc', 'g++', 'clang',
  'clang++', 'ruby', 'perl', 'php', 'java', 'javac', 'tsc', 'eslint', 'prettier', 'biome',
  'curl', 'wget', 'find', 'xargs', 'diff', 'patch', 'tar', 'unzip', 'zip', 'gzip', 'gunzip',
  'brotli', 'docker', 'kubectl', 'ps', 'pgrep', 'top', 'htop', 'netstat', 'ss', 'ping',
  'env', 'printenv', 'which', 'where', 'command', 'stat', 'file', 'read', 'test', 'tree',
  'less', 'more', 'mkdir', 'touch', 'cp', 'mv', 'rmdir', 'chmod', 'date', 'whoami', 'id',
  'uname', 'df', 'du', 'free', 'iconv', 'xxd', 'base64', 'openssl', 'sqlite3', 'psql',
  'mysql', 'redis-cli', 'gh', 'dotnet', 'swift', 'ktlint', 'goimports',
]);

/** Operator extension: comma-separated extra allowed base commands. */
function aiExecAllowExtra() {
  const raw = process.env.HESI_AI_EXEC_ALLOW;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Secondary destructive deny — applies even to allowed bases.
const AI_EXEC_DENY = [
  // code-exec indirection (base 'node'/'python' allowed, but -e/-c must be blocked)
  '/(^|\\s)(node|node\\.exe)\\s+(-e|--eval|\\/e\\s)/',
  '/(^|\\s)(python|python3)\\s+(-c|--command)\\b/',
  '/(^|\\s)(perl|ruby)\\s+-e\\b/',
  '/(^|\\s)(sh|bash|cmd|powershell|pwsh)\\s+(-c|-Command|-enc|-e)\\b/',
  // destructive ops (base names also omitted from allowlist — double covered)
  '/(^|\\s)(rm|del|deltree|rd\\s)\\b/',
  '/(^|\\s)(dd\\s+if=|mkfs\\.|shutdown|reboot|halt|poweroff|init\\s+(0|6))\\b/',
  '/(^|\\s)(format|diskpart|fdisk|cipher\\s+\\/w)\\b/',
  '/(^|\\s)(chmod\\s+777|chown\\s|chmod\\s+-R\\s+0+|chown\\s+-R\\s+0+)\\b/',
  '/(^|\\s)(kill\\s+-9|pkill\\s+-9|taskkill\\s+\\/f)\\b/',
  '/(^|\\s)(nmap|masscan|zmap)\\s/',
  '/(^|\\s)(curl|wget)[^|]*\\|\\s*(ba)?sh\\b/',
  '/(^|\\s)(curl|wget)\\s+.*(?:miner|coin|crypt)\\b/',
  '/:\\(\\)\\s*\\{.*\\};/',
  '/(^|\\s)(sudo|su\\s)\\b/',
  '/(^|\\s)(reg\\s+(delete|add|import))\\s/',
  '/(^|\\s)(takeown|icacls|cacls|attrib)\\s/',
  // command substitution / backticks carrying a destructive leaf
  '/\\$\\([^)]*(rm|dd|mkfs|shutdown|reboot|del|deltree)\\b/',
  '/`[^`]*\\b(rm|dd|mkfs|shutdown|reboot|del|deltree)\\b[^`]*`/',
];

/** Extract the base command name (basename if given as an absolute path). */
function aiExecBaseOf(command) {
  const first = (command || '').trim().split(/\s+/)[0] || '';
  return first.split(/[\\/]/).pop().toLowerCase();
}

/**
 * Evaluate a command for the AI-exec (autonomous agent) profile.
 * @returns {{ allowed: boolean, reason?: string, mode?: 'shell'|'strict', base?: string, args?: string[] }}
 */
function evaluateAiExec(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) return { allowed: false, reason: 'Empty command' };
  const base = aiExecBaseOf(trimmed);
  const strict = process.env.HESI_AI_EXEC_STRICT === '1';
  const allow = new Set([...AI_EXEC_ALLOWLIST, ...aiExecAllowExtra()]);
  if (!allow.has(base)) {
    return { allowed: false, reason: `Command '${base}' is not permitted for AI execution (not in allowlist)` };
  }
  const denied = AI_EXEC_DENY.some((pat) => matchesEntry(pat, trimmed));
  if (denied) {
    return { allowed: false, reason: `Command '${base}' is blocked by AI-exec security policy` };
  }
  if (strict) {
    // no-shell: reject any shell metachar, then run via execFile (array args)
    if (/[;&|`$()<>#\n\r]/.test(trimmed)) {
      return { allowed: false, reason: 'Shell metacharacters are not allowed in strict AI-exec mode' };
    }
    const args = trimmed.split(/\s+/).slice(1);
    return { allowed: true, mode: 'strict', base, args };
  }
  return { allowed: true, mode: 'shell', base, args: [] };
}

let _policy = null;

/**
 * Load policy from disk. Falls back to defaults.
 *
 * NOTE: Reads QCLI_POLICY_PATH from process.env directly (not from
 * config.policyPath) so that tests can change the env var at runtime
 * and the policy engine picks it up correctly on each call to loadPolicy().
 */
function loadPolicy() {
  if (_policy) return _policy;

  const envPath = process.env.QCLI_POLICY_PATH;
  const policyPath = (envPath || config.policyPath) || path.join(process.cwd(), ".cli-q-policy.json");

  try {
    if (fs.existsSync(policyPath)) {
      const raw = fs.readFileSync(policyPath, "utf-8");
      const parsed = JSON.parse(raw);
      _policy = {
        ...DEFAULT_POLICY,
        ...parsed,
        commands: { ...DEFAULT_POLICY.commands, ...(parsed.commands || {}) },
        filesystem: { ...DEFAULT_POLICY.filesystem, ...(parsed.filesystem || {}) },
        sessions: { ...DEFAULT_POLICY.sessions, ...(parsed.sessions || {}) },
      };
      console.error(`[Policy] Loaded from ${policyPath}`);
      return _policy;
    }
  } catch (err) {
    console.error(`[Policy] Failed to load ${policyPath}: ${err.message}`);
  }

  _policy = { ...DEFAULT_POLICY };
  return _policy;
}

/**
 * Check if a command is allowed by policy.
 * @param {string} command - The full command string
 * @param {{ profile?: 'aiExec' }} [options] - 'aiExec' selects the stricter
 *        AI-agent blocklist (used by routes/tools.js and the AI terminal tool).
 *        Omit for the operator-customizable terminal policy.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkCommand(command, options = {}) {
  const policy = loadPolicy();
  if (!policy.commands || policy.commands.mode === "permissive") {
    return { allowed: true };
  }

  // ── AI-exec profile: stricter, allowlist-based gate ──
  // Autonomous agents run through an allowlist of base commands + a destructive
  // deny-list (see evaluateAiExec). This closes the arbitrary-binary-execution
  // hole that a pure blocklist (incl. `sh -c`, `node -e`, `python -c`) could
  // bypass, while preserving shell features so the agent can code.
  if (options && options.profile === "aiExec") {
    const r = evaluateAiExec(command);
    return { allowed: r.allowed, reason: r.reason };
  }

  const cmdName = command.trim().split(/\s+/)[0];

  if (policy.commands.mode === "allowlist") {
    const allowed = policy.commands.allowlist.some((a) => matchesEntry(a, command));
    if (!allowed) {
      return { allowed: false, reason: `Command '${cmdName}' is not in the allowlist` };
    }
  }

  if (policy.commands.mode === "blocklist") {
    const blocked = policy.commands.blocklist.some((b) => matchesEntry(b, command));
    if (blocked) {
      return { allowed: false, reason: `Command '${cmdName}' is blocked by security policy` };
    }
  }

  return { allowed: true };
}

/**
 * Check if a file path is allowed for read/write.
 * @param {string} filePath - Absolute or relative file path
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkFilePath(filePath) {
  const policy = loadPolicy();
  if (!policy.filesystem || policy.filesystem.allowedPaths.length === 0) {
    return { allowed: true };
  }

  const resolved = path.resolve(filePath);
  const projectRoot = process.cwd();

  // Must be within project root
  if (!resolved.startsWith(projectRoot)) {
    return { allowed: false, reason: `File '${filePath}' is outside the project root` };
  }

  // Check block extensions
  const ext = path.extname(resolved).toLowerCase();
  if (policy.filesystem.blockExtensions.includes(ext)) {
    return { allowed: false, reason: `File extension '${ext}' is blocked by policy` };
  }

  return { allowed: true };
}

/**
 * Reload policy from disk (for hot-reload).
 */
function reloadPolicy() {
  _policy = null;
  return loadPolicy();
}

// Initialize on load
loadPolicy();

module.exports = { checkCommand, checkFilePath, loadPolicy, reloadPolicy, matchesEntry, evaluateAiExec };
