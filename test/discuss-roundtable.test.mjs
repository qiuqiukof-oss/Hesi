/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDiscussion, runRoundtable, normalizeTranscript } from '../routes/chat/discuss.js';

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

test('normalizeTranscript 规整 string / 数组 / 空（B4：修复 checkpoint 圆桌丢失前置上下文）', () => {
  assert.equal(normalizeTranscript('hello'), 'hello');
  assert.equal(normalizeTranscript([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), 'a\nb');
  assert.equal(normalizeTranscript([{ content: 'x' }, 'plain']), 'x\nplain');
  assert.equal(normalizeTranscript(null), '');
  assert.equal(normalizeTranscript([]), '');
  assert.equal(normalizeTranscript(undefined), '');
});
