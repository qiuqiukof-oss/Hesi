/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// HTTP Client — shared fetch helpers for MCP tools
//
// Extracted from error.js, registry.js, and browser.js to
// eliminate code duplication. Provides consistent error
// handling, logging, and URL construction for all MCP
// tool HTTP calls.
// ============================================================
const config = require("../config");

/**
 * Try to extract an error message from a failed HTTP response.
 * Handles both JSON error bodies and non-JSON (HTML, plain text) fallbacks.
 * @param {Response} res - fetch Response object
 * @param {string} label - Human-readable label for the fallback message (e.g. "POST /api/foo")
 * @returns {Promise<string>} Extracted error message or status-code fallback
 */
async function tryParseError(res, label) {
  try {
    const data = await res.json();
    if (data && data.error) return data.error;
  } catch { /* response body not JSON — fall through to status fallback */ }
  return `${label} failed: ${res.status}`;
}

/**
 * Fetch a GET endpoint with consistent error handling.
 * Returns parsed JSON on success, or `{ error: msg }` on failure.
 * @param {string} path - API path (e.g. "/clis")
 * @param {string} [logLabel] - Console log label prefix (e.g. "[Registry]")
 * @returns {Promise<object>} Parsed response or error object
 */
async function apiGet(path, logLabel) {
  try {
    const res = await fetch(`${config.apiBase}${path}`);
    if (!res.ok) {
      const msg = await tryParseError(res, `API GET ${path}`);
      if (logLabel) console.error(logLabel, 'apiGet error:', msg);
      return { error: msg };
    }
    return await res.json();
  } catch (err) {
    if (logLabel) console.error(logLabel, 'apiGet error:', err.message);
    return { error: err.message };
  }
}

/**
 * Fetch a POST endpoint with consistent error handling.
 * Returns parsed JSON on success, or `{ error: msg }` on failure.
 * @param {string} path - API path (e.g. "/clis/discover")
 * @param {object} body - Request body (will be JSON-serialized)
 * @param {string} [logLabel] - Console log label prefix
 * @returns {Promise<object>} Parsed response or error object
 */
async function apiPost(path, body, logLabel) {
  try {
    const res = await fetch(`${config.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await tryParseError(res, `API POST ${path}`);
      if (logLabel) console.error(logLabel, 'apiPost error:', msg);
      return { error: msg };
    }
    return await res.json();
  } catch (err) {
    if (logLabel) console.error(logLabel, 'apiPost error:', err.message);
    return { error: err.message };
  }
}

/**
 * Fetch a POST endpoint for browser tools (throws on error for direct use).
 * @param {string} path - API path (e.g. "/browser/navigate")
 * @param {object} body - Request body
 * @returns {Promise<object>} Parsed response
 */
async function apiBrowserPost(path, body) {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await tryParseError(res, `Browser POST ${path}`));
  }
  return res.json();
}

/**
 * Fetch a GET endpoint for browser tools (throws on error for direct use).
 * @param {string} path - API path (e.g. "/browser/ping")
 * @returns {Promise<object>} Parsed response
 */
async function apiBrowserGet(path) {
  const res = await fetch(`${config.apiBase}${path}`);
  if (!res.ok) {
    throw new Error(await tryParseError(res, `Browser GET ${path}`));
  }
  return res.json();
}

module.exports = { tryParseError, apiGet, apiPost, apiBrowserPost, apiBrowserGet };
