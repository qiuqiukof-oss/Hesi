/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// 优化方向.md 第 2/3/4/5 步的单测：Anthropic 拆块缓存、CLI 输入压缩、budget 守卫、usage 兼容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDiscussion, runRoundtable, normalizeTranscript,
  splitTranscriptRounds, buildAnthropicDiscussBlocks, compactTranscriptForCli, buildCliTask,
  budgetExceeded, usageFields,
} from '../routes/chat/discuss.js';

// ── splitTranscriptRounds：按「第N轮」拆块 ──────────────────────────────
test('splitTranscriptRounds：按轮切块，前置上下文为独立首段', () => {
  const transcript = [
    '【前置上下文】\n上游已定方向',
    '【第1轮 · AI 助手】\n首轮发言',
    '【第1轮 · opencode】\n回应',
    '【第2轮 · AI 助手】\n第二轮发言',
  ].join('\n');
  const segs = splitTranscriptRounds(transcript);
  assert.equal(segs.length, 4);
  assert.match(segs[0], /前置上下文/);
  assert.match(segs[1], /第1轮 · AI 助手/);
  assert.match(segs[2], /第1轮 · opencode/);
  assert.match(segs[3], /第2轮 · AI 助手/);
});

test('splitTranscriptRounds：空/无轮标记时安全', () => {
  assert.deepEqual(splitTranscriptRounds(null), []);
  assert.deepEqual(splitTranscriptRounds(''), []);
  assert.deepEqual(splitTranscriptRounds('没有轮标记的纯文本'), ['没有轮标记的纯文本']);
});

// ── buildAnthropicDiscussBlocks：边界块 cache_control + 前缀稳定 ──────
test('buildAnthropicDiscussBlocks：最后一条 transcript 块打 cache_control（可命中前缀缓存）', () => {
  const transcript = '【第1轮 · AI 助手】\na\n【第1轮 · opencode】\nb';
  const blocks = buildAnthropicDiscussBlocks('问题', transcript, true);
  // question 头 + 2 个轮块 + 指令尾 = 4 块
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /【用户原问题】问题/);
  // cache_control 落在倒数第二块 = 最后一条 transcript 块（非指令尾）
  assert.deepEqual(blocks[2].cache_control, { type: 'ephemeral' });
  // 其余块不打 breakpoint
  assert.equal(blocks[0].cache_control, undefined);
  assert.equal(blocks[1].cache_control, undefined);
  assert.equal(blocks[3].cache_control, undefined);
});

test('buildAnthropicDiscussBlocks：前缀逐轮稳定增长（缓存命中前提）', () => {
  const t1 = '【第1轮 · AI 助手】\n第一轮';
  const t2 = '【第1轮 · AI 助手】\n第一轮\n【第1轮 · opencode】\n回应\n【第2轮 · AI 助手】\n第二轮';
  const b1 = buildAnthropicDiscussBlocks('同一个问题', t1, true);
  const b2 = buildAnthropicDiscussBlocks('同一个问题', t2, true);
  // 第 1 轮请求：question 头 + 1 段 + 指令尾 = 3 块 → cache_control 在 index 1
  assert.equal(b1.length, 3);
  assert.deepEqual(b1[1].cache_control, { type: 'ephemeral' });
  // 第 2 轮请求：question 头 + 3 段 + 指令尾 = 5 块 → cache_control 在 index 3（最后一条 transcript 块）
  assert.equal(b2.length, 5);
  assert.deepEqual(b2[3].cache_control, { type: 'ephemeral' });
  // 前缀逐轮稳定：question 头与第 1 段完全一致
  assert.equal(b1[0].text, b2[0].text);
  assert.equal(b1[1].text, b2[1].text);
});

test('buildAnthropicDiscussBlocks：首轮（无 transcript）不打 cache_control', () => {
  const blocks = buildAnthropicDiscussBlocks('问题', '', true);
  assert.equal(blocks.length, 2); // 只有 question 头 + 指令尾
  assert.equal(blocks[0].cache_control, undefined);
});

test('buildAnthropicDiscussBlocks：HESI_PROMPT_CACHE=0 时禁用缓存', () => {
  const transcript = '【第1轮 · AI 助手】\na';
  const blocks = buildAnthropicDiscussBlocks('问题', transcript, false);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].cache_control, undefined);
});

// ── compactTranscriptForCli：早期压缩摘要 + 最近 2 轮逐字 ──────────────
test('compactTranscriptForCli：≤2 轮时原样返回（不压缩）', () => {
  const t = '【第1轮 · AI 助手】\n第一轮';
  assert.equal(compactTranscriptForCli(t), t);
  assert.equal(compactTranscriptForCli(null), '');
});

