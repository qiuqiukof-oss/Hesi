// ── 微信 iLink 协议消息解析回归（2026-08-04）──
// 根因：原实现解析 m.text||m.content，真实协议结构是 item_list[].text_item.text
// → 消息被静默 continue 丢弃 → bot 收到消息但不回复。
// 用官方协议结构（wechatbot.dev / botilink 实现）做回归锁定。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractText } = require('../routes/bots/wechat-bot');

// 官方 getupdates 返回的真实消息结构
const REAL_MSG = {
  seq: 429,
  message_id: 9812451782375,
  from_user_id: 'o9cq800kum_4g8Py8Qw5G0a@im.wechat',
  to_user_id: 'e06c1ceea05e@im.bot',
  context_token: 'AARzJWAFAAABAAAAAAAp2m3u7oE0x7V8Xw==',
  message_type: 1,
  message_state: 2,
  item_list: [{ type: 1, text_item: { text: '帮我总结一下今天的会议纪要。' } }],
};

test('extractText: 官方协议结构（item_list[0].text_item.text）', () => {
  assert.strictEqual(extractText(REAL_MSG), '帮我总结一下今天的会议纪要。');
});

test('extractText: 多 item_list 取第一个文本项', () => {
  const m = { item_list: [{ type: 2, image_item: {} }, { type: 1, text_item: { text: '第二条' } }] };
  assert.strictEqual(extractText(m), '第二条');
});

test('extractText: 异常结构返回空串（不抛错）', () => {
  assert.strictEqual(extractText(null), '');
  assert.strictEqual(extractText({}), '');
  assert.strictEqual(extractText({ item_list: 'nope' }), '');
  assert.strictEqual(extractText({ item_list: [{ type: 99 }] }), '');
});

test('extractText: 旧字段 m.text/m.content 不再依赖（防回退）', () => {
  // 协议结构里没有 m.text/m.content——回归锁定解析必须走 item_list
  const legacyOnly = { text: '旧字段', content: '旧字段', item_list: [] };
  assert.strictEqual(extractText(legacyOnly), '');
});
