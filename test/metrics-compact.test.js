// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordCompact, EMPTY } = require('../routes/chat/metrics');

test('recordCompact: null cr returns metrics untouched', () => {
  const m = { cacheReadTokens: 10 };
  assert.equal(recordCompact(m, null), m, 'same reference returned');
  assert.equal(m.compactCount, undefined);
});

test('recordCompact: non-compacted cr (no .compacted) returns metrics untouched', () => {
  const m = { cacheReadTokens: 10 };
  const cr = { compacted: false, dropped: 5 };
  assert.equal(recordCompact(m, cr), m);
  assert.equal(m.compactCount, undefined);
});

test('recordCompact: compacted cr with no prior metrics seeds a fresh object', () => {
  const out = recordCompact(undefined, { compacted: true, dropped: 8 });
  assert.equal(out.compactCount, 1);
  assert.equal(out.compactedMsgs, 8);
  // EMPTY baseline fields are present for downstream tooling
  assert.equal(out.cacheReadTokens, 0);
});

test('recordCompact: compacted cr merges into existing metrics', () => {
  const m = { cacheReadTokens: 100, compactCount: 2, compactedMsgs: 3 };
  const out = recordCompact(m, { compacted: true, dropped: 4 });
  assert.equal(out.cacheReadTokens, 100, 'prior fields preserved');
  assert.equal(out.compactCount, 3, 'count incremented');
  assert.equal(out.compactedMsgs, 7, 'dropped accumulated');
});

test('recordCompact: cr.dropped falsy => compactedMsgs stays 0', () => {
  const out = recordCompact(undefined, { compacted: true });
  assert.equal(out.compactCount, 1);
  assert.equal(out.compactedMsgs, 0);
});

test('recordCompact: does not mutate a passed EMPTY constant', () => {
  const before = { ...EMPTY };
  recordCompact(EMPTY, { compacted: true, dropped: 2 });
  assert.deepEqual(EMPTY, before, 'EMPTY must remain pristine');
});
