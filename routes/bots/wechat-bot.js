/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// WeChat Bot Adapter — 微信 iLink Bot API（扫码登录 + 长轮询）
//
// 协议（2026-08 核验：wechatbot.dev + 腾讯云实测文章 + corespeed-io 协议文档，
// 基座 https://ilinkai.weixin.qq.com，注意所有端点带 /ilink/bot/ 前缀）：
//   登录：GET  /ilink/bot/get_bot_qrcode?bot_type=3
//             → { qrcode, qrcode_img_content } 其中 qrcode_img_content 是
//               「可打开的网页链接」（https://liteapp.weixin.qq.com/q/...），
//               不是图片 URL——需将该链接再生成二维码供用户扫码（官方文章原话）。
//         GET  /ilink/bot/get_qrcode_status?qrcode=...（头 iLink-App-ClientVersion: 1）
//             → wait→scaned→confirmed（或 expired/need_verifycode 等）
//             confirmed 后返回 bot_token（Bearer）+ baseurl（可能不同，始终用返回值）
//   收消息：POST /ilink/bot/getupdates（长轮询 ~35s 挂起，get_updates_buf 游标）
//   发消息：POST /ilink/bot/sendmessage（必须回传入站消息的 context_token）
//   会话过期：errcode:-14 → 需重新扫码（bot_token 失效）
//
// 与 QQ 适配器的区别：QQ 是 webhook/官方 token，微信是「扫码 + 长轮询」——
// 适配器要主动起轮询循环（M2 生命周期），配置形态是广场页内嵌二维码。
// 凭证存 bot-config：{ botToken, baseurl }（扫码获得，非用户手填）。
// ============================================================

const botConfig = require('../../lib/bot-config');

const BASE = 'https://ilinkai.weixin.qq.com';
// ⚠️ 所有业务端点带 /ilink/bot/ 前缀（v1 实现漏掉导致 404、显示不出二维码）
const API = `${BASE}/ilink/bot`;

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

/** 生成随机 X-WECHAT-UIN（协议：uint32 → 十进制字符串 → base64，见官方 curl 示例 MzA1NDE5ODk2）。 */
function randomUin() {
  const n = Math.floor(Math.random() * 0xFFFFFFFF);
  return Buffer.from(String(n), 'utf8').toString('base64');
}

/**
 * 从入站消息提取文本（协议结构：item_list[].text_item.text，type=1 文本）。
 * @param {object} m — getupdates 返回的 msgs 单条消息
 * @returns {string}
 */
function extractText(m) {
  if (!m || !Array.isArray(m.item_list)) return '';
  for (const it of m.item_list) {
    if (it && it.type === 1 && it.text_item && typeof it.text_item.text === 'string') {
      return it.text_item.text;
    }
  }
  return '';
}

/**
 * 获取登录二维码。
 * qrcodeUrl 是「可打开的网页链接」（liteapp.weixin.qq.com），前端需把它
 * 再渲染成二维码图片供用户扫码（官方流程：手机微信打开该链接即显示二维码）。
 * @returns {Promise<{ ok: boolean, qrcode?: string, qrcodeUrl?: string, error?: string }>}
 */
