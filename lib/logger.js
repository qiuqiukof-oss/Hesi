// @ts-check
// Lightweight, dependency-free rotating file logger.
//
// Hesi logs to stdout by default. This module is OPT-IN: only when
// HESI_LOG_FILE is set does server.js tee console output to a rotating file,
// so existing (stdout-only) behavior is completely unchanged for normal users.
//
// Rotation is size-based: when the active file exceeds maxBytes it is renamed
// to `<file>.1`, the previous `.1` → `.2`, etc., keeping at most maxFiles.
// Writes are synchronous (appropriate for a low-throughput logger) which also
// makes rotation/flush behavior deterministic and easy to test.
'use strict';

const fs = require('fs');
const path = require('path');

class RotatingFileStream {
  /**
   * @param {string} filePath
   * @param {{ maxBytes?: number, maxFiles?: number }} [opts]
   */
  constructor(filePath, opts = {}) {
    this.filePath = filePath;
    this.maxBytes = opts.maxBytes || 5 * 1024 * 1024; // 5MB
    this.maxFiles = opts.maxFiles || 3;
    this._fd = -1;
    this._size = 0;
    this._open();
  }

  _open() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      try { this._size = fs.statSync(this.filePath).size || 0; } catch { this._size = 0; }
      this._fd = fs.openSync(this.filePath, 'a');
    } catch (e) {
      this._fd = -1;
      console.warn('[logger] failed to open log file:', e && e.message);
    }
  }

  write(s) {
    if (this._fd < 0) return;
    const buf = Buffer.from(s);
    if (this._size + buf.length > this.maxBytes) this._rotate();
    try {
      fs.writeSync(this._fd, buf);
      this._size += buf.length;
    } catch { /* ignore */ }
  }

  _rotate() {
    try { if (this._fd >= 0) fs.closeSync(this._fd); } catch { /* ignore */ }
    this._fd = -1;
    // .maxFiles-1 -> .maxFiles (drop the oldest), shifting each down.
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      const dst = `${this.filePath}.${i}`;
      try { if (fs.existsSync(src)) fs.renameSync(src, dst); } catch { /* ignore */ }
    }
    this._open();
  }

  close() {
    try { if (this._fd >= 0) fs.closeSync(this._fd); } catch { /* ignore */ }
    this._fd = -1;
  }
}

function fmtArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}

/**
 * Tee console output to a rotating file. Only call this when file logging is
 * desired (guarded by HESI_LOG_FILE in server.js). Returns a restore fn.
 * @returns {() => void}
 */
function teeConsole(filePath, opts = {}) {
  const stream = new RotatingFileStream(filePath, opts);
  const orig = {
    log: console.log, info: console.info, warn: console.warn, error: console.error,
  };
  const stamp = () => new Date().toISOString();
  const wrap = (origFn, level) => (...args) => {
    origFn.apply(console, args);
    try {
      stream.write(`[${stamp()}] [${level}] ${args.map(fmtArg).join(' ')}\n`);
    } catch { /* ignore */ }
  };
  console.log = wrap(orig.log, 'log');
  console.info = wrap(orig.info, 'info');
  console.warn = wrap(orig.warn, 'warn');
  console.error = wrap(orig.error, 'error');
  return () => {
    console.log = orig.log; console.info = orig.info;
    console.warn = orig.warn; console.error = orig.error;
    stream.close();
  };
}

module.exports = { RotatingFileStream, teeConsole };
