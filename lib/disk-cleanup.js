// @ts-check
// Disk lifecycle helpers — clean up directories that grow unbounded.
//
// The main offender is data/cdp-profile: the Playwright/Edge automation user
// profile, which can balloon to hundreds of MB and is regenerated on demand.
// We remove it when it looks stale (not written to in a while), so a live
// browser session is never disrupted, but long-idle leftovers are reclaimed.
'use strict';

const fs = require('fs');
const path = require('path');

const CDP_PROFILE_DIR = path.join(__dirname, '..', 'data', 'cdp-profile');

/**
 * Remove a directory only if it exists and hasn't been written to recently
 * (heuristic for "not in use by a live process"). Best-effort; never throws.
 * @param {string} dir
 * @param {{ staleGraceMs?: number }} [opts]
 * @returns {boolean} true if a removal was attempted & succeeded
 */
function removeDirIfStale(dir, opts = {}) {
  const staleGraceMs = opts.staleGraceMs == null ? 60000 : opts.staleGraceMs;
  if (!fs.existsSync(dir)) return false;
  try {
    const age = Date.now() - fs.statSync(dir).mtimeMs;
    if (age < staleGraceMs) return false; // likely in use by a running process
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch (e) {
    console.warn('[cleanup] removal skipped for', dir, ':', e && e.message);
    return false;
  }
}

/** Remove the cdp-profile dir when it looks stale. */
function removeCdpProfile(opts) {
  return removeDirIfStale(CDP_PROFILE_DIR, opts);
}

module.exports = { removeDirIfStale, removeCdpProfile, CDP_PROFILE_DIR };
