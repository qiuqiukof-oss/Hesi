// ============================================================
// Hesi — Entry Point
// ============================================================
// Load .env if present — defensive so a missing dotenv never crashes startup.
try { require('dotenv').config(); } catch { /* dotenv is optional */ }
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const { setupRoutes } = require('./routes');
const { createWSManager } = require('./ws-handler');
const { NODE_PTY_AVAILABLE } = require('./ws/pty');
const { discoverCLIsAsync, resolveRegistryPaths, migrateRegistryCategories } = require('./cli-discovery');
const { createRouter: createHealthRouter } = require('./routes/health');
const { createRouter: createSystemRouter } = require('./routes/system');
const { cleanupOldUploads } = require('./routes/upload');
const { GENERATED_UPLOADS_DIR, USER_UPLOADS_DIR } = require('./lib/uploads');

// node-pty 1.1.0 already wraps getConsoleProcessList(shellPid) in try/catch
// (see node_modules/node-pty/lib/conpty_console_list_agent.js), so the previous
// postinstall monkey-patch is no longer needed and has been removed. The
// unhandledRejection handler below stays as defense-in-depth.
process.on('unhandledRejection', (reason) => {
  console.error('[PTY] Unhandled rejection (non-fatal):', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  console.error(err.stack);
  // 先尝试优雅关闭 PTY、MCP 子进程和服务器，再退出
  console.log('[FATAL] Attempting graceful shutdown before exit...');
  try {
    if (mcpManager) { try { mcpManager.shutdown(); } catch (e) { /* already gone */ } }
    if (typeof wsManager?.close === 'function') wsManager.close();
    for (const s of servers) { try { s.close(); } catch (e) { /* already closed */ } }
  } catch (e) {
    console.error('[FATAL] Cleanup error:', e?.message);
  }
  setTimeout(() => process.exit(1), 1000); // 1s 超时后强制退出
});

// ============================================================
// Configuration
// ============================================================
const PORT = parseInt(process.env.PORT, 10) || 4264;
const HOST = process.env.HOST || 'loopback'; // default = dual loopback bind (127.0.0.1 + ::1)
const isWin = process.platform === 'win32';

// 启动时生成/刷新 agent 配置（.mcp.json + CLAUDE.md + AGENTS.md），
// 使终端里的 opencode/Claude/Codex 能连上 Hesi 的 MCP 服务器并获知运行上下文。
// 幂等、不破坏用户已有文件；失败仅告警。
require('./lib/ensure-agent-config').ensureAgentConfig({ port: PORT });
// All HTTP servers we bind (one per loopback address, or a single explicit host).
const servers = [];

// Startup env validation (non-blocking warnings)
const REQUIRED_ENV = [
  { key: 'OPENAI_API_KEY', desc: 'OpenAI API key', optional: true },
  { key: 'ANTHROPIC_API_KEY', desc: 'Anthropic API key', optional: true },
  { key: 'STABILITY_API_KEY', desc: 'Stability AI API key (optional, enables AI image generation)', optional: true },
  { key: 'PANDOC_PATH', desc: 'Pandoc executable path (optional, enables document format conversion via convert_document tool)', optional: true },
  { key: 'BING_SEARCH_API_KEY', desc: 'Bing Search API key (optional, falls back to DuckDuckGo/Tavily)', optional: true },
  { key: 'TAVILY_API_KEY', desc: 'Tavily Search API key (optional, uses keyless mode by default)', optional: true },
  // MCP 配置
  { key: 'QCLI_CMD_TIMEOUT', desc: 'MCP command timeout in ms (default 15000)', optional: true },
  { key: 'QCLI_CMD_DRAIN', desc: 'MCP command drain delay in ms (default 2000)', optional: true },
  { key: 'QCLI_SESSION_TTL', desc: 'PTY session TTL in ms (default 900000 / 15 min)', optional: true },
  { key: 'QCLI_MAX_SESSIONS', desc: 'Max concurrent PTY sessions (default 10)', optional: true },
  { key: 'QCLI_RING_BUFFER', desc: 'Terminal ring buffer lines (default 5000)', optional: true },
  { key: 'QCLI_WS_TIMEOUT', desc: 'WebSocket connect timeout in ms (default 10000)', optional: true },
  { key: 'QCLI_MCP_TOKEN', desc: 'MCP auth token (empty = no auth)', optional: true },
  { key: 'QCLI_POLICY_PATH', desc: 'MCP security policy file path', optional: true },
  { key: 'QCLI_AUDIT_LOG', desc: 'MCP audit log file path (empty = no audit)', optional: true },
  { key: 'QCLI_WITH_MCP', desc: 'Set to 1 to auto-start MCP sub-process', optional: true },
];
for (const v of REQUIRED_ENV) {
  if (process.env[v.key]) {
    console.log(`[config] ${v.key}=configured`);
  }
}
const hasAnyLLMKey = !!process.env.OPENAI_API_KEY || !!process.env.ANTHROPIC_API_KEY;
if (!hasAnyLLMKey) {
  console.warn('[config] No LLM API key found — AI chat will try local LM Studio (localhost:1234)');
}

// ============================================================
// Express App
// ============================================================
const app = express();
// gzip 压缩：跳过 SSE（text/event-stream）响应，避免缓冲 tool_call 等小事件
// 导致前端"最后一起弹出"而非实时逐条展示
app.use(compression({
  filter: (req, res) => {
    // 不压缩 SSE 流：压缩中间件会攒批小数据块，破坏事件实时性
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    if (req.headers.accept && req.headers.accept.includes('text/event-stream')) return false;
    return compression.filter(req, res);
  }
}));
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// ── CORS ──
// Default: only same-origin / loopback browsers are allowed. Cross-origin
// requests are denied unless explicitly listed in QCLI_CORS_ORIGINS
// (comma-separated). Requests without an Origin header (curl, SSE, server-to-
// server) are allowed. This pairs with the default 127.0.0.1 bind so a fresh
// install is not silently exposed to the LAN.
const allowedCorsOrigins = (process.env.QCLI_CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
function isLoopbackOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(origin || '');
}
app.use(cors({
  origin(origin, callback) {
    // 允许无 origin 的请求（如 curl、Server-Sent Events）
    if (!origin) return callback(null, true);
    // 允许同源 / 回环
    if (isLoopbackOrigin(origin)) return callback(null, true);
    // 允许显式白名单
    if (allowedCorsOrigins.includes(origin)) return callback(null, true);
    // 其他来源一律拒绝
    return callback(null, false);
  },
  credentials: false,
}));
// ── Local-origin guard ──
// CORS only stops a cross-site page from *reading* our responses; a "simple"
// cross-site POST still *executes* its side effect. Since this is a local-only
// service, reject state-changing requests carrying a non-loopback Origin before
// any handler runs (defense against browser drive-by / CSRF). Shares the
// QCLI_CORS_ORIGINS allowlist with the CORS config above.
const { localOriginGuard } = require('./lib/access-auth');
app.use(localOriginGuard);
app.use(express.json({ limit: '1mb' }));

// Serve security.txt (RFC 9116 vulnerability disclosure) at the well-known path.
app.get(['/.well-known/security.txt', '/security.txt'], (req, res) => {
  res.sendFile(path.join(__dirname, 'security.txt'));
});

// Serve xterm.css (not bundled by esbuild — needed for terminal styling)
app.get('/xterm/css/xterm.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'));
});

