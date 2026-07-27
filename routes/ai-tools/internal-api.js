// ============================================================
// Internal API Helpers — shared GET/POST for builtin tools
//
// Wraps the internal API calls with consistent error handling:
// - Extracts error messages from JSON error bodies
// - Falls back to HTTP status for non-JSON responses
// - Throws on failure (caught by caller's try/catch)
// ============================================================

const API_BASE = () => `http://127.0.0.1:${process.env.PORT || 3001}/api`;

/** Ensure path starts with '/' */
const normalizePath = (p) => p.startsWith('/') ? p : `/${  p}`;

/**
 * Build a full URL with query parameters.
 * Both keys and values are URL-encoded.
 * Path is normalized to ensure it starts with '/'.
 */
function buildUrl(path, params = {}) {
  const normalizedPath = normalizePath(path);
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${API_BASE()}${normalizedPath}${query ? `?${  query}` : ''}`;
}

/**
 * Handle a non-OK response: try to extract error from JSON body,
 * fall back to HTTP status text.
 * @param {Response} resp
 * @returns {Promise<never>} Always throws
 */
async function throwOnError(resp) {
  let msg = `HTTP ${resp.status}`;
  try {
    const err = await resp.json();
    if (err && err.error) msg = err.error;
  } catch { /* non-JSON body — use default */ }
  throw new Error(msg);
}

/**
 * Fetch a GET endpoint and return parsed JSON.
 * @param {string} path - API path (e.g. "/clis")
 * @param {object} [params] - Query parameters
 * @returns {Promise<object>} Parsed response
 */
async function fetchGet(path, params) {
  const resp = await fetch(buildUrl(path, params));
  if (!resp.ok) await throwOnError(resp);
  return resp.json();
}

/**
 * POST JSON body to an endpoint and return parsed JSON.
 * @param {string} path - API path (e.g. "/tools/write-file")
 * @param {object} body - JSON body
 * @returns {Promise<object>} Parsed response
 */
async function fetchPost(path, body) {
  const normalizedPath = normalizePath(path);
  const resp = await fetch(`${API_BASE()}${normalizedPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) await throwOnError(resp);
  return resp.json();
}

module.exports = { fetchGet, fetchPost };
