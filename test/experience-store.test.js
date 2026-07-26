// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-exp-'));
process.env.HESI_MEMORY_DIR = tmp;
process.env.HESI_EXP_MAX = '5';
// Reload config + store against the temp dir so we don't touch real data.
delete require.cache[require.resolve('../lib/memory/config')];
delete require.cache[require.resolve('../lib/experience/store')];
const store = require('../lib/experience/store');

function readExp() {
  // store.js puts experience.json at dirname(SESSIONS_DIR) = HESI_MEMORY_DIR.
  return JSON.parse(fs.readFileSync(path.join(tmp, 'experience.json'), 'utf8'));
}

test('cap is tunable and evicts low-hit entries, keeping high-hit ones', () => {
  store.recordFailure('git', { a: 2 }, 'permission denied');
  store.recordFailure('git', { a: 3 }, 'network timeout');
  store.recordFailure('git', { a: 1 }, 'ENOENT file not found'); // recorded last
  // An experience only helps once a fix is recorded (findSimilar requires a fix).
  // recordFix attaches to the most-recent unfixed entry of that tool => the ENOENT one.
  store.recordFix('git', 'ENOENT', 'create the file/dir first');

  // Register a hit on the ENOENT entry (simulate the AI being helped by it).
  const hits = store.findSimilar('git', 'ENOENT file not found');
  assert.ok(hits.length >= 1, 'findSimilar matched the ENOENT failure');

  // Overflow the cap (5) with fresh, never-hit entries.
  for (let i = 0; i < 10; i++) store.recordFailure('x', { i }, 'err' + i);

  const data = readExp();
  assert.ok(data.entries.length <= 5, `capped at 5, got ${data.entries.length}`);

  const survived = data.entries.find((e) => e.tool === 'git' && /ENOENT/.test(e.error));
  assert.ok(survived, 'high-hit git/ENOENT entry survived eviction');
  assert.ok((survived.hitCount || 0) >= 1, 'hit count recorded');
});

test('findSimilar returns [] when experience disabled', () => {
  const prev = process.env.HESI_EXPERIENCE;
  process.env.HESI_EXPERIENCE = '0';
  assert.deepEqual(store.findSimilar('git', 'anything'), []);
  if (prev === undefined) delete process.env.HESI_EXPERIENCE; else process.env.HESI_EXPERIENCE = prev;
});