// Serve the SPA shell with content-hashed bundle URLs (/bundle.js?v=<hash>).
// Injecting the hash here (rather than at build time) keeps the folder-copy /
// offline distribution model intact and picks up rebuilds without a restart.
// index.html itself stays no-cache so the current hashes are always delivered.
const PUBLIC_DIR = path.join(__dirname, 'public');
const { injectAssetHashes } = require('./lib/asset-hash');
const HASHED_BUNDLES = ['bundle.js', 'lazy-bundle.js'];
app.get(['/', '/index.html'], (req, res, next) => {
  fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
    if (err) return next(); // fall through to express.static (e.g. missing file)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(injectAssetHashes(html, PUBLIC_DIR, HASHED_BUNDLES));
  });
});

// Serve static frontend
// CSS/JS/HTML: no cache; hashed bundles: 1-year immutable; images/fonts/wasm: 7-day immutable
app.use(express.static(PUBLIC_DIR, {
  maxAge: 0,
  etag: true,
  setHeaders: (res, filePath) => {
    const base = path.basename(filePath);
    if (HASHED_BUNDLES.includes(base)) {
      // Content-hashed via ?v= in index.html, so the bytes behind a given URL
      // never change → safe to cache for a year. A rebuild changes the hash,
      // which changes the URL, which busts the cache automatically.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // JS/CSS/HTML: no cache — always fresh from server
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.svg') || filePath.endsWith('.png') || filePath.endsWith('.jpg') ||
               filePath.endsWith('.woff2') || filePath.endsWith('.woff') || filePath.endsWith('.ttf') ||
               filePath.endsWith('.ico') || filePath.endsWith('.wasm')) {
      // Images/fonts/wasm: 7-day immutable cache
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  },
}));

// Serve plugin UI assets (for dynamic plugin script loading in browser)
app.use('/plugin-assets', express.static(path.join(__dirname, 'plugins')));

// Serve GENERATED uploads (AI artifacts: converted docs, generated images/video).
// USER uploads live in ./uploads/.user/ — express.static defaults to dotfiles:'ignore',
// so the hidden .user directory is never exposed via this public route. They are only
// reachable through the authenticated /api/uploads route (see routes/upload.js).
app.use('/uploads', express.static(GENERATED_UPLOADS_DIR, { dotfiles: 'ignore' }));

// Ensure upload directories exist on startup.
for (const d of [GENERATED_UPLOADS_DIR, USER_UPLOADS_DIR]) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
  catch (e) { console.warn('[uploads] mkdir failed:', d, e?.message); }
}

