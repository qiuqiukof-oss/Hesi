// @ts-check
// archive.remove() must also drop the <id>.ckpt.json rollback checkpoint
// shadow so it doesn't orphan inside SESSIONS_DIR after a session is deleted.
// Isolated to an ephemeral dir via HESI_MEMORY_DIR.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the subsystem to a temp dir BEFORE requiring it.
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-archive-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(path.join('lib', 'memory'))) delete require.cache[k];
}
const MemoryStore = require('../lib/memory');
const config = require('../lib/memory/config');

test('archive.remove also deletes the rollback checkpoint shadow', () => {
  const id = 's_ckpt_' + Date.now().toString(36);
  MemoryStore.ensure(id, { title: 'ckpt-cleanup' });
  MemoryStore.checkpoint(id); // writes <id>.ckpt.json

  const ckpt = path.join(config.SESSIONS_DIR, `${id}.ckpt.json`);
  assert.ok(fs.existsSync(ckpt), 'checkpoint should exist before removal');

  const ok = MemoryStore.remove(id);
  assert.strictEqual(ok, true, 'remove should succeed');
  assert.ok(!fs.existsSync(ckpt), 'checkpoint shadow must be deleted on remove');
  assert.ok(
    !fs.existsSync(path.join(config.SESSIONS_DIR, `${id}.json`)),
    'session file should be removed from SESSIONS_DIR'
  );
  // Soft-delete keeps the session recoverable in trash.
  assert.ok(
    MemoryStore.listTrash().some((t) => t.id === id),
    'session should be recoverable in trash after remove'
  );
});

test('archive.remove is a no-op (false) for a missing session', () => {
  const id = 's_missing_' + Date.now().toString(36);
  assert.strictEqual(MemoryStore.remove(id), false, 'remove of unknown id returns false');
});
