/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Access Auth — optional, configurable access token for HTTP + WebSocket
//
// Design goals:
// - Default (QCLI_ACCESS_TOKEN unset): fully open (dev/local mode). This mirrors
//   the existing MCP auth behavior (auth only enforced when a token is configured),
//   so existing localhost usage is never broken.
// - When QCLI_ACCESS_TOKEN is set:
//     * Loopback clients (127.0.0.1 / ::1 / localhost) are exempt by default
//       (the browser UI is served from the same machine). Set
//       QCLI_TOKEN_REQUIRE_LOOPBACK=1 to also require the token for loopback.
//     * Remote clients MUST present the token via
//         Authorization: Bearer <token>   (HTTP)
//         ?token=<token>                  (WebSocket / query)
//
// Mount `requireToken` on sensitive routers (browser/*, plugins, uploads).
// Call `wsAllowed(req)` inside the WebSocket connection handler.
// ============================================================
const TOKEN = process.env.QCLI_ACCESS_TOKEN || '';
const REQUIRE_LOOPBACK = process.env.QCLI_TOKEN_REQUIRE_LOOPBACK === '1';

/** Whether access-token enforcement is active. */
const isAuthEnabled = !!TOKEN;

/**
 * True if the address is a loopback address.
 * @param {string} addr
 * @returns {boolean}
 */
function isLoopbackAddr(addr) {
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === 'localhost'
  );
}

/**
 * True if an Origin/Referer header points at a loopback host.
 * @param {string} [origin]
 * @returns {boolean}
 */
function isLoopbackOrigin(origin) {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(origin);
}

/**
 * Extract a bearer token from an Express request (header or query).
 * @param {import('express').Request} req
 * @returns {string}
 */
function extractToken(req) {
  const auth = req.headers && req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '');
  }
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return '';
}

/**
 * Express middleware. No-op when auth is disabled. Otherwise enforces the
 * token policy described above.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireToken(req, res, next) {
  if (!isAuthEnabled) return next();

  const ip = (req.ip || req.connection?.remoteAddress || '');
  const origin = req.headers?.origin || '';
  const referer = req.headers?.referer || '';
  if (!REQUIRE_LOOPBACK && (isLoopbackAddr(ip) || isLoopbackOrigin(origin) || isLoopbackOrigin(referer))) {
    return next();
  }

  const t = extractToken(req);
  if (t && t === TOKEN) return next();

  return res.status(401).json({
    error: 'Unauthorized: missing or invalid access token.',
    hint: 'Set QCLI_ACCESS_TOKEN on the server, then pass it via ' +
      'Authorization: Bearer <token> (HTTP) or ?token=<token> (WebSocket).',
  });
}

/**
 * WebSocket connection guard. Returns true if the connection is allowed.
 *
 * 除 token 校验外，还独立执行握手 Origin 校验：
 * 浏览器对 WebSocket 握手不执行 CORS 预检/响应拦截，恶意网页
 * （http://evil.example）可向 ws://127.0.0.1:4264 发起升级请求；且握手是
 * GET 方法，localOriginGuard（只拦 POST/PUT/DELETE/PATCH）拦不住它。
 * 因此这里对带非回环、非白名单 Origin 的握手一律拒绝——无论是否启用 token。
 * 无 Origin 头（curl / 原生应用 / 同源导航）放行，与 localOriginGuard 一致。
 * @param {object} req — the upgrade request (has .socket / .connection / .url)
 * @returns {boolean}
 */
function wsAllowed(req) {
  const origin = (req.headers && req.headers.origin) ? String(req.headers.origin) : '';
  if (origin && !isLoopbackOrigin(origin) && !getAllowedOrigins().includes(origin)) {
    return false;
  }
  if (!isAuthEnabled) return true;
  const ip = (req.socket?.remoteAddress || req.connection?.remoteAddress || '');
  if (!REQUIRE_LOOPBACK && isLoopbackAddr(ip)) return true;
  const url = req.url || '';
  const m = url.match(/[?&]token=([^&]+)/);
  const t = m ? decodeURIComponent(m[1]) : '';
  return t === TOKEN;
}

// ── Local-origin guard (anti drive-by / CSRF for a local-only service) ──
//
// Threat model (personal local tool): the server binds 127.0.0.1, so it is not
// reachable from the LAN. The realistic attack is a *browser drive-by*: the user
// visits a malicious page (http://evil.example) which issues a state-changing
// request (POST/PUT/DELETE/PATCH) to http://127.0.0.1:4264/... . CORS blocks the
// attacker from *reading the response*, but for "simple" requests the browser
// still *sends* the request, so the side effect (spawn a shell, write a file,
// run an agent) executes anyway — effectively blind RCE.
//
// This guard rejects such requests *before* any side effect runs: a mutating
// method carrying a non-loopback, non-allowlisted Origin is a cross-site attempt
// and is refused with 403. Requests with no Origin (curl / native app / same-
// origin navigation) and loopback-origin requests (the local UI) pass through.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Parse the origin allowlist from QCLI_CORS_ORIGINS (shared with server CORS).
 * @returns {string[]}
 */
function getAllowedOrigins() {
  return (process.env.QCLI_CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Decide whether a request should be blocked by the local-origin guard.
 * Pure/testable core (no res object needed).
 * @param {string} method
 * @param {string} [origin]
 * @param {string[]} [allowed] explicit allowlist (defaults to env)
 * @returns {boolean} true → block the request
 */
function shouldBlockCrossOrigin(method, origin, allowed = getAllowedOrigins()) {
  if (!MUTATING_METHODS.has(String(method || '').toUpperCase())) return false;
  if (!origin) return false;                 // non-browser or same-origin nav
  if (isLoopbackOrigin(origin)) return false; // the local UI
  if (allowed.includes(origin)) return false; // explicitly trusted
  return true;                               // cross-site mutating request → block
}

/**
 * Express middleware form of the local-origin guard. Mount early (before route
 * handlers with side effects). Reads/GET/HEAD/OPTIONS always pass.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function localOriginGuard(req, res, next) {
  const origin = req.headers?.origin || '';
  if (shouldBlockCrossOrigin(req.method, origin)) {
    return res.status(403).json({
      error: 'Forbidden: cross-origin request to a local-only service was blocked.',
      hint: 'This service only accepts state-changing requests from its own local UI. ' +
        'To allow an additional origin, set QCLI_CORS_ORIGINS on the server.',
    });
  }
  return next();
}

module.exports = {
  requireToken,
  wsAllowed,
  isAuthEnabled,
  isLoopbackAddr,
  isLoopbackOrigin,
  localOriginGuard,
  shouldBlockCrossOrigin,
};
