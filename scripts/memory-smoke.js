// @ts-check
// Memory subsystem smoke test — exercises the full backend chain:
//   ensure → append → list → recall → getSummaryBlock → remove
// Writes to an ephemeral temp dir (HESI_MEMORY_DIR) so it never touches the
// real data/memory. Run: `node scripts/memory-smoke.js`
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Point the subsystem at a throwaway dir BEFORE requiring it.
if (!process.env.HESI_MEMORY_DIR) {
  process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-mem-smoke-'));
}

const MemoryStore = require('../lib/memory');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${  msg}`);
}

(async () => {
  // 1. create + append
  const id = `s_smoke_${  Date.now().toString(36)}`;
  MemoryStore.ensure(id, { title: 'Hesi 记忆功能测试', model: 'gpt-4o-mini', provider: 'openai' });
  await MemoryStore.append(id, [
    { id: 'm1', role: 'user', content: '我想给 Hesi 加一个跨会话记忆功能，能记住用户偏好。' },
    { id: 'm2', role: 'assistant', content: '好的，可以用 BM25 做本地检索，无需云服务。' },
  ]);

  // 2. get round-trips
  const got = MemoryStore.get(id);
  assert(got && got.messages.length === 2, 'append should persist 2 messages');
  assert(got.tokenEstimate > 0, 'tokenEstimate should be computed');

  // 3. idempotent re-append (same ids) does not duplicate
  await MemoryStore.append(id, [
    { id: 'm1', role: 'user', content: '我想给 Hesi 加一个跨会话记忆功能，能记住用户偏好。' },
  ]);
  assert(MemoryStore.get(id).messages.length === 2, 're-append must be idempotent');

  // 4. list shows it
  const list = MemoryStore.list({});
  assert(list.length >= 1 && list[0].id === id, 'list should include the session');

  // 5. recall finds the session by query
  const block = MemoryStore.recall('Hesi 记忆');
  assert(block && block.role === 'system' && block.content.includes('Hesi 记忆功能测试'),
    'recall should surface the session title for a related query');

  // 6. summary block is null before compaction
  assert(MemoryStore.getSummaryBlock(id) === null, 'no summary block before compaction');

  // 7. search filters
  const filtered = MemoryStore.list({ q: '不存在的关键词xyz' });
  assert(filtered.length === 0, 'search should filter out non-matching sessions');

  // 8. cleanup
  MemoryStore.remove(id);
  assert(MemoryStore.get(id) === null, 'remove should delete the session');

  console.log('[memory-smoke] PASS — full backend chain OK');
  process.exit(0);
})().catch((err) => {
  console.error('[memory-smoke] FAIL:', err);
  process.exit(1);
});
