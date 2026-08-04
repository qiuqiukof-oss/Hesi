/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for routes/bots (通讯接入 A · 机器人模式) — M0 框架：
//   - adapter.normalizeInbound / buildChatRequest 统一 schema
//   - dispatch.buildRequest 派发体结构
//   - qq.eventToInbound @ 消息剥离 / chatType 透传
//   - index.js fail-closed：未配置平台不注册路由、/bots 列表 configured=false
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeInbound } = require('../routes/bots/adapter');
const { buildRequest } = require('../routes/bots/dispatch');
const qq = require('../routes/bots/qq');
const { toInbound } = require('../routes/bots/index');

test('adapter.normalizeInbound: 统一 schema 字段齐全', () => {
  const inbound = normalizeInbound('qq', { chatId: 'g-1', userId: 'u-1', text: '  hello  ', replyToken: 'rt' });
  assert.strictEqual(inbound.platform, 'qq');
  assert.strictEqual(inbound.chatId, 'g-1');
  assert.strictEqual(inbound.userId, 'u-1');
  assert.strictEqual(inbound.text, 'hello'); // 去首尾空白
  assert.strictEqual(inbound.replyToken, 'rt');
});

test('adapter.normalizeInbound: 缺 chatId/text 抛错（fail-closed）', () => {
  assert.throws(() => normalizeInbound('qq', { chatId: '', text: 'x' }), /chatId or text/);
  assert.throws(() => normalizeInbound('qq', { chatId: 'g', text: '  ' }), /chatId or text/);
  assert.throws(() => normalizeInbound('qq', null), /non-object/);
});

test('dispatch.buildRequest: 组装 /api/chat body（默认 bot 会话 id）——生产单一来源', () => {
  const inbound = normalizeInbound('qq', { chatId: 'g-1', text: '跑测试' });
  const body = buildRequest(inbound);
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: '跑测试' }]);
  assert.strictEqual(body.sessionId, 'bot:qq:g-1');
  assert.strictEqual(body.planMode, false);
  // 自定义 sessionId/provider/planMode
  const body2 = buildRequest(inbound, { sessionId: 'custom', provider: 'deepseek', planMode: true });
  assert.strictEqual(body2.sessionId, 'custom');
  assert.strictEqual(body2.provider, 'deepseek');
  assert.strictEqual(body2.planMode, true);
});

test('dispatch.collectSseReply: 从 SSE 流收集 token 正文', async () => {
  const { collectSseReply } = require('../routes/bots/dispatch');
  // 构造一个假的 SSE 响应流（fetch 返回的 Response.body）
  const sseText = 'data: {"type":"token","content":"你好"}\n\n'
    + 'data: {"type":"token","content":"，世界"}\n\n'
    + 'data: {"type":"status","message":"ok"}\n\n'
    + 'data: [DONE]\n\n';
  const fakeRes = { body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sseText)); c.close(); } }) };
  const reply = await collectSseReply(fakeRes);
  assert.strictEqual(reply, '你好，世界');
});

test('dispatch.collectSseReply: 空流回退"已受理"', async () => {
  const { collectSseReply } = require('../routes/bots/dispatch');
  const fakeRes = { body: new ReadableStream({ start(c) { c.close(); } }) };
  const reply = await collectSseReply(fakeRes);
  assert.strictEqual(reply, '✅ 已受理');
});

test('dispatch.buildRequest: 与 adapter 一致（循环依赖解耦）', () => {
  const inbound = normalizeInbound('qq', { chatId: 'g-1', text: 'hi' });
  const body = buildRequest(inbound, { planMode: true });
  assert.strictEqual(body.planMode, true);
  assert.strictEqual(body.sessionId, 'bot:qq:g-1');
});

test('qq.eventToInbound: 剥离 @ 前缀 + chatType 透传', () => {
  const inbound = qq.eventToInbound({
    content: '<@!123456> 你好世界',
    chat_type: 2,
    group_openid: 'GROUP_OPENID',
    author: { user_openid: 'USER_OPENID' },
  });
  assert.strictEqual(inbound.text, '你好世界');
  assert.strictEqual(inbound.chatId, 'GROUP_OPENID');
  assert.strictEqual(inbound.userId, 'USER_OPENID');
  assert.strictEqual(inbound.chatType, 2);
});

test('qq.eventToInbound: c2c 私聊用 openid 作 chatId', () => {
  const inbound = qq.eventToInbound({ content: '私聊', chat_type: 1, openid: 'C2C_OPENID' });
  assert.strictEqual(inbound.chatId, 'C2C_OPENID');
});

test('qq.verifyWebhook: 未实现验签前 fail-closed 拒绝', () => {
  assert.strictEqual(qq.verifyWebhook({}), false);
});

test('index.toInbound: 平台事件 → 统一 inbound', () => {
  const inbound = toInbound('qq', { content: '测试', chat_type: 2, group_openid: 'g' });
  assert.strictEqual(inbound.platform, 'qq');
  assert.strictEqual(inbound.text, '测试');
});

test('index.toInbound: 未知平台抛错', () => {
  assert.throws(() => toInbound('unknown', { content: 'x' }), /unknown platform/);
});