test('compactTranscriptForCli：>2 轮时早期轮次压缩，最近 2 轮逐字保留', () => {
  const early = '【第1轮 · AI 助手】\n' + 'x'.repeat(400);
  const recent2 = '【第2轮 · AI 助手】\n第二轮完整';
  const recent3 = '【第3轮 · AI 助手】\n第三轮完整';
  const t = [early, recent2, recent3].join('\n');
  const out = compactTranscriptForCli(t);
  // 摘要头 + 压缩轮 + 最近 2 轮
  assert.match(out, /【早期轮次摘要（1 轮，已压缩）】/);
  assert.match(out, /第二轮完整/);
  assert.match(out, /第三轮完整/);
  // 早期长轮被确定性截断（零 LLM 成本）：完整 400 字符被截掉，只留 240 字符窗口
  assert.ok(!out.includes('x'.repeat(400)));
  assert.ok(out.includes('x'.repeat(200)));
  assert.match(out, /…$/m);
});

test('compactTranscriptForCli：压缩后仍含 AI 最后一段发言（CLI 回应有上下文）', () => {
  const t = [
    '【第1轮 · AI 助手】\n早期',
    '【第1轮 · opencode】\n早期回应',
    '【第2轮 · AI 助手】\nAI 最新观点',
    '【第2轮 · opencode】\nopencode 最新',
  ].join('\n');
  const out = compactTranscriptForCli(t);
  assert.match(out, /AI 最新观点/);
  assert.match(out, /opencode 最新/);
});

// ── buildCliTask：仍为纯函数（含压缩后的 transcript）──────────────────
test('buildCliTask：包含 persona/protocol/压缩后记录（结构不回归）', () => {
  const task = buildCliTask({
    question: 'Q',
    transcript: '【第1轮 · AI 助手】\na',
    round: 2,
    persona: { name: '审稿人', role: '审查', viewpoint: '严格' },
    protocol: '先质疑后建议',
  });
  assert.match(task, /第 2 轮/);
  assert.match(task, /审稿人/);
  assert.match(task, /先质疑后建议/);
  assert.match(task, /第1轮 · AI 助手/);
});

// ── budgetExceeded：token / 时长预算守卫 ───────────────────────────────
test('budgetExceeded：maxTokens 超限触发', () => {
  assert.equal(budgetExceeded({ maxTokens: 1000 }, 999, 0), false);
  assert.equal(budgetExceeded({ maxTokens: 1000 }, 1000, 0), true);
  assert.equal(budgetExceeded({ maxTokens: 1000 }, 1500, 0), true);
});

test('budgetExceeded：maxMinutes 超时触发', () => {
  assert.equal(budgetExceeded({ maxMinutes: 1 }, 0, 59_000), false);
  assert.equal(budgetExceeded({ maxMinutes: 1 }, 0, 60_000), true);
  assert.equal(budgetExceeded({ maxMinutes: 1 }, 0, 61_000), true);
});

test('budgetExceeded：0/缺省 = 不限', () => {
  assert.equal(budgetExceeded({}, 999999, 99999999), false);
  assert.equal(budgetExceeded(null, 999999, 99999999), false);
  assert.equal(budgetExceeded({ maxTokens: 0, maxMinutes: 0 }, 999999, 99999999), false);
});

// ── usageFields：Anthropic / OpenAI 两套 usage 兼容 ─────────────────────
test('usageFields：Anthropic 字段（input/output/cache_read）', () => {
  const f = usageFields({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 });
  assert.deepEqual(f, { input: 100, output: 20, cacheRead: 80 });
});

test('usageFields：OpenAI 字段（prompt/completion/cached_tokens）', () => {
  const f = usageFields({ prompt_tokens: 200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 150 } });
  assert.deepEqual(f, { input: 200, output: 30, cacheRead: 150 });
});

test('usageFields：null/缺字段安全', () => {
  assert.equal(usageFields(null), null);
  assert.deepEqual(usageFields({}), { input: 0, output: 0, cacheRead: 0 });
});

// ── 集成回归：runRoundtable 无 API Key 仍安全（预算/统计改动不回归）──
test('runRoundtable 无 API Key 时安全返回（改动后不回归）', async () => {
  const events = [];
  const res = await runRoundtable({
    message: 'test',
    partners: ['some-agent'],
    apiKey: '',
    budget: { maxTokens: 1000 },
    onEvent: (t, p) => events.push({ t, p }),
  });
  assert.equal(res.cleanFinish, false);
  assert.equal(res.summary, '');
  assert.ok(events.some((e) => e.t === 'error'));
});

test('discuss 导出新增纯函数（供测试与复用）', () => {
  assert.equal(typeof splitTranscriptRounds, 'function');
  assert.equal(typeof buildAnthropicDiscussBlocks, 'function');
  assert.equal(typeof compactTranscriptForCli, 'function');
  assert.equal(typeof budgetExceeded, 'function');
  assert.equal(typeof usageFields, 'function');
});
