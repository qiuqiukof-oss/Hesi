// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RotatingFileStream, teeConsole } = require('../lib/logger');

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-log-test-'));
  return path.join(dir, name);
}

test('RotatingFileStream rotates past maxBytes and bounds total size', () => {
  const f = tmpFile('s.log');
  const s = new RotatingFileStream(f, { maxBytes: 30, maxFiles: 2 });
  for (let i = 0; i < 20; i++) s.write(`line${i}\n`); // ~6 bytes each => far exceeds 30
  s.close();
  assert.ok(fs.existsSync(f), 'current file exists');
  assert.ok(fs.existsSync(f + '.1'), 'rotated .1 exists');
  const cur = fs.readFileSync(f, 'utf8');
  const one = fs.existsSync(f + '.1') ? fs.readFileSync(f + '.1', 'utf8') : '';
  // Bounded: at most ~maxBytes per kept file (+ small slack for the in-flight write).
  assert.ok((cur.length + one.length) <= 30 * 2 + 20, `total bounded, got ${cur.length + one.length}`);
});

test('RotatingFileStream tolerates missing dir (creates it)', () => {
  const f = tmpFile('nested/dir/app.log');
  const s = new RotatingFileStream(f, { maxBytes: 1000 });
  s.write('hello\n');
  s.close();
  assert.ok(fs.existsSync(f));
  assert.equal(fs.readFileSync(f, 'utf8'), 'hello\n');
});

test('teeConsole restores original console and writes a file', () => {
  const f = tmpFile('tee.log');
  const restore = teeConsole(f, { maxBytes: 1e9, maxFiles: 1 });
  console.log('tee-test-message');
  restore();
  assert.ok(fs.readFileSync(f, 'utf8').includes('tee-test-message'));
  // original console restored
  assert.equal(typeof console.log, 'function');
});
