/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Bot Adapter — unified inbound/outbound schema for bot platforms
//
// 统一适配层（通讯接入 A · 机器人模式）：
// 平台差异（签名校验/消息格式/发送方式）全部收敛到各自的 <platform>.js，
// 本模块只负责「平台无关」的消息规范化与任务组装。
//
// inbound 统一结构：
//   { platform, chatId, userId, text, raw, replyToken?, provider? }
//   - replyToken：需要「一次回复令牌」的平台（如飞书/企微回调）用，用于回传；
//   - provider：可选，指定用哪个 LLM provider（默认走系统默认）。
// ============================================================

/**
 * 把平台原始事件规范化为统一 inbound 消息。
 * 校验失败抛错（fail-closed：签名/结构异常拒绝）。
 * 额外字段（chatType 等平台语义）通过第三参透传，供出站发送时消费。
 * @param {string} platform — 'qq' | 'wecom' | 'feishu' | 'dingtalk' | 'wechat-bot'
 * @param {object} event — 平台原始事件
 * @param {object} [extra] — 需要随 inbound 透传的平台字段（如 { chatType }）
 * @returns {{ platform: string, chatId: string, userId: string, text: string, raw: object, replyToken?: string, chatType?: number }}
 */
function normalizeInbound(platform, event, extra = {}) {
  if (!event || typeof event !== 'object') {
    throw new Error('bot: invalid inbound event (non-object)');
  }
  const chatId = String(event.chatId || event.from_group || event.open_id || event.conversation_id || '');
  const userId = String(event.userId || event.from_user || event.sender_id || event.user_openid || '');
  const text = String(event.text || event.content || event.message || '').trim();
  if (!chatId || !text) {
    throw new Error('bot: inbound event missing chatId or text');
  }
  return {
    platform,
    chatId,
    userId,
    text,
    raw: event,
    replyToken: event.replyToken || undefined,
    ...(extra.chatType !== undefined ? { chatType: extra.chatType } : {}),
  };
}

/**
 * 把统一 inbound 消息组装为内部派发任务（直接复用 /api/chat 的请求体结构）。
 * @param {object} inbound — normalizeInbound 的输出
 * @param {{ model?: string, provider?: string, apiKey?: string, planMode?: boolean, sessionId?: string }} [opts]
 * @returns {object} 可直接 POST /api/chat 的 body
 */
function buildChatRequest(inbound, opts = {}) {
  return {
    messages: [
      { role: 'user', content: inbound.text },
    ],
    model: opts.model,
    provider: opts.provider || inbound.provider,
    apiKey: opts.apiKey,
    planMode: opts.planMode === true,
    sessionId: opts.sessionId || `bot:${inbound.platform}:${inbound.chatId}`,
  };
}

/**
 * 把内部结果规范化为统一 outbound 结构。
 * @param {string} platform
 * @param {string} chatId
 * @param {string} text — 回传给用户的正文
 * @param {{ raw?: object, replyToken?: string }} [extra]
 * @returns {{ platform: string, chatId: string, text: string, raw?: object, replyToken?: string }}
 */
function normalizeOutbound(platform, chatId, text, extra = {}) {
  return {
    platform,
    chatId,
    text,
    raw: extra.raw,
    replyToken: extra.replyToken,
  };
}

module.exports = {
  normalizeInbound,
  buildChatRequest,
  normalizeOutbound,
};
