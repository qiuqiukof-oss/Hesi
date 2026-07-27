// @ts-check
// P1 S2 — tokenEstimate 修正：compaction 优先用 contextEstimate（含 system+记忆+
// 技能+历史+工具+附件），并以模型名派生动态压缩阈值；旧 session 回落 v0.3.1 行为。
//
// 存储隔离方式与 memory-compaction.test.js 一致：在 require lib/memory 之前设置
// HESI_MEMORY_DIR 临时目录并清缓存，确保 session 落盘路径可控、跨文件不互相污染。
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 必须在 require lib/memory 之前设置，否则 config.SESSIONS_DIR 已在加载时固定。
process.env.HESI_MEMORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-ctx-est-'));
for (const k of Object.keys(require.cache)) {
  if (k.includes(`lib${path.sep}memory`)) delete require.cache[k];
}

const { test } = require('node:test');
const assert = require('node:assert');
const compaction = require('../lib/memory/compaction');
const session = require('../lib/memory/session');

function makeSession(over = {}) {
  return Object.assign(
    { messages: [], workingWindow: 24, summaryUpdatedAt: 0, updatedAt: 0 },
    over,
  );
}

test('shouldCompact prefers contextEstimate over tokenEstimate', () => {
  // contextEstimate 70000 > 60000 → true；若误用 tokenEstimate(1000) 则 false → 证明优先
  assert.strictEqual(
    compaction.shouldCompact(makeSession({ tokenEstimate: 1000, contextEstimate: 70000 })),
    true,
  );
  // 反之 contextEstimate 低、tokenEstimate 高 → 用 contextEstimate → false
  assert.strictEqual(
    compaction.shouldCompact(makeSession({ tokenEstimate: 70000, contextEstimate: 1000 })),
    false,
  );
});

test('shouldCompact legacy fallback: no contextEstimate uses tokenEstimate (v0.3.1 behavior)', () => {
  // 旧 session 无 contextEstimate 字段，70000 > 60000 → true（与现状一致）
  assert.strictEqual(compaction.shouldCompact(makeSession({ tokenEstimate: 70000 })), true);
  assert.strictEqual(compaction.shouldCompact(makeSession({ tokenEstimate: 1000 })), false);
});

test('shouldCompact uses model-name-derived threshold (small model compresses earlier)', () => {
  // qwen2.5-7b → 窗口 48000 → 阈值 24000；est=30000 → true
  assert.strictEqual(
    compaction.shouldCompact(makeSession({ tokenEstimate: 30000, contextEstimate: 0, model: 'qwen2.5-7b' })),
    true,
  );
  // 同 est，但无模型映射（兜底 200000→阈值 60000）→ 30000 < 60000 → false
  assert.strictEqual(
    compaction.shouldCompact(makeSession({ tokenEstimate: 30000, contextEstimate: 0, model: undefined })),
    false,
  );
});

test('setContextEstimate / setModel persist via session', async () => {
  const id = 's_test_ctx_s2';
  // append / setContextEstimate 经 withLock 异步落盘，必须 await 后再读取
  await session.append(id, [{ role: 'user', content: 'hello world' }], { model: 'qwen2.5-7b' });
  await session.setContextEstimate(id, 50000);
  const loaded = session.load(id);
  assert.ok(loaded, 'session persisted');
  assert.strictEqual(loaded.contextEstimate, 50000, 'contextEstimate written back');
  assert.strictEqual(loaded.model, 'qwen2.5-7b', 'model recorded from meta');
  // 非法值不覆盖既有有效值
  await session.setContextEstimate(id, -5);
  assert.strictEqual(session.load(id).contextEstimate, 50000, 'invalid value falls back to previous');
});