// ============================================================
// Playwright browser check — non-fatal warning if chromium missing
// ============================================================
try {
  const pw = require('playwright');
  const { existsSync } = require('fs');
  const chromiumPath = pw.chromium.executablePath();
  if (!existsSync(chromiumPath)) {
    console.warn('[playwright] Chromium browser not found — install with: npx playwright install chromium');
  }
} catch (e) {
  // playwright npm package not installed — skip check silently
}

// ============================================================
// Optional MCP child process (--with-mcp flag)
// Delegated to lib/mcp-process.js for testability
// ============================================================
const { MCPProcessManager } = require('./lib/mcp-process');

const withMcp = process.argv.includes("--with-mcp") || process.env.QCLI_WITH_MCP === "1";

// MCP manager is created lazily — wsManager is populated after createWSManager()
let mcpManager = null;

function ensureMCPManager() {
  if (mcpManager) return mcpManager;
  mcpManager = new MCPProcessManager({
    withMcp,
    wsManager,
    heartbeatInterval: parseInt(process.env.MCP_HEARTBEAT_INTERVAL, 10) || 30000,
    heartbeatTimeout: parseInt(process.env.MCP_HEARTBEAT_TIMEOUT, 10) || 120000,
    maxRestarts: parseInt(process.env.MCP_MAX_RESTARTS, 10) || 5,
  });
  return mcpManager;
}

if (withMcp) {
  // Defer spawn until wsManager is ready (after createWSManager)
  setImmediate(() => ensureMCPManager());
}

// ============================================================
// HTTP Server + WebSocket
// ============================================================
const wsManager = createWSManager({ port: PORT });

// Mount all API routes (pass broadcast function so routes can push metrics/events to WS clients).
// mcpStatusOpts references ensureMCPManager/withMcp — both initialized above by request time.
setupRoutes(app, {
  broadcastFn: (data) => wsManager?.broadcast?.(data),
  mcpStatusOpts: { ensureMCPManager, withMcp },
});

// Mount digital employee routes (depends on wsManager.digitalEmployeeTeam)
const { createRouter: createDERouter } = require('./routes/digital-employees');
app.use('/api', createDERouter({ digitalEmployeeTeam: wsManager.digitalEmployeeTeam }));