async function getQrCode() {
  try {
    const res = await fetch(`${API}/get_bot_qrcode?bot_type=3`, {
      headers: { 'iLink-App-ClientVersion': '1' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `wechat: get qrcode failed (HTTP ${res.status}) ${t.slice(0, 200)}` };
    }
    const data = await res.json();
    // { qrcode, qrcode_img_content, ret }——qrcode 是状态轮询 id，
    // qrcode_img_content 是可打开链接（生成二维码供扫码）
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
    const res = await fetch(`${API}/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
      headers: { 'iLink-App-ClientVersion': '1' },
    });
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
        // 凭证变更 → 重启接收循环（bug 修复 2026-08-04：此前需重启服务才生效）
        try { require('../../lib/bot-loop').restartAll?.(); } catch { /* ignore */ }
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
  // baseurl 来自扫码确认返回（可能指向 CDN/IDC 域名）；默认走 API 基座
  const url = (cfg.baseurl || BASE).replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000); // 略大于 35s 挂起
    const res = await fetch(`${url}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${cfg.botToken}`,
        'X-WECHAT-UIN': randomUin(),
        // bug 修复（2026-08-04）：协议要求客户端版本头（见 get_qrcode_status 注释）。
        // 实测缺此头时 getupdates 被当作长轮询永久挂起，token 过期（errcode:-14）
        // 也不立即返回，导致「会话过期」无法被及时探测到。
        'iLink-App-ClientVersion': '1',
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
 * 发送文本消息（bug 修复 2026-08-04：请求体改为协议要求的 msg 包装结构
 * ——原平铺 { context_token, text } 与协议不符，服务端无法路由/解析，
 * 是"bot 收到消息但不回复"的根因之一）。
 * 协议要求（对照 wechatbot.dev / botilink 实现）：
 *   { "msg": { "to_user_id", "client_id", "message_type": 2, "message_state": 2,
 *              "item_list": [{ "type": 1, "text_item": { "text" } }],
 *              "context_token" }, "base_info": {...} }
 * @param {string} contextToken — 入站消息的 context_token（必须回传）
 * @param {string} text
 * @param {string} [toUserId] — 入站消息的 from_user_id（发送者），回传给 ta
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendMessage(contextToken, text, toUserId) {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken || !contextToken) return { ok: false, error: 'wechat: botToken/contextToken required' };
  const url = (cfg.baseurl || BASE).replace(/\/+$/, '');
  const payload = {
    msg: {
      to_user_id: toUserId || '',
      client_id: `hesi-${Math.random().toString(36).slice(2, 10)}`,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text: text.slice(0, 2000) } }],
    },
  };
  try {
    const res = await fetch(`${url}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${cfg.botToken}`,
        'X-WECHAT-UIN': randomUin(),
        'iLink-App-ClientVersion': '1',
      },
      body: JSON.stringify(baseBody(payload)),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    if (data.errcode === -14 || data.ret === -14) return { ok: false, expired: true, error: '会话过期' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

/**
 * 测试连接：优先读 bot-loop 实时状态（bug 修复 2026-08-04——原实现只看
 * token 是否存在，token 过期（errcode:-14）时仍报"已连接"，误导用户；
 * 且 getupdates 是长轮询，与接收循环并发会被挂起，不能作为探测手段）。
 *   - 循环已探测到过期 → "会话过期，需重新扫码"
 *   - 循环最近轮询正常 → "通讯正常"
 *   - 状态未知（循环未跑/刚启动）→ 短超时探测兜底（8s）
 * @returns {Promise<{ ok: boolean, detail?: string, error?: string }>}
 */
async function testConnection() {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken) return { ok: false, error: '未扫码登录，请先在广场页扫码' };
  // 读接收循环的实时状态（不发起互斥探测——getupdates 是稀缺长轮询资源，
  // 与接收循环并发会被服务端挂起，绝不能作为探测手段）
  const { getLoopState } = require('../../lib/bot-loop');
  const st = getLoopState('wechat-bot');
  if (st.known && st.expired) {
    return { ok: false, error: st.lastError || '会话过期，请点「🔗 重新扫码」重新登录' };
  }
  // 轮询有过异常记录（含 timeout）→ 不能报"正常"：token 过期时 getupdates
  // 会被服务端挂住直至超时，timeout 大概率即会话过期（bug 修复 2026-08-04，
  // 此前误报"通讯正常"误导用户）
  if (st.known && st.lastError) {
    return {
      ok: false,
      error: `轮询异常（${st.lastError}）——大概率会话过期，请点「🔗 重新扫码」重新登录（重扫后仍异常则检查网络）`,
    };
  }
  if (st.known && !st.expired) {
    return { ok: true, detail: '通讯正常（长轮询运行中，token 有效）' };
  }
  // 状态未知：短超时探测兜底（此时接收循环可能未启动）
  const r = await getUpdatesWithTimeout('', 8000);
  if (r.expired) {
    return { ok: false, error: '会话过期（errcode:-14），请点「🔗 重新扫码」重新登录' };
  }
  if (r.ok) return { ok: true, detail: '通讯正常（iLink 长轮询端点可达，token 有效）' };
  // timeout 或网络错误：大概率会话过期（过期 token 的 getupdates 可能被挂起），
  // 也可能是网络问题——指引用户优先重扫，扫码后仍不通再看网络。
  return {
    ok: false,
    error: `${r.error || '探测失败'}——大概率会话过期，请点「🔗 重新扫码」重新登录（重扫后仍不通则检查网络）`,
  };
}

/** getUpdates 的短超时变体（测试用）：探测连通但不长时间挂起。 */
async function getUpdatesWithTimeout(getUpdatesBuf, timeoutMs) {
  const cfg = botConfig.getConfig('wechat-bot');
  if (!cfg.botToken) return { ok: false, error: 'wechat: not configured' };
  const url = (cfg.baseurl || BASE).replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${url}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${cfg.botToken}`,
        'X-WECHAT-UIN': randomUin(),
        'iLink-App-ClientVersion': '1',
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

module.exports = {
  isConfigured,
  getQrCode,
  pollQrStatus,
  getUpdates,
  sendMessage,
  extractText,
  testConnection,
};
