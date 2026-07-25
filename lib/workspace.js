// @ts-check
// ============================================================
// Global workspace directory — single source of truth for:
//   - default cwd of newly spawned terminals (ws-handler.js / ws/pty.js)
//   - default cwd of AI tool exec / file ops (routes/tools.js)
// Settable at runtime via POST /api/workspace (requires token on non-loopback).
// ============================================================
const path = require('path');
const fs = require('fs');

/** @type {string} */
let _workspace = process.cwd();

/**
 * @returns {string} absolute current workspace directory
 */
function getWorkspace() {
  return _workspace;
}

/**
 * Set the global workspace directory.
 * @param {string} dir - directory path (absolute or relative to cwd)
 * @returns {string} absolute resolved, validated path
 * @throws {Error} if dir does not exist or is not a directory
 */
function setWorkspace(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('workspace directory is required');
  }
  const abs = path.resolve(dir);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    throw new Error(`workspace directory does not exist: ${  abs}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`workspace path is not a directory: ${  abs}`);
  }
  _workspace = abs;
  return abs;
}

module.exports = { getWorkspace, setWorkspace };
