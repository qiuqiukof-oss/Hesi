// ============================================================
// Unified Audit Bus (A2)
//
// Single append-only JSONL sink for every security-relevant event:
//   login / logout / pty_command / mcp_tool / agent_discuss /
//   file_upload / config_change / tool_call / resource_read
//
// Supersedes mcp/security/audit.js (which now delegates here) so the
// audit trail covers the core terminal layer, not just the MCP layer.
// ============================================================
const fs = require('fs');
const path = require('path');
const { AUDIT_LOG } = require('./config');

const SENSITIVE = [
  'token', 'password', 'secret', 'key', 'auth', 'credential',
  'api_key', 'apikey', 'privatekey', 'bearer',
];

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.some((s) => k.toLowerCase().includes(s))) out[k] = '[REDACTED]';
    else if (typeof v === 'string' && v.length > 200) out[k] = `${v.slice(0, 200)  }... [truncated]`;
    else out[k] = v;
  }
  return out;
}

function ensureDir() {
  try {
    const dir = path.dirname(AUDIT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
}

// Async batched writer — never block the request path.
const _queue = [];
let _writing = false;

function flush() {
  if (_writing || _queue.length === 0) return;
  _writing = true;
  const batch = _queue.splice(0, _queue.length);
  const text = `${batch.map((l) => JSON.stringify(l)).join('\n')  }\n`;
  ensureDir();
  fs.appendFile(AUDIT_LOG, text, 'utf-8', (err) => {
    if (err) console.error('[Audit] write failed:', err.message);
    _writing = false;
    if (_queue.length) flush();
  });
}

function log(entry) {
  const rec = { t: new Date().toISOString(), ...entry };
  if (rec.params) rec.params = sanitize(rec.params);
  if (rec.meta) rec.meta = sanitize(rec.meta);
  if (rec.cmd && typeof rec.cmd === 'string' && rec.cmd.length > 500) rec.cmd = `${rec.cmd.slice(0, 500)  }... [truncated]`;
  console.error(`[AUDIT] ${(rec.type || 'event')} ${rec.action || ''}`.trim());
  _queue.push(rec);
  flush();
  return rec;
}

// ── Event helpers ──
const login = (user, meta) => log({ type: 'auth', action: 'login', user, meta });
const logout = (user, meta) => log({ type: 'auth', action: 'logout', user, meta });
const ptyCommand = (e) => log({ type: 'pty_command', user: e.user, session: e.session, cwd: e.cwd, cmd: e.cmd, policyResult: e.policyResult });
const mcpTool = (tool, params, result) => log({ type: 'mcp_tool', tool, params, result });
const agentDiscuss = (user, meta) => log({ type: 'agent_discuss', user, meta });
const fileUpload = (user, meta) => log({ type: 'file_upload', user, meta });
const configChange = (user, meta) => log({ type: 'config_change', user, meta });
const toolCall = (tool, params, result) => log({ type: 'tool_call', tool, params, result });
const resourceRead = (uri, result) => log({ type: 'resource_read', uri, result });

// ── Query / export ──
function query({ type, user, since, limit } = {}) {
  let lines = [];
  try {
    if (!fs.existsSync(AUDIT_LOG)) return [];
    const content = fs.readFileSync(AUDIT_LOG, 'utf-8');
    lines = content.split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
  if (type) lines = lines.filter((l) => l.type === type);
  if (user) lines = lines.filter((l) => l.user === user);
  if (since) lines = lines.filter((l) => new Date(l.t) >= new Date(since));
  lines.reverse(); // newest first
  if (limit && limit > 0) lines = lines.slice(0, limit);
  return lines;
}

function exportCsv({ type, since } = {}) {
  const rows = query({ type, since });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'timestamp,type,action,user,detail';
  if (!rows.length) return `${header  }\n`;
  const body = rows.map((r) => [
    r.t,
    r.type,
    r.action || '',
    r.user || '',
    JSON.stringify(r.params || r.meta || r.cmd || r.tool || '').slice(0, 200),
  ].map(esc).join(','));
  return [header, ...body].join('\n');
}

module.exports = {
  AUDIT_LOG,
  log, login, logout, ptyCommand, mcpTool, agentDiscuss, fileUpload,
  configChange, toolCall, resourceRead, query, exportCsv,
};
