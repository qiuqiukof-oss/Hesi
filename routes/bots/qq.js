/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// QQ Bot Adapter — 示范平台（通讯接入 A · M1）
//
// 对接 QQ 官方开放平台机器人（appid + secret，WebSocket 长连接收消息 / HTTP 发消息）。
// 注意：QQ 机器人官方接入以「实施时最新文档」为准——目前主流是：
//   - 收消息：WebSocket（沙箱/正式环境），事件体含 { id, content, chat_type, group_openid, ... }
//   - 发消息：POST https://bots.qq.com/app/v1/messages/{chat_type}/{openid} 带 Authorization Bearer <access_token>
//   - 鉴权：appid+secret 换 access_token（POST /app/v1/token）→ 全局唯一 token 缓存
//
// 本适配器为「HTTP 回调兼容层」+「WebSocket 消息处理器」：
//   - 若官方当前支持 webhook 回调（部分类型），走 /webhook 签名校验；
//   - 否则提供 connectQQWS() 常驻长连接（M2 生命周期），消息进同一 normalize 管道。
// 未配置 HESI_BOT_QQ_APPID/SECRET → 本适配器不激活（fail-closed，见 index.js）。
// ============================================================

const { normalizeInbound } = require('./adapter');
const botConfig = require('../../lib/bot-config');

/** @type {{ token: string, tokenExpireAt: number }} */
const state = {
  token: '',
  tokenExpireAt: 0,
};

/** 运行时取配置（env 优先 + data 覆盖）。 */
function getCredentials() {
  return botConfig.getConfig('qq');
}

/** 适配器是否已配置（未配置 → 不注册路由）。 */
const isConfigured = () => botConfig.isConfigured('qq');

/**
 * 获取 QQ access_token（带缓存，过期前 60s 刷新）。
 * 凭证从 botConfig 读取（env 优先）。
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  if (state.token && Date.now() < state.tokenExpireAt - 60000) return state.token;
  const cred = getCredentials();
  const res = await fetch('https://bots.qq.com/app/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: cred.appId, clientSecret: cred.secret }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`qq: token exchange failed (HTTP ${res.status}) ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  state.token = data.access_token || '';
  state.tokenExpireAt = Date.now() + ((Number(data.expires_in) || 7200) * 1000);
  return state.token;
}

/**
 * 测试凭证连通性：尝试换取 access_token。
 * @returns {Promise<{ ok: boolean, detail?: string, error?: string }>}
 */
async function testConnection() {
  try {
    const token = await getAccessToken();
    return { ok: !!token, detail: token ? '凭证有效，成功获取 access_token' : '返回空 token' };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * 校验 QQ 回调签名（HTTP webhook 模式）。QQ 官方以 appid+token 验签，
 * 具体字段随官方文档演进——此处做 fail-closed 骨架：
 * 未实现真实验签逻辑前，回调一律拒绝（防未授权滥用）。
 * @param {import('express').Request} _req
 * @returns {boolean}
 */
function verifyWebhook(_req) {
  // TODO(M1 落地时按官方文档实现)：校验回调签名/时间戳防重放。
  // 现阶段 fail-closed：无明确验签实现 → 拒绝。
  return false;
}

/**
 * 把 QQ 消息事件规范化为统一 inbound。
 * @param {object} event — QQ 官方消息事件（content/openid/group_openid 等）
 * @returns {object} normalized inbound
 */
function eventToInbound(event) {
  const content = (event && (event.content || '')) || '';
  // QQ 机器人 @ 消息：content 形如 "<@!123456> 你好" → 剥离 @ 前缀取正文
  const text = String(content).replace(/^<@!?\d+>\s*/, '').trim();
  const chatType = event && event.chat_type; // 2=群, 1=c2c(私聊)
  const chatId = (event && (event.group_openid || event.openid || '')) || '';
  return normalizeInbound('qq', {
    chatId,
    userId: (event && event.author && event.author.user_openid) || chatId,
    text,
  }, { chatType });
}

/**
 * 发送一条消息到 QQ 会话。
 * @param {string} chatId
 * @param {string} text
 * @param {{ chatType?: number }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendMessage(chatId, text, opts = {}) {
  if (!chatId || !text) return { ok: false, error: 'qq: chatId/text required' };
  const token = await getAccessToken();
  // QQ 消息类型：2=群消息，1=c2c(私聊)；默认群（官方路径含 chat_type 段）
  const chatType = opts.chatType || 2;
  const res = await fetch(`https://bots.qq.com/app/v1/messages/${chatType}/${encodeURIComponent(chatId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content: text.slice(0, 2000) }), // QQ 单条上限
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `qq: send failed (HTTP ${res.status}) ${t.slice(0, 200)}` };
  }
  return { ok: true };
}

module.exports = {
  isConfigured,
  getAccessToken,
  testConnection,
  verifyWebhook,
  eventToInbound,
  sendMessage,
};
