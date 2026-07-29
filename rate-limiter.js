/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Simple in-memory rate limiter (no external dependency)
//
// Fixed-window counter: each IP gets its own bucket that resets fully
// every `windowMs`. This is deliberately a *fixed* window (NOT a sliding
// window that refreshes on every hit) so that a steady low-rate abuser is
// still throttled once the window fills. The previous implementation
// refreshed `entry.time` on every request, which let a constant trickle
// accumulate without ever resetting — that bug is fixed here.
// ============================================================

/**
 * Create an Express-compatible rate limiting middleware.
 *
 * @param {object} options
 * @param {number} [options.windowMs=60000]  Time window in milliseconds
 * @param {number} [options.max=30]           Max requests per window
 * @param {string} [options.message]          Error message on block
 * @param {string} [options.name='unnamed']   Identifier for stats reporting
 * @returns {Function} Express middleware with .reset() and .getStats()
 */
/**
 * True if the address is a loopback / local address.
 * Loopback traffic is the trusted local user of a personal tool, so it is
 * exempt from rate limiting (see `skipLoopback` below). Mirrors the same
 * address set used by lib/access-auth.js and ws-handler.js.
 * @param {string} addr
 * @returns {boolean}
 */
function isLoopbackIP(addr) {
  if (!addr || addr === 'unknown') return true;
  let a = addr;
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

function createRateLimiter({ windowMs = 60000, max = 30, message = 'Too many requests, please slow down', name = 'unnamed', skipLoopback = true } = {}) {
  const hits = new Map();
  let totalRequests = 0;
  let blocked = 0;

  // Periodically sweep stale entries — also limit total map size to 10k
  const MAX_MAP_SIZE = 10000;
  const cleanup = setInterval(() => {
    const now = Date.now();
    // Remove all entries whose window has expired
    for (const [key, entry] of hits) {
      if (now - entry.windowStart > windowMs) hits.delete(key);
    }
    // If still too large, trim oldest 20%
    if (hits.size > MAX_MAP_SIZE) {
      const entries = [...hits.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
      const removeCount = Math.floor(hits.size * 0.2);
      for (let i = 0; i < removeCount; i++) {
        hits.delete(entries[i][0]);
      }
    }
  }, 60000);
  if (cleanup.unref) cleanup.unref();

  const rateLimit = function rateLimit(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();

    // Loopback (local single user) is exempt — rate limiting only protects
    // against network-borne abuse, which cannot originate from the loopback
    // interface. This keeps a personal local tool friction-free.
    if (skipLoopback && isLoopbackIP(ip)) return next();

    const entry = hits.get(ip);

    totalRequests++;

    if (!entry || now - entry.windowStart > windowMs) {
      // First request or window expired — start a fresh fixed window
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    // Within the current window — increment and enforce the ceiling
    entry.count++;
    if (entry.count > max) {
      blocked++;
      return res.status(429).json({ error: message });
    }
    next();
  };

  /** Reset the rate limit counter for a specific IP (or clear all if omitted). */
  rateLimit.reset = function(ip) {
    if (ip) {
      hits.delete(ip);
    } else {
      hits.clear();
    }
  };

  /** Get current statistics for this limiter. */
  rateLimit.getStats = function() {
    let topIP = 'none';
    let topCount = 0;
    for (const [ip, entry] of hits) {
      if (entry.count > topCount) {
        topCount = entry.count;
        topIP = ip;
      }
    }
    return {
      name,
      windowMs,
      max,
      message,
      totalRequests,
      blocked,
      activeIPs: hits.size,
      topIP: topIP === 'none' ? null : { ip: topIP, count: topCount },
    };
  };

  rateLimit.name = name;

  // Register in global registry for stats endpoint
  rateLimitRegistry.push(rateLimit);

  return rateLimit;
}

/**
 * Get stats from all registered rate limiters.
 * @returns {RateLimiterStats[]}
 */
function getAllRateLimiterStats() {
  return rateLimitRegistry.map(l => l.getStats());
}

// ── Global registry of all rate limiter instances ──
/** @type {Array<{name:string, getStats:()=>RateLimiterStats}>} */
const rateLimitRegistry = [];

module.exports = { createRateLimiter, getAllRateLimiterStats };
