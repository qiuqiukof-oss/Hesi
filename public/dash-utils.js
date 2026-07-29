/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Dashboard Utilities — Pure helper functions
// ============================================================

// escapeHtml lives in the canonical ./escape.js module; re-exported here
// so existing `import { escapeHtml } from './dash-utils.js'` sites keep working.
export { escapeHtml } from './escape.js';

/** Set text content with null-safety */
export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/** Sanitize an ID string for use as a DOM/CSS identifier */
export function _safeId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Format seconds into human-readable duration */
export function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return mins + 'm ' + secs + 's';
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return hrs + 'h ' + remainMins + 'm';
}

/** Format bytes into human-readable string */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return (i === 0 ? bytes : val.toFixed(1)) + ' ' + units[i];
}
