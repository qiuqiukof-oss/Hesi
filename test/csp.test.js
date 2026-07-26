// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const helmet = require('helmet');
const csp = require('../lib/csp');

test('CSP config builds a helmet middleware that emits a CSP header', () => {
  const mw = helmet(csp);
  let cspHeader = null;
  const res = {
    setHeader(k, v) { if (String(k).toLowerCase() === 'content-security-policy') cspHeader = v; },
    removeHeader() {},
    getHeader() { return null; },
    locals: {},
  };
  mw({}, res, () => {});
  assert.ok(cspHeader, 'Content-Security-Policy header is set');
  assert.match(cspHeader, /default-src 'self'/);
  assert.match(cspHeader, /script-src[^;]*'unsafe-inline'/);
  assert.match(cspHeader, /style-src[^;]*'unsafe-inline'/);
  assert.match(cspHeader, /frame-ancestors 'self'/); // helmet frameguard
});
