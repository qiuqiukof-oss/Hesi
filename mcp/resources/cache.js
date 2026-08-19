/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Versioned Resource Cache — extracted to break circular dep
// ============================================================

/** Cache entry: { version, data, expiresAt, noCache } */
const _cache = new Map();

const DEFAULT_TTL_MS = 300_000; // 5 min

/**
 * Mark a URI as cacheable (called from route handler modules).
 * @param {string} uri - Resource URI (without query params)
 * @param {number} [ttlMs=300000] - TTL in milliseconds
 */
function markCacheable(uri, ttlMs = DEFAULT_TTL_MS) {
  _cache.set(uri, { version: 0, data: null, expiresAt: 0, ttlMs, noCache: false });
}

/**
 * Mark a URI as non-cacheable (dynamic resources like health, sessions).
 */
function markNoCache(uri) {
  _cache.set(uri, { version: 0, data: null, expiresAt: 0, ttlMs: 0, noCache: true });
}

/**
 * Wrap a handler with caching logic.
 * For cacheable URIs:
 *  - If ?v=N matches cached version → { cached: true, version }
 *  - If cache expired → call real handler, cache result
 *  - If ?v= differs from cached version → return full data with new version
 */
function withCache(uri, handler) {
  const [baseUri, params] = splitQuery(uri);
  const entry = _cache.get(baseUri);

  // No cache config → pass through
  if (!entry) return handler(uri);

  // Non-cacheable → pass through
  if (entry.noCache) return handler(uri);

  // Check TTL expiry
  const now = Date.now();
  if (entry.expiresAt <= now || entry.data === null) {
    // Cache miss or expired — call real handler
    return handler(uri).then((result) => {
      entry.version += 1;
      entry.data = result;
      entry.expiresAt = now + entry.ttlMs;
      return result;
    });
  }

  // Cache hit — check client version
  const clientVersion = params.has("v") ? parseInt(params.get("v"), 10) : undefined;

  if (clientVersion !== undefined && clientVersion === entry.version) {
    // Client already has this version → return lightweight response
    return Promise.resolve({
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ cached: true, version: entry.version }),
      }],
    });
  }

  // Client has stale or no version → return cached data
  return Promise.resolve(entry.data);
}

/**
 * Strip query parameters from a URI, returning [baseUri, params].
 * @param {string} uri
 * @returns {[string, URLSearchParams]}
 */
function splitQuery(uri) {
  const qIndex = uri.indexOf("?");
  if (qIndex < 0) return [uri, new URLSearchParams()];
  return [uri.slice(0, qIndex), new URLSearchParams(uri.slice(qIndex + 1))];
}

module.exports = { markCacheable, markNoCache, withCache, splitQuery };
