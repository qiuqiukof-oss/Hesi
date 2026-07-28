// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDiscussion, runRoundtable } from '../routes/chat/discuss.js';

test('discuss 导出 runDiscussion 与 runRoundtable（纯函数可复用）', () => {
  assert.equal(typeof runDiscussion, 'function');
  assert.equal(typeof runRoundtable, 'function');
});

test('runRoundtable 无 API Key 时安全返回（不抛、不调用 LLM）', async () => {
  const events = [];
  const res = await runRoundtable({
    message: 'test',
    partners: ['some-agent'],
    apiKey: '', // 未配置
    onEvent: (t, p) => events.push({ t, p }),
  });
  assert.equal(res.cleanFinish, false);
  assert.equal(res.summary, '');
  assert.ok(events.some((e) => e.t === 'error'));
});
