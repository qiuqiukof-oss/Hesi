/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// WeChat Bot Adapter — 微信 iLink Bot API（扫码登录 + 长轮询）
//
// 协议（2026-08 核验，基座 https://ilinkai.weixin.qq.com）：
//   登录：GET /get_bot_qrcode?bot_type=3 → 二维码
//         GET /get_qrcode_status?qrcode=... → 轮询 wait→scaned→confirmed
//         confirmed 后返回 bot_token（Bearer）+ baseurl（可能不同，始终用返回值）
//   收消息：POST /getupdates（长轮询 ~35s 挂起，get_updates_buf 游标）
//   发消息：POST /sendmessage（必须回传入站消息的 context_token）
//   会话过期：errcode:-14 → 需重新扫码（bot_token 失效）
//
// 与 QQ 适配器的区别：QQ 是 webhook/官方 token，微信是「扫码 + 长轮询」——
// 适配器要主动起轮询循环（M2 生命周期），配置形态是广场页内嵌二维码。
// 凭证存 bot-config：{ botToken, baseurl }（扫码获得，非用户手填）。
// ============================================================

const botConfig = require('../../lib/bot-config');

const BASE = 'https://ilinkai.weixin.qq.com';

/** 是否已配置（有 botToken 即视为已登录）。 */
const isConfigured = () => {
  const cfg = botConfig.getConfig('wechat-bot');
  return !!(cfg.botToken);
};

/**
 * 请求体公共字段（协议要求每个业务 POST 都带）。
 * @param {object} extra
 * @returns {object}
 */
function baseBody(extra = {}) {
  return { base_info: { channel_version: '2.0.0' }, ...extra };
}

/** 生成随机 X-WECHAT-UIN（base64(uint32)）。 */
function randomUin() {
  const buf = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('base64');
}

/**
 * 获取登录二维码。
 * @returns {Promise<{ ok: boolean, qrcode?: string, qrcodeUrl?: string, error?: string }>}
 */
async function getQrCode() {
  try {
    const res = await fetch(`${BASE}/get_bot_qrcode?bot_type=3`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `wechat: get qrcode failed (HTTP ${res.status}) ${t.slice(0, 200)}` };
    }
    const data = await res.json();
    // 返回 { qrcode, qrcode_img_content }——qrcode 是状态轮询 id，img 是二维码图 URL
    const qrcode = data.qrcode || '';
    const imgUrl = data.qrcode_img_content || '';
    if (!qrcode) return { ok: false, error: 'wechat: qrcode missing in response' };
    return { ok: true, qrcode, qrcodeUrl: imgUrl };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * 轮询扫码状态。confirmed 后持久化 bot_token + baseurl。
 * @param {string} qrcode — getQrCode 返回的 qrcode id
 * @returns {Promise<{ status: 'wait'|'scaned'|'confirmed'|'expired'|'error', error?: string, detail?: string }>}
 */
async function pollQrStatus(qrcode) {
  try {
    const res = await fetch(`${BASE}/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { status: 'error', error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    const data = await res.json();
    const status = data.status || 'wait';
    if (status === 'confirmed') {
      const botToken = data.bot_token || '';
      const baseurl = data.baseurl || BASE;
      if (botToken) {
        botConfig.saveConfig('wechat-bot', { botToken, baseurl });
        return { status: 'confirmed', detail: '扫码确认成功，已保存登录态' };
      }
      return { status: 'error', error: 'confirmed 但缺少 bot_token' };
    }
    return { status };
  } catch (err) {
    return { status: 'error', error: (err && err.message) || String(err) };
  }
}

/**
 * 长轮询收消息（单次，35s 挂起）。
 * @param {string} getUpdatesBuf — 不透明游标（首次 ''）
 * @returns {Promise<{ ok: boolean, msgs: object[], buf: string, expired?: boolean, error?: string }>}
 */
async function getUpdates(getUpdatesBuf = '') {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken) return { ok: false, error: 'wechat: not configured (扫码登录后才可用)' };
  const url = cfg.baseurl || BASE;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000); // 略大于 35s 挂起
    const res = await fetch(`${url}/getupdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${cfg.botToken}`,
        'X-WECHAT-UIN': randomUin(),
      },
      body: JSON.stringify(baseBody({ get_updates_buf: getUpdatesBuf })),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.errcode === -14 || data.ret === -14) {
      return { ok: false, expired: true, error: '会话过期，需重新扫码' };
    }
    return { ok: true, msgs: data.msgs || [], buf: data.get_updates_buf || getUpdatesBuf };
  } catch (err) {
    return { ok: false, error: (err && err.name === 'AbortError') ? 'timeout' : ((err && err.message) || String(err)) };
  }
}

/**
 * 发送文本消息（必须回传 context_token）。
 * @param {string} contextToken — 入站消息的 context_token
 * @param {string} text
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendMessage(contextToken, text) {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken || !contextToken) return { ok: false, error: 'wechat: botToken/contextToken required' };
  const url = cfg.baseurl || BASE;
  try {
    const res = await fetch(`${url}/sendmessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${cfg.botToken}`,
        'X-WECHAT-UIN': randomUin(),
      },
      body: JSON.stringify(baseBody({ context_token: contextToken, text: text.slice(0, 2000) })),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    const data = await res.json();
    if (data.errcode === -14) return { ok: false, expired: true, error: '会话过期' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * 测试连接：读配置状态（扫码登录后即"已连接"；未配置提示扫码）。
 * @returns {Promise<{ ok: boolean, detail?: string, error?: string }>}
 */
async function testConnection() {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken) return { ok: false, error: '未扫码登录，请先在广场页扫码' };
  return { ok: true, detail: '已扫码登录（bot_token 已保存），长轮询收消息待启用' };
}

module.exports = {
  isConfigured,
  getQrCode,
  pollQrStatus,
  getUpdates,
  sendMessage,
  testConnection,
};