// Mount health route on /health (not under /api) to avoid competing with the apiLimiter budget
app.use('/health', createHealthRouter(wsManager));

// Mount system route (depends on activePTYs from ws-handler)
app.use('/api', createSystemRouter(wsManager.activePTYs));

// ============================================================
// Start — dual loopback bind (no LAN exposure by default)
// ============================================================
const LOOPBACK_ADDRS = ['127.0.0.1', '::1'];

/** Resolve which addresses to bind, based on HOST env. */
function resolveBindAddrs() {
  const h = process.env.HOST;
  if (!h || h === 'loopback') return LOOPBACK_ADDRS;   // default: both stacks
  if (h === 'localhost') return ['localhost'];          // Node resolves (single stack)
  return [h];                                           // explicit address / 0.0.0.0
}

/** True for addresses that widen exposure beyond the local machine. */
function isPublicBind(host) {
  if (host === '0.0.0.0') return true;
  // Public IPv4 (anything outside private/loopback/link-local ranges)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) &&
      !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
    return true;
  }
  return false;
}

function startServer() {
  const addrs = resolveBindAddrs();
  let started = false;
  for (const host of addrs) {
    const srv = http.createServer(app);
    // SSE 长任务（AI 调用工具 / 委派 Agent 可能阻塞数分钟）需要放宽超时，
    // 避免 socket 空闲超时被杀导致前端“连接中断”。前端/服务端靠 keepalive 保活。
    srv.timeout = 600_000;          // socket 空闲超时：10 分钟
    srv.requestTimeout = 600_000;   // 单次请求总时长上限：10 分钟
    srv.headersTimeout = 120_000;   // 仅影响请求头读取阶段
    try {
      wsManager.attach(srv);
    } catch (e) {
      console.warn(`[WS] attach failed for ${  host  }: ${  e.message}`);
    }
    srv.on('error', (err) => {
      console.warn(`[listen] ${  host  }:${  PORT  } bind failed: ${  err.message}`);
    });
    srv.listen(PORT, host, () => {
      console.log(`Hesi（合思） listening on ${  host  }:${  PORT}`);
      console.log(`  -> http://${  host  }:${  PORT}`);
      console.log(`  -> WebSocket: ws://${  host  }:${  PORT}`);
      if (isPublicBind(host)) {
        console.warn(`[SECURITY] Bound to non-loopback address (${  host  }). This widens terminal/browser exposure!`);
        console.warn('[SECURITY] Only do this on a trusted network; prefer the default loopback and set QCLI_ACCESS_TOKEN.');
      }
      // One-time startup tasks (run once even when dual-bound)
      if (!started) {
        started = true;
        if (!NODE_PTY_AVAILABLE) {
          console.warn('[PTY] node-pty native addon not built — terminal/agent disabled. Run npm rebuild node-pty and restart.');
        }
        console.log(`Platform: ${  process.platform  } | Node ${  process.version}`);
        console.log('Uploads  : TTL 1 hour');
        setImmediate(cleanupOldUploads);
        const uploadsDir = require('path').join(__dirname, 'uploads');
        if (!require('fs').existsSync(uploadsDir)) {
          require('fs').mkdirSync(uploadsDir, { recursive: true });
        }
        setTimeout(() => {
          resolveRegistryPaths();
          migrateRegistryCategories();
          discoverCLIsAsync().then(result => {
            console.log(`CLIs     : ${  result.registry.clis.length  } registered (${  result.discovered.length  } new)`);
          }).catch(e => {
            console.log(`CLIs     : discovery error (${  e.message  })`);
          });
        }, 500);
      }
    });
    servers.push(srv);
  }
}
startServer();

// ============================================================
// Graceful shutdown
// ============================================================
function shutdown() {
  console.log('\nShutting down...');
  // 先回收 MCP 子进程，避免父进程退出后它成为孤儿（许多 node 进程残留的根因）。
  if (mcpManager) { try { mcpManager.shutdown(); } catch (e) { /* already gone */ } }
  try { wsManager.close(); } catch (e) { /* already closed */ }
  for (const srv of servers) { try { srv.close(); } catch (e) { /* already closed */ } }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
